use rclone_logic::{
    classify_rclone_error, is_system_like_onedrive_drive_label,
    normalize_onedrive_drive_candidates, parse_listremotes, parse_lsjson_items,
    parse_remote_config_state_map, parse_unified_items, prefix_unified_item_paths,
    select_auto_onedrive_drive_candidate, LsjsonItem, OneDriveDriveCandidate, RcloneErrorKind,
    RemoteConfigState, UnifiedItem, UnifiedLibraryResult,
};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    hash::{Hash, Hasher},
    path::Component,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

const RCLONE_BINARY: &str = "rclone-x86_64-pc-windows-msvc.exe";
const AUTH_COMMAND_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const INVENTORY_COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
const POLL_INTERVAL: Duration = Duration::from_millis(250);
const AUTH_START_GRACE_PERIOD: Duration = Duration::from_millis(350);
const GRAPH_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const GRAPH_BASE_URL: &str = "https://graph.microsoft.com/v1.0";
const DOWNLOAD_PROGRESS_EVENT: &str = "download://progress";
const LIBRARY_PROGRESS_EVENT: &str = "library://progress";
const DOWNLOAD_POLL_INTERVAL: Duration = Duration::from_millis(400);
const OPEN_TEMP_MAX_AGE: Duration = Duration::from_secs(60 * 60 * 24);

#[derive(Default)]
struct AuthSessionStore {
    sessions: Mutex<HashMap<String, AuthSessionRecord>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteSummary {
    name: String,
    provider: String,
    status: String,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateOneDriveRemoteInput {
    remote_name: String,
    client_id: Option<String>,
    client_secret: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateRemoteResult {
    remote_name: String,
    provider: String,
    status: String,
    next_step: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    drive_candidates: Option<Vec<OneDriveDriveCandidate>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSessionRecord {
    remote_name: String,
    provider: String,
    mode: String,
    status: String,
    next_step: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    drive_candidates: Option<Vec<OneDriveDriveCandidate>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    status: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartDownloadInput {
    download_id: String,
    source_remote: String,
    source_path: String,
    display_name: String,
    size: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrepareOpenFileInput {
    request_id: String,
    source_remote: String,
    source_path: String,
    display_name: String,
    mime_type: Option<String>,
    extension: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadAcceptedResult {
    download_id: String,
    status: String,
    target_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareOpenFileResult {
    request_id: String,
    status: String,
    local_path: String,
    open_mode: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressEvent {
    download_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_transferred: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartUnifiedLibraryLoadResult {
    status: String,
    request_id: String,
    total_remotes: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnifiedLibraryLoadEvent {
    request_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    remote_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<Vec<rclone_logic::UnifiedItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notices: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    loaded_remote_count: usize,
    total_remote_count: usize,
}

#[derive(Clone, Debug)]
struct RemoteValidationResult {
    provider: String,
    remote_exists: bool,
    has_drive_id: bool,
    has_drive_type: bool,
    can_list: bool,
    failure_reason: Option<String>,
}

#[derive(Clone, Debug)]
struct RemoteLoadTarget {
    name: String,
    provider: String,
}

#[derive(Clone, Debug)]
struct OneDriveFolderTarget {
    target: String,
    path_label: String,
}

#[derive(Clone, Debug)]
struct OneDriveStage {
    root_files: Vec<UnifiedItem>,
    folders: Vec<OneDriveFolderTarget>,
}

enum LibraryLoadMessage {
    Batch {
        remote: RemoteLoadTarget,
        items: Vec<UnifiedItem>,
        notices: Vec<String>,
    },
    RemoteLoaded {
        remote: RemoteLoadTarget,
        items: Vec<UnifiedItem>,
        notices: Vec<String>,
    },
    RemoteComplete {
        remote: RemoteLoadTarget,
        notices: Vec<String>,
    },
    RemoteFailed {
        remote: RemoteLoadTarget,
        error: String,
    },
}

#[derive(Debug, Deserialize)]
struct OAuthTokenPayload {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct GraphDriveListResponse {
    value: Vec<GraphDrive>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphDrive {
    id: String,
    #[serde(default)]
    name: Option<String>,
    drive_type: String,
    #[serde(default)]
    _web_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphErrorResponse {
    error: GraphErrorPayload,
}

#[derive(Debug, Deserialize)]
struct GraphErrorPayload {
    #[serde(default)]
    message: Option<String>,
}

#[tauri::command]
async fn list_storage_remotes(app: AppHandle) -> Result<Vec<RemoteSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_storage_remotes_impl(app))
        .await
        .map_err(|error| format!("failed to join storage list task: {error}"))?
}

#[tauri::command]
async fn create_onedrive_remote(
    app: AppHandle,
    input: CreateOneDriveRemoteInput,
) -> Result<CreateRemoteResult, String> {
    tauri::async_runtime::spawn_blocking(move || create_onedrive_remote_impl(app, input))
        .await
        .map_err(|error| format!("failed to join OneDrive setup task: {error}"))?
}

#[tauri::command]
async fn list_unified_items(app: AppHandle) -> Result<UnifiedLibraryResult, String> {
    tauri::async_runtime::spawn_blocking(move || list_unified_items_impl(app))
        .await
        .map_err(|error| format!("failed to join unified item task: {error}"))?
}

#[tauri::command]
async fn reconnect_remote(app: AppHandle, name: String) -> Result<CreateRemoteResult, String> {
    tauri::async_runtime::spawn_blocking(move || reconnect_remote_impl(app, name))
        .await
        .map_err(|error| format!("failed to join reconnect task: {error}"))?
}

#[tauri::command]
async fn list_onedrive_drive_candidates(
    app: AppHandle,
    name: String,
) -> Result<Vec<OneDriveDriveCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || list_onedrive_drive_candidates_impl(app, name))
        .await
        .map_err(|error| format!("failed to join drive candidate task: {error}"))?
}

#[tauri::command]
async fn finalize_onedrive_remote(
    app: AppHandle,
    name: String,
    drive_id: String,
) -> Result<CreateRemoteResult, String> {
    tauri::async_runtime::spawn_blocking(move || finalize_onedrive_remote_impl(app, name, drive_id))
        .await
        .map_err(|error| format!("failed to join drive finalization task: {error}"))?
}

#[tauri::command]
async fn get_auth_session_status(
    app: AppHandle,
    name: String,
) -> Result<Option<AuthSessionRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(get_auth_session_record(&app, &name)))
        .await
        .map_err(|error| format!("failed to join auth status task: {error}"))?
}

#[tauri::command]
async fn delete_remote(app: AppHandle, name: String) -> Result<ActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || delete_remote_impl(app, name))
        .await
        .map_err(|error| format!("failed to join delete task: {error}"))?
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    input: StartDownloadInput,
) -> Result<DownloadAcceptedResult, String> {
    tauri::async_runtime::spawn_blocking(move || start_download_impl(app, input))
        .await
        .map_err(|error| format!("failed to join download task: {error}"))?
}

#[tauri::command]
async fn prepare_open_file(
    app: AppHandle,
    input: PrepareOpenFileInput,
) -> Result<PrepareOpenFileResult, String> {
    tauri::async_runtime::spawn_blocking(move || prepare_open_file_impl(app, input))
        .await
        .map_err(|error| format!("failed to join open preparation task: {error}"))?
}

#[tauri::command]
async fn start_unified_library_load(
    app: AppHandle,
) -> Result<StartUnifiedLibraryLoadResult, String> {
    tauri::async_runtime::spawn_blocking(move || start_unified_library_load_impl(app))
        .await
        .map_err(|error| format!("failed to join unified library stream task: {error}"))?
}

fn list_storage_remotes_impl(app: AppHandle) -> Result<Vec<RemoteSummary>, String> {
    let config_path = ensure_rclone_config(&app)?;
    let stdout = run_rclone(
        &app,
        &["listremotes", "--json", "--config"],
        &[config_path.as_os_str()],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    let remotes = parse_listremotes(&stdout)?;
    let remote_config_by_name = load_remote_config_states(&app, &config_path)?;

    let mut summaries = remotes
        .into_iter()
        .map(|remote_name| {
            let config_state = remote_config_by_name
                .get(&remote_name)
                .cloned()
                .unwrap_or_else(default_remote_config_state);

            RemoteSummary {
                name: remote_name,
                provider: config_state.provider.clone(),
                status: remote_status(&config_state).to_string(),
                message: remote_status_message(&config_state),
            }
        })
        .collect::<Vec<_>>();

    summaries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(summaries)
}

fn create_onedrive_remote_impl(
    app: AppHandle,
    input: CreateOneDriveRemoteInput,
) -> Result<CreateRemoteResult, String> {
    validate_remote_name(&input.remote_name)?;

    let config_path = ensure_rclone_config(&app)?;
    let mut owned_args = vec![
        "config".to_string(),
        "create".to_string(),
        input.remote_name.clone(),
        "onedrive".to_string(),
        "config_is_local=true".to_string(),
    ];

    if let Some(client_id) = input.client_id.filter(|value| !value.trim().is_empty()) {
        owned_args.push(format!("client_id={client_id}"));
    }

    if let Some(client_secret) = input.client_secret.filter(|value| !value.trim().is_empty()) {
        owned_args.push(format!("client_secret={client_secret}"));
    }

    owned_args.push("--config".to_string());
    owned_args.push(config_path.to_string_lossy().into_owned());

    start_auth_flow(&app, &input.remote_name, "onedrive", "create", &owned_args)
}

fn list_unified_items_impl(app: AppHandle) -> Result<UnifiedLibraryResult, String> {
    let config_path = ensure_rclone_config(&app)?;
    let remotes = list_connected_remote_targets(&app, &config_path)?;

    if remotes.is_empty() {
        return Ok(UnifiedLibraryResult {
            items: Vec::new(),
            notices: Vec::new(),
        });
    }
    let mut items = Vec::new();
    let mut notices = Vec::new();

    for remote in remotes {
        let partial = load_items_for_remote(&app, &config_path, &remote.name, &remote.provider)?;
        items.extend(partial.items);
        notices.extend(partial.notices);
    }

    items.sort_by(|left, right| {
        left.source_remote
            .cmp(&right.source_remote)
            .then(left.source_path.cmp(&right.source_path))
    });

    notices.sort();
    notices.dedup();

    Ok(UnifiedLibraryResult { items, notices })
}

fn start_unified_library_load_impl(
    app: AppHandle,
) -> Result<StartUnifiedLibraryLoadResult, String> {
    let config_path = ensure_rclone_config(&app)?;
    let remotes = list_connected_remote_targets(&app, &config_path)?;
    let request_id = format!(
        "library-load-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    );
    let total_remotes = remotes.len();

    emit_library_progress(
        &app,
        UnifiedLibraryLoadEvent {
            request_id: request_id.clone(),
            status: "started".to_string(),
            remote_name: None,
            provider: None,
            items: None,
            notices: None,
            message: None,
            loaded_remote_count: 0,
            total_remote_count: total_remotes,
        },
    );

    if total_remotes == 0 {
        emit_library_progress(
            &app,
            UnifiedLibraryLoadEvent {
                request_id: request_id.clone(),
                status: "completed".to_string(),
                remote_name: None,
                provider: None,
                items: None,
                notices: Some(Vec::new()),
                message: None,
                loaded_remote_count: 0,
                total_remote_count: 0,
            },
        );

        return Ok(StartUnifiedLibraryLoadResult {
            status: "accepted".to_string(),
            request_id,
            total_remotes,
        });
    }

    let request_id_for_thread = request_id.clone();
    let app_for_thread = app.clone();
    let config_path_for_thread = config_path.clone();

    thread::spawn(move || {
        let (sender, receiver) = mpsc::channel::<LibraryLoadMessage>();

        for remote in remotes {
            let sender = sender.clone();
            let app = app_for_thread.clone();
            let config_path = config_path_for_thread.clone();

            thread::spawn(move || {
                if remote.provider == "onedrive" {
                    match stream_onedrive_remote_batches(
                        &app,
                        &config_path,
                        &remote,
                        sender.clone(),
                    ) {
                        Ok(notices) => {
                            let _ =
                                sender.send(LibraryLoadMessage::RemoteComplete { remote, notices });
                        }
                        Err(error) => {
                            let _ = sender.send(LibraryLoadMessage::RemoteFailed { remote, error });
                        }
                    }
                    return;
                }

                match load_items_for_remote(&app, &config_path, &remote.name, &remote.provider) {
                    Ok(library) => {
                        let _ = sender.send(LibraryLoadMessage::RemoteLoaded {
                            remote,
                            items: library.items,
                            notices: library.notices,
                        });
                    }
                    Err(error) => {
                        let _ = sender.send(LibraryLoadMessage::RemoteFailed { remote, error });
                    }
                }
            });
        }

        drop(sender);

        let mut loaded_remote_count = 0;

        for message in receiver {
            match message {
                LibraryLoadMessage::Batch {
                    remote,
                    items,
                    notices,
                } => emit_library_progress(
                    &app_for_thread,
                    UnifiedLibraryLoadEvent {
                        request_id: request_id_for_thread.clone(),
                        status: "remote_loaded".to_string(),
                        remote_name: Some(remote.name),
                        provider: Some(remote.provider),
                        items: Some(items),
                        notices: Some(notices),
                        message: None,
                        loaded_remote_count,
                        total_remote_count: total_remotes,
                    },
                ),
                LibraryLoadMessage::RemoteLoaded {
                    remote,
                    items,
                    notices,
                } => {
                    loaded_remote_count += 1;

                    emit_library_progress(
                        &app_for_thread,
                        UnifiedLibraryLoadEvent {
                            request_id: request_id_for_thread.clone(),
                            status: "remote_loaded".to_string(),
                            remote_name: Some(remote.name),
                            provider: Some(remote.provider),
                            items: Some(items),
                            notices: Some(notices),
                            message: None,
                            loaded_remote_count,
                            total_remote_count: total_remotes,
                        },
                    );
                }
                LibraryLoadMessage::RemoteComplete { remote, notices } => {
                    loaded_remote_count += 1;

                    emit_library_progress(
                        &app_for_thread,
                        UnifiedLibraryLoadEvent {
                            request_id: request_id_for_thread.clone(),
                            status: "remote_loaded".to_string(),
                            remote_name: Some(remote.name),
                            provider: Some(remote.provider),
                            items: Some(Vec::new()),
                            notices: Some(notices),
                            message: None,
                            loaded_remote_count,
                            total_remote_count: total_remotes,
                        },
                    );
                }
                LibraryLoadMessage::RemoteFailed { remote, error } => {
                    loaded_remote_count += 1;

                    emit_library_progress(
                        &app_for_thread,
                        UnifiedLibraryLoadEvent {
                            request_id: request_id_for_thread.clone(),
                            status: "remote_failed".to_string(),
                            remote_name: Some(remote.name),
                            provider: Some(remote.provider),
                            items: Some(Vec::new()),
                            notices: Some(Vec::new()),
                            message: Some(user_facing_command_error(&error)),
                            loaded_remote_count,
                            total_remote_count: total_remotes,
                        },
                    );
                }
            }
        }

        emit_library_progress(
            &app_for_thread,
            UnifiedLibraryLoadEvent {
                request_id: request_id_for_thread,
                status: "completed".to_string(),
                remote_name: None,
                provider: None,
                items: None,
                notices: Some(Vec::new()),
                message: None,
                loaded_remote_count: total_remotes,
                total_remote_count: total_remotes,
            },
        );
    });

    Ok(StartUnifiedLibraryLoadResult {
        status: "accepted".to_string(),
        request_id,
        total_remotes,
    })
}

fn reconnect_remote_impl(app: AppHandle, name: String) -> Result<CreateRemoteResult, String> {
    validate_remote_name(&name)?;

    let config_path = ensure_rclone_config(&app)?;
    let remote_target = format!("{name}:");
    let owned_args = vec![
        "config".to_string(),
        "reconnect".to_string(),
        remote_target,
        "--config".to_string(),
        config_path.to_string_lossy().into_owned(),
    ];

    start_auth_flow(&app, &name, "onedrive", "reconnect", &owned_args)
}

fn list_connected_remote_targets(
    app: &AppHandle,
    config_path: &Path,
) -> Result<Vec<RemoteLoadTarget>, String> {
    let stdout = run_rclone(
        app,
        &["listremotes", "--json", "--config"],
        &[config_path.as_os_str()],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    let remotes = parse_listremotes(&stdout)?;
    let remote_config_by_name = load_remote_config_states(app, config_path)?;

    Ok(remotes
        .into_iter()
        .filter_map(|remote_name| {
            let config_state = remote_config_by_name
                .get(&remote_name)
                .cloned()
                .unwrap_or_else(default_remote_config_state);

            (remote_status(&config_state) == "connected").then_some(RemoteLoadTarget {
                name: remote_name,
                provider: config_state.provider,
            })
        })
        .collect())
}

fn load_items_for_remote(
    app: &AppHandle,
    config_path: &Path,
    remote_name: &str,
    provider: &str,
) -> Result<UnifiedLibraryResult, String> {
    if provider == "onedrive" {
        list_unified_items_for_onedrive_remote(app, config_path, remote_name, provider)
    } else {
        let output = run_rclone_owned(
            app,
            &[
                "lsjson".to_string(),
                format!("{remote_name}:"),
                "-R".to_string(),
                "--files-only".to_string(),
                "--config".to_string(),
                config_path.to_string_lossy().into_owned(),
            ],
            INVENTORY_COMMAND_TIMEOUT,
        )?;

        Ok(UnifiedLibraryResult {
            items: parse_unified_items(&output, remote_name, provider)?,
            notices: Vec::new(),
        })
    }
}

fn list_unified_items_for_onedrive_remote(
    app: &AppHandle,
    config_path: &Path,
    remote_name: &str,
    provider: &str,
) -> Result<UnifiedLibraryResult, String> {
    let stage = list_onedrive_root_stage(app, config_path, remote_name, provider)?;
    let mut items = stage.root_files;
    let mut notices = Vec::new();

    if stage.folders.is_empty() {
        return Ok(UnifiedLibraryResult { items, notices });
    }

    for result in
        spawn_onedrive_folder_workers(app, config_path, remote_name, provider, stage.folders)
    {
        match result {
            Ok(batch) => {
                items.extend(batch.items);
                notices.extend(batch.notices);
            }
            Err(error) => return Err(error),
        }
    }

    notices.sort();
    notices.dedup();

    Ok(UnifiedLibraryResult { items, notices })
}

fn stream_onedrive_remote_batches(
    app: &AppHandle,
    config_path: &Path,
    remote: &RemoteLoadTarget,
    sender: mpsc::Sender<LibraryLoadMessage>,
) -> Result<Vec<String>, String> {
    let stage = list_onedrive_root_stage(app, config_path, &remote.name, &remote.provider)?;

    log::debug!(
        "onedrive staged listing started remote={} root_files={} top_level_folders={}",
        remote.name,
        stage.root_files.len(),
        stage.folders.len()
    );

    if !stage.root_files.is_empty() {
        let _ = sender.send(LibraryLoadMessage::Batch {
            remote: remote.clone(),
            items: stage.root_files,
            notices: Vec::new(),
        });
    }

    for result in spawn_onedrive_folder_workers(
        app,
        config_path,
        &remote.name,
        &remote.provider,
        stage.folders,
    ) {
        match result {
            Ok(batch) => {
                if !batch.items.is_empty() || !batch.notices.is_empty() {
                    let _ = sender.send(LibraryLoadMessage::Batch {
                        remote: remote.clone(),
                        items: batch.items,
                        notices: batch.notices,
                    });
                }
            }
            Err(error) => return Err(error),
        }
    }

    Ok(Vec::new())
}

fn list_onedrive_root_stage(
    app: &AppHandle,
    config_path: &Path,
    remote_name: &str,
    provider: &str,
) -> Result<OneDriveStage, String> {
    let root_items = parse_lsjson_items(&run_rclone_owned(
        app,
        &[
            "lsjson".to_string(),
            format!("{remote_name}:"),
            "--config".to_string(),
            config_path.to_string_lossy().into_owned(),
        ],
        DEFAULT_COMMAND_TIMEOUT,
    )?)?;

    let mut root_files = Vec::new();
    let mut folders = Vec::new();

    for root_item in root_items {
        if root_item.is_dir {
            folders.push(onedrive_folder_target_from_root_item(
                remote_name,
                &root_item,
            ));
        } else {
            root_files.extend(parse_lsjson_batch(
                std::slice::from_ref(&root_item),
                remote_name,
                provider,
            )?);
        }
    }

    Ok(OneDriveStage {
        root_files,
        folders,
    })
}

fn onedrive_folder_target_from_root_item(
    remote_name: &str,
    root_item: &LsjsonItem,
) -> OneDriveFolderTarget {
    OneDriveFolderTarget {
        target: if root_item.path.is_empty() {
            format!("{remote_name}:")
        } else {
            format!("{remote_name}:{}", root_item.path)
        },
        path_label: if root_item.path.is_empty() {
            "/".to_string()
        } else {
            root_item.path.clone()
        },
    }
}

fn parse_lsjson_batch(
    items: &[LsjsonItem],
    remote_name: &str,
    provider: &str,
) -> Result<Vec<UnifiedItem>, String> {
    parse_unified_items(
        &serde_json::to_string(items)
            .map_err(|error| format!("failed to serialize lsjson item batch: {error}"))?,
        remote_name,
        provider,
    )
}

fn spawn_onedrive_folder_workers(
    app: &AppHandle,
    config_path: &Path,
    remote_name: &str,
    provider: &str,
    folders: Vec<OneDriveFolderTarget>,
) -> mpsc::Receiver<Result<UnifiedLibraryResult, String>> {
    let (sender, receiver) = mpsc::channel();

    if folders.is_empty() {
        drop(sender);
        return receiver;
    }

    let queue = Arc::new(Mutex::new(VecDeque::from(folders)));
    let worker_count = queue
        .lock()
        .map(|guard| guard.len().min(4))
        .unwrap_or_default();

    for _ in 0..worker_count {
        let sender = sender.clone();
        let queue = queue.clone();
        let app = app.clone();
        let config_path = config_path.to_path_buf();
        let remote_name = remote_name.to_string();
        let provider = provider.to_string();

        thread::spawn(move || loop {
            let folder = match queue.lock() {
                Ok(mut guard) => guard.pop_front(),
                Err(_) => None,
            };

            let Some(folder) = folder else {
                break;
            };

            let result =
                load_onedrive_folder_batch(&app, &config_path, &remote_name, &provider, folder);

            if sender.send(result).is_err() {
                break;
            }
        });
    }

    drop(sender);
    receiver
}

fn load_onedrive_folder_batch(
    app: &AppHandle,
    config_path: &Path,
    remote_name: &str,
    provider: &str,
    folder: OneDriveFolderTarget,
) -> Result<UnifiedLibraryResult, String> {
    match run_rclone_owned(
        app,
        &[
            "lsjson".to_string(),
            folder.target.clone(),
            "-R".to_string(),
            "--files-only".to_string(),
            "--config".to_string(),
            config_path.to_string_lossy().into_owned(),
        ],
        INVENTORY_COMMAND_TIMEOUT,
    ) {
        Ok(output) => {
            let mut nested_items = parse_unified_items(&output, remote_name, provider)?;
            prefix_unified_item_paths(&mut nested_items, &folder.path_label);

            log::debug!(
                "onedrive folder batch loaded remote={} folder={} items={}",
                remote_name,
                folder.path_label,
                nested_items.len()
            );

            Ok(UnifiedLibraryResult {
                items: nested_items,
                notices: Vec::new(),
            })
        }
        Err(error) => {
            log::warn!(
                "skipping onedrive folder remote={} folder={} reason={}",
                remote_name,
                folder.path_label,
                summarize_output(&error)
            );

            Ok(UnifiedLibraryResult {
                items: Vec::new(),
                notices: vec![
                    "Some protected or unsupported OneDrive folders were skipped.".to_string(),
                ],
            })
        }
    }
}

fn list_onedrive_drive_candidates_impl(
    app: AppHandle,
    name: String,
) -> Result<Vec<OneDriveDriveCandidate>, String> {
    validate_remote_name(&name)?;
    load_onedrive_drive_candidates(&app, &name)
}

fn finalize_onedrive_remote_impl(
    app: AppHandle,
    name: String,
    drive_id: String,
) -> Result<CreateRemoteResult, String> {
    validate_remote_name(&name)?;

    let config_path = ensure_rclone_config(&app)?;
    let candidates = load_onedrive_drive_candidates(&app, &name)?;
    let candidate = candidates
        .into_iter()
        .find(|entry| entry.id == drive_id)
        .ok_or_else(|| "The selected OneDrive drive is no longer available.".to_string())?;

    apply_onedrive_drive_selection(&app, &name, &candidate, &config_path)
}

fn delete_remote_impl(app: AppHandle, name: String) -> Result<ActionResult, String> {
    validate_remote_name(&name)?;

    let config_path = ensure_rclone_config(&app)?;
    let owned_args = vec![
        "config".to_string(),
        "delete".to_string(),
        name.clone(),
        "--config".to_string(),
        config_path.to_string_lossy().into_owned(),
    ];

    match run_rclone_owned(&app, &owned_args, DEFAULT_COMMAND_TIMEOUT) {
        Ok(_) => {
            remove_auth_session_record(&app, &name);
            Ok(ActionResult {
                status: "success".to_string(),
                message: format!("{name} was removed."),
            })
        }
        Err(error) => Ok(ActionResult {
            status: "error".to_string(),
            message: user_facing_command_error(&error),
        }),
    }
}

fn start_download_impl(
    app: AppHandle,
    input: StartDownloadInput,
) -> Result<DownloadAcceptedResult, String> {
    validate_remote_name(&input.source_remote)?;

    if input.download_id.trim().is_empty() {
        return Err("Download ID is required.".to_string());
    }

    if input.source_path.trim().is_empty() {
        return Err("Source path is required.".to_string());
    }

    let downloads_dir = resolve_downloads_dir(&app)?;
    let file_name = select_download_file_name(&input.display_name, &input.source_path);
    let target_path = resolve_unique_download_target(&downloads_dir, &file_name);
    let target_path_label = target_path.to_string_lossy().into_owned();
    let download_id = input.download_id.clone();

    emit_download_progress(
        &app,
        DownloadProgressEvent {
            download_id: download_id.clone(),
            status: "queued".to_string(),
            progress_percent: Some(0.0),
            bytes_transferred: Some(0),
            total_bytes: input.size,
            target_path: Some(target_path_label.clone()),
            error_message: None,
        },
    );

    spawn_download_task(app, input, target_path.clone());

    Ok(DownloadAcceptedResult {
        download_id,
        status: "accepted".to_string(),
        target_path: target_path_label,
    })
}

fn prepare_open_file_impl(
    app: AppHandle,
    input: PrepareOpenFileInput,
) -> Result<PrepareOpenFileResult, String> {
    validate_remote_name(&input.source_remote)?;

    if input.request_id.trim().is_empty() {
        return Err("Open request ID is required.".to_string());
    }

    if input.source_path.trim().is_empty() {
        return Err("Source path is required.".to_string());
    }

    let Some(open_mode) = select_open_mode(input.mime_type.as_deref(), input.extension.as_deref()) else {
        return Err("Open is only available for previewable files and supported documents.".to_string());
    };

    let config_path = ensure_rclone_config(&app)?;
    let temp_dir = resolve_open_temp_dir(&app)?;
    let target_path = resolve_open_cache_target(&temp_dir, &input.display_name, &input);

    if !target_path.exists() {
        let source = format!("{}:{}", input.source_remote, input.source_path);
        let args = vec![
            "copyto".to_string(),
            source,
            target_path.to_string_lossy().into_owned(),
            "--local-no-set-modtime".to_string(),
            "--config".to_string(),
            config_path.to_string_lossy().into_owned(),
        ];

        run_rclone_owned(&app, &args, INVENTORY_COMMAND_TIMEOUT)
            .map_err(|error| user_facing_open_error(&error))?;
    }

    Ok(PrepareOpenFileResult {
        request_id: input.request_id,
        status: "ready".to_string(),
        local_path: target_path.to_string_lossy().into_owned(),
        open_mode: open_mode.to_string(),
    })
}

fn spawn_download_task(app: AppHandle, input: StartDownloadInput, target_path: PathBuf) {
    thread::spawn(move || {
        let target_path_label = target_path.to_string_lossy().into_owned();

        let config_path = match ensure_rclone_config(&app) {
            Ok(path) => path,
            Err(error) => {
                emit_download_progress(
                    &app,
                    DownloadProgressEvent {
                        download_id: input.download_id.clone(),
                        status: "failed".to_string(),
                        progress_percent: None,
                        bytes_transferred: None,
                        total_bytes: input.size,
                        target_path: Some(target_path_label),
                        error_message: Some(error),
                    },
                );
                return;
            }
        };

        let source = format!("{}:{}", input.source_remote, input.source_path);
        let args = vec![
            "copyto".to_string(),
            source,
            target_path.to_string_lossy().into_owned(),
            "--local-no-set-modtime".to_string(),
            "--config".to_string(),
            config_path.to_string_lossy().into_owned(),
        ];

        log::debug!(
            "starting download download_id={} source={} target={} local_no_set_modtime=true",
            input.download_id,
            input.source_path,
            target_path.to_string_lossy()
        );

        let child = match spawn_rclone_owned(&app, &args) {
            Ok(child) => child,
            Err(error) => {
                emit_download_progress(
                    &app,
                    DownloadProgressEvent {
                        download_id: input.download_id.clone(),
                        status: "failed".to_string(),
                        progress_percent: None,
                        bytes_transferred: None,
                        total_bytes: input.size,
                        target_path: Some(target_path_label),
                        error_message: Some(user_facing_download_error(&error)),
                    },
                );
                return;
            }
        };

        emit_download_progress(
            &app,
            DownloadProgressEvent {
                download_id: input.download_id.clone(),
                status: "running".to_string(),
                progress_percent: Some(0.0),
                bytes_transferred: Some(0),
                total_bytes: input.size,
                target_path: Some(target_path.to_string_lossy().into_owned()),
                error_message: None,
            },
        );

        let stop = Arc::new(AtomicBool::new(false));
        let watcher = spawn_download_progress_watcher(
            app.clone(),
            input.download_id.clone(),
            target_path.clone(),
            input.size,
            stop.clone(),
        );

        let result = collect_child_output(child);

        stop.store(true, Ordering::Relaxed);
        let _ = watcher.join();

        match result {
            Ok(_) => {
                let bytes_transferred = fs::metadata(&target_path).map(|meta| meta.len()).ok();
                let progress_percent = completion_progress(bytes_transferred, input.size);

                emit_download_progress(
                    &app,
                    DownloadProgressEvent {
                        download_id: input.download_id,
                        status: "succeeded".to_string(),
                        progress_percent,
                        bytes_transferred,
                        total_bytes: input.size,
                        target_path: Some(target_path.to_string_lossy().into_owned()),
                        error_message: None,
                    },
                );
            }
            Err(error) => {
                let bytes_transferred = fs::metadata(&target_path).map(|meta| meta.len()).ok();
                let _ = fs::remove_file(&target_path);

                emit_download_progress(
                    &app,
                    DownloadProgressEvent {
                        download_id: input.download_id,
                        status: "failed".to_string(),
                        progress_percent: completion_progress(bytes_transferred, input.size),
                        bytes_transferred,
                        total_bytes: input.size,
                        target_path: Some(target_path.to_string_lossy().into_owned()),
                        error_message: Some(user_facing_download_error(&error)),
                    },
                );
            }
        }
    });
}

fn spawn_download_progress_watcher(
    app: AppHandle,
    download_id: String,
    target_path: PathBuf,
    total_bytes: Option<u64>,
    stop: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut first_tick = true;
        let mut last_bytes = None;

        loop {
            let bytes_transferred = fs::metadata(&target_path)
                .map(|meta| meta.len())
                .unwrap_or(0);

            if first_tick || Some(bytes_transferred) != last_bytes {
                emit_download_progress(
                    &app,
                    DownloadProgressEvent {
                        download_id: download_id.clone(),
                        status: "running".to_string(),
                        progress_percent: completion_progress(Some(bytes_transferred), total_bytes),
                        bytes_transferred: Some(bytes_transferred),
                        total_bytes,
                        target_path: Some(target_path.to_string_lossy().into_owned()),
                        error_message: None,
                    },
                );
                first_tick = false;
                last_bytes = Some(bytes_transferred);
            }

            if stop.load(Ordering::Relaxed) {
                break;
            }

            thread::sleep(DOWNLOAD_POLL_INTERVAL);
        }
    })
}

fn validate_remote_after_setup(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
) -> Result<RemoteValidationResult, String> {
    let config_path = ensure_rclone_config(app)?;
    let remote_config_by_name = load_remote_config_states(app, &config_path)?;
    let config_state = remote_config_by_name.get(remote_name).cloned();

    let remote_exists = config_state.is_some();
    let config_state = config_state.unwrap_or_else(default_remote_config_state);
    let has_drive_id = config_state.drive_id.is_some();
    let has_drive_type = config_state.drive_type.is_some();

    let mut can_list = false;
    let mut failure_reason = None;

    if !remote_exists {
        failure_reason = Some("The remote section was not saved to config.".to_string());
    } else if provider == "onedrive" && (!has_drive_id || !has_drive_type) {
        failure_reason = Some(
            "Authentication finished, but Cloud Weave could not complete OneDrive drive setup."
                .to_string(),
        );
    } else {
        let owned_args = vec![
            "lsd".to_string(),
            format!("{remote_name}:"),
            "--config".to_string(),
            config_path.to_string_lossy().into_owned(),
        ];

        match run_rclone_owned(app, &owned_args, DEFAULT_COMMAND_TIMEOUT) {
            Ok(_) => {
                can_list = true;
            }
            Err(error) => {
                failure_reason = Some(user_facing_command_error(&error));
            }
        }
    }

    let result = RemoteValidationResult {
        provider: config_state.provider.clone(),
        remote_exists,
        has_drive_id,
        has_drive_type,
        can_list,
        failure_reason,
    };

    log_remote_validation(remote_name, &result);

    Ok(result)
}

fn log_remote_validation(remote_name: &str, validation: &RemoteValidationResult) {
    log::info!(
        "onedrive validation remote={} provider={} remote_exists={} has_drive_id={} has_drive_type={} can_list={} failure_reason={}",
        remote_name,
        validation.provider,
        validation.remote_exists,
        validation.has_drive_id,
        validation.has_drive_type,
        validation.can_list,
        validation.failure_reason.as_deref().unwrap_or("none")
    );
}

fn start_auth_flow(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    mode: &str,
    args: &[String],
) -> Result<CreateRemoteResult, String> {
    log::info!(
        "starting auth flow remote={} provider={} mode={} args={}",
        remote_name,
        provider,
        mode,
        redact_args(args)
    );

    if let Some(existing) = get_auth_session_record(app, remote_name) {
        if existing.status == "pending" {
            return Ok(CreateRemoteResult {
                remote_name: remote_name.to_string(),
                provider: provider.to_string(),
                status: "pending".to_string(),
                next_step: "open_browser".to_string(),
                message: "Authentication is already in progress for this storage.".to_string(),
                drive_candidates: None,
            });
        }
    }

    let mut child = spawn_rclone_owned(app, args)?;
    thread::sleep(AUTH_START_GRACE_PERIOD);

    match child.try_wait() {
        Ok(Some(_)) => match collect_child_output(child) {
            Ok(stdout) => build_success_result(app, remote_name, provider, mode, &stdout),
            Err(error) => build_auth_error_result(app, remote_name, provider, mode, &error),
        },
        Ok(None) => {
            let pending = pending_auth_session(
                remote_name,
                provider,
                mode,
                "Complete authentication in your browser to finish connecting this storage.",
            );
            set_auth_session_record(app, pending);
            spawn_auth_watcher(
                app.clone(),
                child,
                remote_name.to_string(),
                provider.to_string(),
                mode.to_string(),
            );

            Ok(CreateRemoteResult {
                remote_name: remote_name.to_string(),
                provider: provider.to_string(),
                status: "pending".to_string(),
                next_step: "open_browser".to_string(),
                message:
                    "Authentication started in your browser. Return here after you finish signing in."
                        .to_string(),
                drive_candidates: None,
            })
        }
        Err(error) => {
            kill_child(&mut child);
            Err(format!("failed while checking rclone process: {error}"))
        }
    }
}

fn spawn_auth_watcher(
    app: AppHandle,
    mut child: Child,
    remote_name: String,
    provider: String,
    mode: String,
) {
    thread::spawn(move || {
        let start = Instant::now();

        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    match collect_child_output(child) {
                        Ok(stdout) => {
                            if let Ok(result) =
                                build_success_result(&app, &remote_name, &provider, &mode, &stdout)
                            {
                                let record = AuthSessionRecord {
                                    remote_name: result.remote_name,
                                    provider: result.provider,
                                    mode: mode.clone(),
                                    status: result.status,
                                    next_step: result.next_step,
                                    message: result.message,
                                    drive_candidates: result.drive_candidates,
                                };
                                set_auth_session_record(&app, record);
                            }
                        }
                        Err(error) => {
                            if let Ok(result) = build_auth_error_result(
                                &app,
                                &remote_name,
                                &provider,
                                &mode,
                                &error,
                            ) {
                                let record = AuthSessionRecord {
                                    remote_name: result.remote_name,
                                    provider: result.provider,
                                    mode: mode.clone(),
                                    status: result.status,
                                    next_step: result.next_step,
                                    message: result.message,
                                    drive_candidates: result.drive_candidates,
                                };
                                set_auth_session_record(&app, record);
                            }
                        }
                    }

                    break;
                }
                Ok(None) => {
                    if start.elapsed() >= AUTH_COMMAND_TIMEOUT {
                        kill_child(&mut child);
                        let record = error_auth_session(
                            &remote_name,
                            &provider,
                            &mode,
                            "Authentication was not completed in time. Try again when you are ready.",
                        );
                        set_auth_session_record(&app, record);
                        break;
                    }
                }
                Err(_) => {
                    kill_child(&mut child);
                    let record = error_auth_session(
                        &remote_name,
                        &provider,
                        &mode,
                        "Authentication could not be completed. Try again.",
                    );
                    set_auth_session_record(&app, record);
                    break;
                }
            }

            thread::sleep(POLL_INTERVAL);
        }
    });
}

fn build_auth_error_result(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    mode: &str,
    error: &str,
) -> Result<CreateRemoteResult, String> {
    log::warn!(
        "auth flow failed remote={} provider={} mode={} error={}",
        remote_name,
        provider,
        mode,
        summarize_output(error)
    );

    let result = match classify_rclone_error(error) {
        RcloneErrorKind::DuplicateRemote => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "error".to_string(),
            next_step: "rename".to_string(),
            message: "A storage connection with that name already exists. Choose a different remote name."
                .to_string(),
            drive_candidates: None,
        },
        RcloneErrorKind::AuthCancelled => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "error".to_string(),
            next_step: "retry".to_string(),
            message: "Authentication was not completed. You can try again when you are ready."
                .to_string(),
            drive_candidates: None,
        },
        RcloneErrorKind::AuthFlow => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "pending".to_string(),
            next_step: "open_browser".to_string(),
            message: "Authentication is still in progress in your browser.".to_string(),
            drive_candidates: None,
        },
        RcloneErrorKind::RcloneUnavailable => {
            return Err(
                "The bundled rclone binary could not be found. Run the rclone setup step and restart the app."
                    .to_string(),
            )
        }
        RcloneErrorKind::Other => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "error".to_string(),
            next_step: "retry".to_string(),
            message: user_facing_command_error(error),
            drive_candidates: None,
        },
    };

    let session = AuthSessionRecord {
        remote_name: result.remote_name.clone(),
        provider: result.provider.clone(),
        mode: mode.to_string(),
        status: result.status.clone(),
        next_step: result.next_step.clone(),
        message: result.message.clone(),
        drive_candidates: result.drive_candidates.clone(),
    };
    set_auth_session_record(app, session);

    Ok(result)
}

fn build_success_result(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    mode: &str,
    stdout: &str,
) -> Result<CreateRemoteResult, String> {
    log::info!(
        "auth flow finished remote={} provider={} mode={} stdout={}",
        remote_name,
        provider,
        mode,
        summarize_output(stdout)
    );

    let result = if provider == "onedrive" {
        match build_onedrive_post_auth_result(app, remote_name, provider, mode, stdout) {
            Ok(result) => result,
            Err(error) => {
                log::warn!(
                    "onedrive post-auth finalization failed remote={} error={}",
                    remote_name,
                    summarize_output(&error)
                );

                CreateRemoteResult {
                    remote_name: remote_name.to_string(),
                    provider: provider.to_string(),
                    status: "error".to_string(),
                    next_step: "retry".to_string(),
                    message: error,
                    drive_candidates: None,
                }
            }
        }
    } else {
        let validation = validate_remote_after_setup(app, remote_name, provider)?;

        if validation.remote_exists && validation.can_list {
            CreateRemoteResult {
                remote_name: remote_name.to_string(),
                provider: provider.to_string(),
                status: "connected".to_string(),
                next_step: "done".to_string(),
                message: success_message(stdout),
                drive_candidates: None,
            }
        } else {
            CreateRemoteResult {
                remote_name: remote_name.to_string(),
                provider: provider.to_string(),
                status: "error".to_string(),
                next_step: "retry".to_string(),
                message: validation.failure_reason.unwrap_or_else(|| {
                    "This storage connection is incomplete. Try again.".to_string()
                }),
                drive_candidates: None,
            }
        }
    };

    let session = AuthSessionRecord {
        remote_name: result.remote_name.clone(),
        provider: result.provider.clone(),
        mode: mode.to_string(),
        status: result.status.clone(),
        next_step: result.next_step.clone(),
        message: result.message.clone(),
        drive_candidates: result.drive_candidates.clone(),
    };
    set_auth_session_record(app, session);

    Ok(result)
}

fn build_onedrive_post_auth_result(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    _mode: &str,
    stdout: &str,
) -> Result<CreateRemoteResult, String> {
    let validation = validate_remote_after_setup(app, remote_name, provider)?;

    if validation.remote_exists
        && validation.can_list
        && validation.has_drive_id
        && validation.has_drive_type
    {
        return Ok(CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "connected".to_string(),
            next_step: "done".to_string(),
            message: success_message(stdout),
            drive_candidates: None,
        });
    }

    let config_path = ensure_rclone_config(app)?;
    let candidates = load_onedrive_drive_candidates(app, remote_name)?;

    if let Some(selected) = select_auto_onedrive_drive_candidate(&candidates) {
        log::info!(
            "auto-selecting onedrive drive remote={} drive_id={} label={} drive_type={}",
            remote_name,
            selected.id,
            selected.label,
            selected.drive_type
        );

        return apply_onedrive_drive_selection(app, remote_name, &selected, &config_path);
    }

    let reachable_candidates = candidates
        .iter()
        .filter(|candidate| candidate.is_reachable)
        .count();

    if reachable_candidates > 0 {
        return Ok(CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "requires_drive_selection".to_string(),
            next_step: "select_drive".to_string(),
            message: "Choose which OneDrive library Cloud Weave should browse for this account."
                .to_string(),
            drive_candidates: Some(candidates),
        });
    }

    Ok(CreateRemoteResult {
        remote_name: remote_name.to_string(),
        provider: provider.to_string(),
        status: "error".to_string(),
        next_step: "retry".to_string(),
        message: validation.failure_reason.unwrap_or_else(|| {
            "Cloud Weave finished browser authentication, but could not finalize this OneDrive library."
                .to_string()
        }),
        drive_candidates: Some(candidates),
    })
}

fn load_onedrive_drive_candidates(
    app: &AppHandle,
    remote_name: &str,
) -> Result<Vec<OneDriveDriveCandidate>, String> {
    let config_path = ensure_rclone_config(app)?;
    let remote_config_by_name = load_remote_config_states(app, &config_path)?;
    let config_state = remote_config_by_name
        .get(remote_name)
        .cloned()
        .ok_or_else(|| format!("The OneDrive remote {remote_name} was not found in config."))?;

    if config_state.provider != "onedrive" {
        return Err("Drive discovery is only supported for OneDrive remotes.".to_string());
    }

    let token_json = config_state
        .token
        .ok_or_else(|| "Cloud Weave could not find the saved OneDrive access token.".to_string())?;
    let access_token = parse_access_token(&token_json)?;
    let client = Client::builder()
        .timeout(GRAPH_COMMAND_TIMEOUT)
        .build()
        .map_err(|error| format!("failed to create Microsoft Graph client: {error}"))?;

    let response = client
        .get(format!("{GRAPH_BASE_URL}/me/drives"))
        .bearer_auth(&access_token)
        .send()
        .map_err(|error| format!("failed to query Microsoft Graph drives: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!(
            "failed to query Microsoft Graph drives: {}",
            summarize_graph_error(status.as_u16(), &body)
        ));
    }

    let drive_list = response
        .json::<GraphDriveListResponse>()
        .map_err(|error| format!("failed to parse Microsoft Graph drives response: {error}"))?;

    let raw_candidates = drive_list
        .value
        .into_iter()
        .map(|drive| validate_graph_drive_candidate(&client, &access_token, drive))
        .collect::<Vec<_>>();

    Ok(normalize_onedrive_drive_candidates(raw_candidates))
}

fn validate_graph_drive_candidate(
    client: &Client,
    access_token: &str,
    drive: GraphDrive,
) -> OneDriveDriveCandidate {
    let label = drive
        .name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| drive.id.clone());
    let is_system_like = is_system_like_onedrive_drive_label(&label);
    let is_suggested = label == "OneDrive" && drive.drive_type == "personal";

    let response = client
        .get(format!("{GRAPH_BASE_URL}/drives/{}/root", drive.id))
        .bearer_auth(access_token)
        .send();

    match response {
        Ok(response) if response.status().is_success() => OneDriveDriveCandidate {
            id: drive.id,
            label,
            drive_type: drive.drive_type,
            is_reachable: true,
            is_system_like,
            is_suggested,
            message: None,
        },
        Ok(response) => {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            OneDriveDriveCandidate {
                id: drive.id,
                label,
                drive_type: drive.drive_type,
                is_reachable: false,
                is_system_like,
                is_suggested,
                message: Some(summarize_graph_error(status.as_u16(), &body)),
            }
        }
        Err(error) => OneDriveDriveCandidate {
            id: drive.id,
            label,
            drive_type: drive.drive_type,
            is_reachable: false,
            is_system_like,
            is_suggested,
            message: Some(format!("Could not validate this drive: {error}")),
        },
    }
}

fn parse_access_token(token_json: &str) -> Result<String, String> {
    serde_json::from_str::<OAuthTokenPayload>(token_json)
        .map(|payload| payload.access_token)
        .map_err(|error| format!("failed to parse saved OneDrive token: {error}"))
}

fn summarize_graph_error(status: u16, body: &str) -> String {
    let message = serde_json::from_str::<GraphErrorResponse>(body)
        .ok()
        .and_then(|payload| payload.error.message)
        .unwrap_or_else(|| body.trim().to_string());

    if message.is_empty() {
        format!("Microsoft Graph returned HTTP {status}.")
    } else {
        format!("Microsoft Graph returned HTTP {status}: {message}")
    }
}

fn apply_onedrive_drive_selection(
    app: &AppHandle,
    remote_name: &str,
    candidate: &OneDriveDriveCandidate,
    config_path: &Path,
) -> Result<CreateRemoteResult, String> {
    let owned_args = vec![
        "config".to_string(),
        "update".to_string(),
        remote_name.to_string(),
        format!("drive_id={}", candidate.id),
        format!("drive_type={}", candidate.drive_type),
        "--config".to_string(),
        config_path.to_string_lossy().into_owned(),
    ];

    log::info!(
        "finalizing onedrive drive remote={} drive_id={} drive_type={} label={}",
        remote_name,
        candidate.id,
        candidate.drive_type,
        candidate.label
    );

    run_rclone_owned(app, &owned_args, DEFAULT_COMMAND_TIMEOUT)?;

    let validation = validate_remote_after_setup(app, remote_name, "onedrive")?;

    if validation.remote_exists
        && validation.can_list
        && validation.has_drive_id
        && validation.has_drive_type
    {
        return Ok(CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: "onedrive".to_string(),
            status: "connected".to_string(),
            next_step: "done".to_string(),
            message: format!("Connected to {}.", candidate.label),
            drive_candidates: None,
        });
    }

    Ok(CreateRemoteResult {
        remote_name: remote_name.to_string(),
        provider: "onedrive".to_string(),
        status: "error".to_string(),
        next_step: "retry".to_string(),
        message: validation.failure_reason.unwrap_or_else(|| {
            "Cloud Weave saved the selected drive, but it still could not browse it.".to_string()
        }),
        drive_candidates: None,
    })
}

fn redact_args(args: &[String]) -> String {
    args.iter()
        .map(|arg| {
            if arg.starts_with("token=") {
                "token=<redacted>".to_string()
            } else if arg.starts_with("client_secret=") {
                "client_secret=<redacted>".to_string()
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn summarize_output(output: &str) -> String {
    let normalized = output.split_whitespace().collect::<Vec<_>>().join(" ");
    let redacted = normalized
        .replace("\"access_token\":\"", "\"access_token\":\"<redacted>")
        .replace("\"refresh_token\":\"", "\"refresh_token\":\"<redacted>");

    if redacted.len() > 220 {
        format!("{}...", &redacted[..220])
    } else {
        redacted
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(AuthSessionStore::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(error) = cleanup_stale_open_temp_files(&handle) {
                log::warn!("failed to clean stale open file cache: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_storage_remotes,
            create_onedrive_remote,
            list_unified_items,
            reconnect_remote,
            list_onedrive_drive_candidates,
            finalize_onedrive_remote,
            get_auth_session_status,
            delete_remote,
            start_download,
            prepare_open_file,
            start_unified_library_load
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn ensure_rclone_config(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;

    let config_path = app_data_dir.join("rclone.conf");

    if !config_path.exists() {
        fs::write(&config_path, "")
            .map_err(|error| format!("failed to initialize rclone config file: {error}"))?;
    }

    Ok(config_path)
}

fn resolve_downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|error| format!("failed to resolve the Downloads folder: {error}"))?;

    fs::create_dir_all(&downloads_dir)
        .map_err(|error| format!("failed to prepare the Downloads folder: {error}"))?;

    Ok(downloads_dir)
}

fn resolve_open_temp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let temp_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve the app data directory: {error}"))?
        .join("open-cache");

    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("failed to prepare the open file cache: {error}"))?;

    Ok(temp_dir)
}

fn select_download_file_name(display_name: &str, source_path: &str) -> String {
    let display_candidate = Path::new(display_name)
        .components()
        .rev()
        .find_map(component_to_normal_path_part);
    let source_candidate = Path::new(source_path)
        .components()
        .rev()
        .find_map(component_to_normal_path_part);

    display_candidate
        .or(source_candidate)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "downloaded-file".to_string())
}

fn component_to_normal_path_part(component: Component<'_>) -> Option<String> {
    match component {
        Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
        _ => None,
    }
}

fn resolve_unique_download_target(downloads_dir: &Path, file_name: &str) -> PathBuf {
    let direct_path = downloads_dir.join(file_name);

    if !direct_path.exists() {
        return direct_path;
    }

    let candidate_path = Path::new(file_name);
    let stem = candidate_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "downloaded-file".to_string());
    let extension = candidate_path
        .extension()
        .map(|value| value.to_string_lossy().into_owned());

    for index in 1.. {
        let next_name = match extension.as_deref() {
            Some(ext) => format!("{stem} ({index}).{ext}"),
            None => format!("{stem} ({index})"),
        };
        let next_path = downloads_dir.join(next_name);

        if !next_path.exists() {
            return next_path;
        }
    }

    unreachable!("the loop above always returns once an unused path is found")
}

fn resolve_open_cache_target(
    open_temp_dir: &Path,
    display_name: &str,
    input: &PrepareOpenFileInput,
) -> PathBuf {
    let base_name = select_download_file_name(display_name, &input.source_path);
    let candidate_path = Path::new(&base_name);
    let stem = candidate_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "open-file".to_string());
    let extension = candidate_path
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .or_else(|| input.extension.clone().filter(|value| !value.trim().is_empty()));

    let sanitized_stem = sanitize_file_name_component(&stem);
    let cache_key = build_open_cache_key(&input.source_remote, &input.source_path);
    let file_name = match extension.as_deref().filter(|value| !value.is_empty()) {
        Some(extension) => format!("{sanitized_stem}-{cache_key}.{extension}"),
        None => format!("{sanitized_stem}-{cache_key}"),
    };

    open_temp_dir.join(file_name)
}

fn sanitize_file_name_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(48)
        .collect::<String>();

    if sanitized.is_empty() {
        "open-file".to_string()
    } else {
        sanitized
    }
}

fn build_open_cache_key(source_remote: &str, source_path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source_remote.hash(&mut hasher);
    source_path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn select_open_mode(mime_type: Option<&str>, extension: Option<&str>) -> Option<&'static str> {
    let normalized_mime = mime_type.unwrap_or_default().trim().to_ascii_lowercase();
    let normalized_extension = extension
        .unwrap_or_default()
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();

    if normalized_mime.starts_with("image/")
        || matches!(
            normalized_extension.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg"
        )
    {
        Some("preview-image")
    } else if normalized_mime == "application/pdf" || normalized_extension == "pdf" {
        Some("preview-pdf")
    } else if matches!(
        normalized_mime.as_str(),
        "text/plain"
            | "text/markdown"
            | "text/csv"
            | "application/json"
            | "application/msword"
            | "application/vnd.ms-excel"
            | "application/vnd.ms-powerpoint"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) || matches!(
        normalized_extension.as_str(),
        "txt" | "md" | "csv" | "json" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx"
    ) {
        Some("system-default")
    } else {
        None
    }
}

fn cleanup_stale_open_temp_files(app: &AppHandle) -> Result<(), String> {
    let temp_dir = resolve_open_temp_dir(app)?;
    let now = std::time::SystemTime::now();

    for entry in fs::read_dir(&temp_dir)
        .map_err(|error| format!("failed to read the open file cache: {error}"))?
    {
        let Ok(entry) = entry else {
            continue;
        };

        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if !metadata.is_file() {
            continue;
        }

        let Ok(modified_at) = metadata.modified() else {
            continue;
        };

        let Ok(age) = now.duration_since(modified_at) else {
            continue;
        };

        if age >= OPEN_TEMP_MAX_AGE {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

fn emit_download_progress(app: &AppHandle, event: DownloadProgressEvent) {
    if let Err(error) = app.emit(DOWNLOAD_PROGRESS_EVENT, event) {
        log::warn!("failed to emit download progress event: {error}");
    }
}

fn emit_library_progress(app: &AppHandle, event: UnifiedLibraryLoadEvent) {
    if let Err(error) = app.emit(LIBRARY_PROGRESS_EVENT, event) {
        log::warn!("failed to emit unified library progress event: {error}");
    }
}

fn completion_progress(bytes_transferred: Option<u64>, total_bytes: Option<u64>) -> Option<f64> {
    match (bytes_transferred, total_bytes) {
        (_, Some(0)) => Some(100.0),
        (Some(bytes), Some(total)) if total > 0 => {
            Some(((bytes as f64 / total as f64) * 100.0).clamp(0.0, 100.0))
        }
        _ => None,
    }
}

fn resolve_rclone_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("binaries").join(RCLONE_BINARY));
        candidates.push(resource_dir.join(RCLONE_BINARY));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(RCLONE_BINARY));
            candidates.push(exe_dir.join("binaries").join(RCLONE_BINARY));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(
            current_dir
                .join("src-tauri")
                .join("binaries")
                .join(RCLONE_BINARY),
        );
        candidates.push(current_dir.join("binaries").join(RCLONE_BINARY));
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| "rclone binary was not found in the expected locations".to_string())
}

fn run_rclone(
    app: &AppHandle,
    static_args: &[&str],
    path_args: &[&std::ffi::OsStr],
    timeout: Duration,
) -> Result<String, String> {
    let binary = resolve_rclone_binary(app)?;
    let mut command = Command::new(binary);
    command.args(static_args);
    command.args(path_args);
    execute_command(command, timeout)
}

fn run_rclone_owned(app: &AppHandle, args: &[String], timeout: Duration) -> Result<String, String> {
    let binary = resolve_rclone_binary(app)?;
    let mut command = Command::new(binary);
    command.args(args);
    execute_command(command, timeout)
}

fn spawn_rclone_owned(app: &AppHandle, args: &[String]) -> Result<Child, String> {
    let binary = resolve_rclone_binary(app)?;
    let mut command = Command::new(binary);
    command.args(args);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    command
        .spawn()
        .map_err(|error| format!("failed to run rclone: {error}"))
}

fn execute_command(mut command: Command, timeout: Duration) -> Result<String, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to run rclone: {error}"))?;

    let start = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_)) => return collect_child_output(child),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    kill_child(&mut child);
                    return Err(format!(
                        "operation timed out after {} seconds",
                        timeout.as_secs()
                    ));
                }
            }
            Err(error) => {
                kill_child(&mut child);
                return Err(format!("failed while waiting for rclone: {error}"));
            }
        }

        thread::sleep(POLL_INTERVAL);
    }
}

fn collect_child_output(child: Child) -> Result<String, String> {
    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to collect rclone output: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        let detail = if stderr.is_empty() { stdout } else { stderr };
        Err(detail)
    }
}

fn kill_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn load_remote_config_states(
    app: &AppHandle,
    config_path: &Path,
) -> Result<HashMap<String, RemoteConfigState>, String> {
    let config_text = run_rclone(
        app,
        &["config", "show", "--config"],
        &[config_path.as_os_str()],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    Ok(parse_remote_config_state_map(&config_text))
}

fn default_remote_config_state() -> RemoteConfigState {
    RemoteConfigState {
        provider: "unknown".to_string(),
        drive_id: None,
        drive_type: None,
        token: None,
    }
}

fn remote_status(config_state: &RemoteConfigState) -> &'static str {
    if config_state.provider == "onedrive"
        && (config_state.drive_id.is_none() || config_state.drive_type.is_none())
    {
        "error"
    } else {
        "connected"
    }
}

fn remote_status_message(config_state: &RemoteConfigState) -> Option<String> {
    if remote_status(config_state) == "error" {
        Some(
            "This OneDrive connection is incomplete. Reconnect it or remove it and connect again."
                .to_string(),
        )
    } else {
        None
    }
}

fn validate_remote_name(remote_name: &str) -> Result<(), String> {
    let trimmed = remote_name.trim();

    if trimmed.is_empty() {
        return Err("Remote name is required.".to_string());
    }

    if trimmed.contains(':') || trimmed.contains(' ') {
        return Err("Remote name cannot contain spaces or colons.".to_string());
    }

    Ok(())
}

fn success_message(stdout: &str) -> String {
    if stdout.trim().is_empty() {
        "The storage connection was saved successfully.".to_string()
    } else {
        "Your storage is connected and ready to use.".to_string()
    }
}

fn user_facing_command_error(detail: &str) -> String {
    if detail.is_empty() {
        "rclone could not complete the request. Try again.".to_string()
    } else {
        format!("rclone could not complete the request: {detail}")
    }
}

fn user_facing_download_error(detail: &str) -> String {
    match classify_rclone_error(detail) {
        RcloneErrorKind::RcloneUnavailable => {
            "The bundled rclone binary could not be found. Run the rclone setup step and restart the app."
                .to_string()
        }
        _ if detail.is_empty() => "The file could not be downloaded. Try again.".to_string(),
        _ => format!("The file could not be downloaded: {detail}"),
    }
}

fn user_facing_open_error(detail: &str) -> String {
    match classify_rclone_error(detail) {
        RcloneErrorKind::RcloneUnavailable => {
            "The bundled rclone binary could not be found. Run the rclone setup step and restart the app."
                .to_string()
        }
        _ if detail.is_empty() => "The file could not be prepared for preview. Try again.".to_string(),
        _ => format!("The file could not be prepared for preview: {detail}"),
    }
}

fn pending_auth_session(
    remote_name: &str,
    provider: &str,
    mode: &str,
    message: &str,
) -> AuthSessionRecord {
    AuthSessionRecord {
        remote_name: remote_name.to_string(),
        provider: provider.to_string(),
        mode: mode.to_string(),
        status: "pending".to_string(),
        next_step: "open_browser".to_string(),
        message: message.to_string(),
        drive_candidates: None,
    }
}

fn error_auth_session(
    remote_name: &str,
    provider: &str,
    mode: &str,
    message: &str,
) -> AuthSessionRecord {
    AuthSessionRecord {
        remote_name: remote_name.to_string(),
        provider: provider.to_string(),
        mode: mode.to_string(),
        status: "error".to_string(),
        next_step: "retry".to_string(),
        message: message.to_string(),
        drive_candidates: None,
    }
}

fn set_auth_session_record(app: &AppHandle, record: AuthSessionRecord) {
    let store = app.state::<AuthSessionStore>();
    let Ok(mut sessions) = store.sessions.lock() else {
        return;
    };
    sessions.insert(record.remote_name.clone(), record);
}

fn get_auth_session_record(app: &AppHandle, remote_name: &str) -> Option<AuthSessionRecord> {
    let store = app.state::<AuthSessionStore>();
    store
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(remote_name).cloned())
}

fn remove_auth_session_record(app: &AppHandle, remote_name: &str) {
    let store = app.state::<AuthSessionStore>();
    let Ok(mut sessions) = store.sessions.lock() else {
        return;
    };
    sessions.remove(remote_name);
}

#[cfg(test)]
mod tests {
    use super::{
        build_open_cache_key, completion_progress, resolve_unique_download_target,
        sanitize_file_name_component, select_download_file_name, select_open_mode,
        user_facing_download_error,
    };
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn select_download_file_name_prefers_leaf_name() {
        assert_eq!(
            select_download_file_name("folder/report.pdf", "docs/report.pdf"),
            "report.pdf"
        );
        assert_eq!(
            select_download_file_name("", "nested/photos/image.png"),
            "image.png"
        );
    }

    #[test]
    fn resolve_unique_download_target_appends_numeric_suffix() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let base_dir = std::env::temp_dir().join(format!("cloud-weave-download-test-{unique}"));

        fs::create_dir_all(&base_dir).expect("temp directory should be created");
        fs::write(base_dir.join("report.pdf"), b"first").expect("base file should be written");
        fs::write(base_dir.join("report (1).pdf"), b"second")
            .expect("suffix file should be written");

        let next = resolve_unique_download_target(&base_dir, "report.pdf");
        assert_eq!(
            next.file_name().and_then(|value| value.to_str()),
            Some("report (2).pdf")
        );

        fs::remove_dir_all(&base_dir).expect("temp directory should be removed");
    }

    #[test]
    fn completion_progress_uses_total_bytes() {
        assert_eq!(completion_progress(Some(25), Some(100)), Some(25.0));
        assert_eq!(completion_progress(Some(0), Some(0)), Some(100.0));
        assert_eq!(completion_progress(Some(50), None), None);
    }

    #[test]
    fn user_facing_download_error_falls_back_to_detail() {
        let message = user_facing_download_error("access denied");
        assert!(message.contains("access denied"));
    }

    #[test]
    fn select_open_mode_prefers_previewable_types() {
        assert_eq!(
            select_open_mode(Some("image/jpeg"), Some("jpg")),
            Some("preview-image")
        );
        assert_eq!(
            select_open_mode(Some("application/pdf"), Some("pdf")),
            Some("preview-pdf")
        );
        assert_eq!(
            select_open_mode(
                Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                Some("docx")
            ),
            Some("system-default")
        );
        assert_eq!(
            select_open_mode(Some("application/zip"), Some("zip")),
            None
        );
    }

    #[test]
    fn build_open_cache_key_is_stable() {
        let first = build_open_cache_key("onedrive-main", "folder/file.pdf");
        let second = build_open_cache_key("onedrive-main", "folder/file.pdf");
        let third = build_open_cache_key("onedrive-main", "folder/other.pdf");

        assert_eq!(first, second);
        assert_ne!(first, third);
    }

    #[test]
    fn sanitize_file_name_component_preserves_safe_characters() {
        assert_eq!(sanitize_file_name_component("report.v1"), "report.v1");
        assert_eq!(sanitize_file_name_component("bad name/?"), "bad-name");
    }
}
