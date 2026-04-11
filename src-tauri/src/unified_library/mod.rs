use std::{
    collections::VecDeque,
    path::Path,
    sync::mpsc,
    sync::{Arc, Mutex},
    thread,
};

use rclone_logic::{
    parse_listremotes, parse_lsjson_items, parse_unified_items, prefix_unified_item_paths,
    LsjsonItem, UnifiedItem, UnifiedLibraryResult,
};
use tauri::{AppHandle, Emitter};

use crate::{
    backend_common::{default_remote_config_state, ensure_rclone_config, summarize_output},
    ipc::events::LIBRARY_PROGRESS_EVENT,
    ipc::types::{StartUnifiedLibraryLoadResult, UnifiedLibraryLoadEvent},
    rclone_runtime::{
        load_remote_config_states, run_rclone, run_rclone_owned, DEFAULT_COMMAND_TIMEOUT,
        INVENTORY_COMMAND_TIMEOUT,
    },
};

mod load_stream;

use load_stream::LibraryLoadMessage;

#[derive(Clone, Debug)]
pub(crate) struct RemoteLoadTarget {
    pub(crate) name: String,
    pub(crate) provider: String,
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

#[tauri::command]
pub async fn list_unified_items(app: AppHandle) -> Result<UnifiedLibraryResult, String> {
    tauri::async_runtime::spawn_blocking(move || list_unified_items_impl(app))
        .await
        .map_err(|error| format!("failed to join unified item task: {error}"))?
}

#[tauri::command]
pub async fn start_unified_library_load(
    app: AppHandle,
) -> Result<StartUnifiedLibraryLoadResult, String> {
    tauri::async_runtime::spawn_blocking(move || start_unified_library_load_impl(app))
        .await
        .map_err(|error| format!("failed to join unified library stream task: {error}"))?
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

    load_stream::spawn_unified_library_load_thread(
        app,
        config_path,
        remotes,
        request_id.clone(),
        total_remotes,
    );

    Ok(StartUnifiedLibraryLoadResult {
        status: "accepted".to_string(),
        request_id,
        total_remotes,
    })
}

pub(crate) fn list_connected_remote_targets(
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

            (crate::remote_status(app, &remote_name, &config_state) == "connected").then_some(
                RemoteLoadTarget {
                    name: remote_name,
                    provider: config_state.provider,
                },
            )
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

fn emit_library_progress(app: &AppHandle, event: UnifiedLibraryLoadEvent) {
    if let Err(error) = app.emit(LIBRARY_PROGRESS_EVENT, event) {
        log::warn!("failed to emit unified library progress event: {error}");
    }
}
