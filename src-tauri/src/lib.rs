mod auth_flow;
mod auth_remotes;
mod auth_session;
mod backend_common;
mod diagnostics;
mod ipc;
mod providers;
mod remotes;
mod rclone_runtime;
mod transfers;
mod unified_library;

use rclone_logic::{classify_rclone_error, RcloneErrorKind, RemoteConfigState};
use tauri::{AppHandle, Manager};
use tauri_plugin_log::{Target, TargetKind};

use crate::{
    auth_remotes::{
        create_onedrive_remote, finalize_onedrive_remote, get_auth_session_status,
        list_onedrive_drive_candidates, reconnect_remote,
    },
    auth_session::{
        get_reconnect_request_record, reconnect_request_record, remove_reconnect_request_record,
        set_reconnect_request_record, AuthSessionStore, ReconnectRequestStore,
    },
    backend_common::resolve_app_log_dir,
    diagnostics::export_diagnostics,
    remotes::{delete_remote, list_storage_remotes},
    transfers::{
        prepare_open_file, prepare_upload_batch, start_download, start_upload_batch,
    },
    unified_library::{list_unified_items, start_unified_library_load},
};

const APP_LOG_FILE_BASENAME: &str = "cloud-weave";

pub fn run() {
    tauri::Builder::default()
        .manage(AuthSessionStore::default())
        .manage(ReconnectRequestStore::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .clear_targets()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some(APP_LOG_FILE_BASENAME.into()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            match resolve_app_log_dir(&handle) {
                Ok(log_dir) => {
                    log::info!("app logs will be written to {}", log_dir.display());
                }
                Err(error) => {
                    log::warn!("failed to confirm app log directory: {error}");
                }
            }

            if let Err(error) = crate::transfers::cleanup_stale_open_temp_files(&handle) {
                log::warn!("failed to clean stale open file cache: {error}");
            }

            #[cfg(windows)]
            {
                match app.get_webview_window("main") {
                    Some(main_window) => match app.default_window_icon().cloned() {
                        Some(icon) => {
                            if let Err(error) = main_window.set_icon(icon) {
                                log::warn!("failed to apply the default window icon: {error}");
                            }
                        }
                        None => {
                            log::warn!("default window icon is not available during setup");
                        }
                    },
                    None => {
                        log::warn!("main webview window was not available during setup");
                    }
                }
            }

            Ok(())
        })
        // Keep command registration centralized in one generate_handler site.
        .invoke_handler(tauri::generate_handler![
            list_storage_remotes,
            create_onedrive_remote,
            list_unified_items,
            reconnect_remote,
            list_onedrive_drive_candidates,
            finalize_onedrive_remote,
            get_auth_session_status,
            delete_remote,
            export_diagnostics,
            start_download,
            prepare_upload_batch,
            start_upload_batch,
            prepare_open_file,
            start_unified_library_load
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub(crate) fn mark_remote_reconnect_required(app: &AppHandle, remote_name: &str, detail: &str) {
    if classify_rclone_error(detail) != RcloneErrorKind::AuthError {
        return;
    }

    set_reconnect_request_record(
        app,
        reconnect_request_record(remote_name, "This storage needs to be reconnected."),
    );
}

pub(crate) fn remote_status(
    app: &AppHandle,
    remote_name: &str,
    config_state: &RemoteConfigState,
) -> &'static str {
    let needs_reconnect = get_reconnect_request_record(app, remote_name).is_some()
        || (config_state.provider == "onedrive"
            && (config_state.drive_id.is_none()
                || config_state.drive_type.is_none()
                || config_state
                    .token
                    .as_ref()
                    .map(|token| token.trim().is_empty())
                    .unwrap_or(true)));

    if needs_reconnect {
        "reconnect_required"
    } else {
        remove_reconnect_request_record(app, remote_name);
        "connected"
    }
}

pub(crate) fn remote_status_message(
    app: &AppHandle,
    remote_name: &str,
    config_state: &RemoteConfigState,
) -> Option<String> {
    if remote_status(app, remote_name, config_state) != "reconnect_required" {
        return None;
    }

    if config_state.provider == "onedrive"
        && (config_state.drive_id.is_none()
            || config_state.drive_type.is_none()
            || config_state
                .token
                .as_ref()
                .map(|token| token.trim().is_empty())
                .unwrap_or(true))
    {
        Some(
            "This OneDrive connection is incomplete. Reconnect it or remove it and connect again."
                .to_string(),
        )
    } else {
        get_reconnect_request_record(app, remote_name).map(|record| record.message)
    }
}

pub(crate) fn validate_remote_name(remote_name: &str) -> Result<(), String> {
    let trimmed = remote_name.trim();

    if trimmed.is_empty() {
        return Err("Remote name is required.".to_string());
    }

    if trimmed.contains(':') || trimmed.contains(' ') {
        return Err("Remote name cannot contain spaces or colons.".to_string());
    }

    Ok(())
}
