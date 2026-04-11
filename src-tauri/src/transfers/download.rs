use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use rclone_logic::{classify_rclone_error, RcloneErrorKind};
use tauri::{AppHandle, Emitter};

use crate::{
    auth_session::callback_unavailable_message,
    backend_common::ensure_rclone_config,
    ipc::events::DOWNLOAD_PROGRESS_EVENT,
    ipc::types::{DownloadProgressEvent, StartDownloadInput},
    rclone_runtime::{collect_child_output, spawn_rclone_owned},
};

pub(super) const DOWNLOAD_POLL_INTERVAL: Duration = Duration::from_millis(400);

pub(super) fn spawn_download_task(app: AppHandle, input: StartDownloadInput, target_path: PathBuf) {
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

pub(super) fn emit_download_progress(app: &AppHandle, event: DownloadProgressEvent) {
    if let Err(error) = app.emit(DOWNLOAD_PROGRESS_EVENT, event) {
        log::warn!("failed to emit download progress event: {error}");
    }
}

pub(super) fn select_download_file_name(display_name: &str, source_path: &str) -> String {
    let display_candidate = Path::new(display_name)
        .components()
        .rev()
        .find_map(super::component_to_normal_path_part);
    let source_candidate = Path::new(source_path)
        .components()
        .rev()
        .find_map(super::component_to_normal_path_part);

    display_candidate
        .or(source_candidate)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "downloaded-file".to_string())
}

pub(super) fn resolve_unique_download_target(downloads_dir: &Path, file_name: &str) -> PathBuf {
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

pub(super) fn completion_progress(bytes_transferred: Option<u64>, total_bytes: Option<u64>) -> Option<f64> {
    match (bytes_transferred, total_bytes) {
        (_, Some(0)) => Some(100.0),
        (Some(bytes), Some(total)) if total > 0 => {
            Some(((bytes as f64 / total as f64) * 100.0).clamp(0.0, 100.0))
        }
        _ => None,
    }
}

pub(super) fn user_facing_download_error(detail: &str) -> String {
    match classify_rclone_error(detail) {
        RcloneErrorKind::RcloneUnavailable => {
            "The bundled rclone binary could not be found. Run the rclone setup step and restart the app."
                .to_string()
        }
        RcloneErrorKind::AuthCallbackUnavailable => callback_unavailable_message(),
        _ if detail.is_empty() => "The file could not be downloaded. Try again.".to_string(),
        _ => format!("The file could not be downloaded: {detail}"),
    }
}
