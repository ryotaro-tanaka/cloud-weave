use rclone_logic::{
    classify_rclone_error, is_system_like_onedrive_drive_label, normalize_onedrive_drive_candidates,
    parse_listremotes, parse_remote_config_state_map, parse_unified_items,
    select_auto_onedrive_drive_candidate, OneDriveDriveCandidate, RcloneErrorKind,
    RemoteConfigState, UnifiedItem,
};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const RCLONE_BINARY: &str = "rclone-x86_64-pc-windows-msvc.exe";
const AUTH_COMMAND_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const INVENTORY_COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
const POLL_INTERVAL: Duration = Duration::from_millis(250);
const AUTH_START_GRACE_PERIOD: Duration = Duration::from_millis(350);
const GRAPH_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const GRAPH_BASE_URL: &str = "https://graph.microsoft.com/v1.0";

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

#[derive(Clone, Debug)]
struct RemoteValidationResult {
    provider: String,
    remote_exists: bool,
    has_drive_id: bool,
    has_drive_type: bool,
    can_list: bool,
    failure_reason: Option<String>,
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
async fn list_unified_items(app: AppHandle) -> Result<Vec<UnifiedItem>, String> {
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

fn list_unified_items_impl(app: AppHandle) -> Result<Vec<UnifiedItem>, String> {
    let config_path = ensure_rclone_config(&app)?;
    let stdout = run_rclone(
        &app,
        &["listremotes", "--json", "--config"],
        &[config_path.as_os_str()],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    let remotes = parse_listremotes(&stdout)?;

    if remotes.is_empty() {
        return Ok(Vec::new());
    }

    let remote_config_by_name = load_remote_config_states(&app, &config_path)?;
    let mut items = Vec::new();

    for remote_name in remotes {
        let config_state = remote_config_by_name
            .get(&remote_name)
            .cloned()
            .unwrap_or_else(default_remote_config_state);

        if remote_status(&config_state) != "connected" {
            continue;
        }

        let mut owned_args = vec![
            "lsjson".to_string(),
            format!("{remote_name}:"),
            "-R".to_string(),
            "--files-only".to_string(),
            "--config".to_string(),
            config_path.to_string_lossy().into_owned(),
        ];

        let mut insert_at = 4;
        for exclude_pattern in personal_vault_exclude_patterns(&config_state.provider) {
            owned_args.insert(insert_at, "--exclude".to_string());
            owned_args.insert(insert_at + 1, exclude_pattern.to_string());
            insert_at += 2;
        }

        let output = run_rclone_owned(&app, &owned_args, INVENTORY_COMMAND_TIMEOUT)?;
        items.extend(parse_unified_items(
            &output,
            &remote_name,
            &config_state.provider,
        )?);
    }

    items.sort_by(|left, right| {
        left.source_remote
            .cmp(&right.source_remote)
            .then(left.source_path.cmp(&right.source_path))
    });

    Ok(items)
}

fn personal_vault_exclude_patterns(provider: &str) -> Vec<&'static str> {
    if provider == "onedrive" {
        vec![
            "/Personal Vault",
            "/Personal Vault/**",
            "/個人用 Vault",
            "/個人用 Vault/**",
        ]
    } else {
        Vec::new()
    }
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

    if validation.remote_exists && validation.can_list && validation.has_drive_id && validation.has_drive_type {
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

    if validation.remote_exists && validation.can_list && validation.has_drive_id && validation.has_drive_type {
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
        .invoke_handler(tauri::generate_handler![
            list_storage_remotes,
            create_onedrive_remote,
            list_unified_items,
            reconnect_remote,
            list_onedrive_drive_candidates,
            finalize_onedrive_remote,
            get_auth_session_status,
            delete_remote
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
