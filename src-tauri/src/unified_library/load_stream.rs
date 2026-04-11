use std::{path::PathBuf, sync::mpsc, thread};

use rclone_logic::UnifiedItem;
use tauri::AppHandle;

use crate::{backend_common::user_facing_command_error, ipc::types::UnifiedLibraryLoadEvent};

use super::{
    emit_library_progress, load_items_for_remote, stream_onedrive_remote_batches, RemoteLoadTarget,
};

pub(super) enum LibraryLoadMessage {
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

/// Background thread: one worker per remote, channel aggregation, final `completed` emit.
pub(super) fn spawn_unified_library_load_thread(
    app: AppHandle,
    config_path: PathBuf,
    remotes: Vec<RemoteLoadTarget>,
    request_id: String,
    total_remotes: usize,
) {
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
                    crate::mark_remote_reconnect_required(&app_for_thread, &remote.name, &error);

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
}
