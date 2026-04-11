use std::{
    path::Path,
    thread,
};

use rclone_logic::{classify_rclone_error, parse_lsjson_items, RcloneErrorKind};
use tauri::{AppHandle, Emitter};

use crate::{
    backend_common::ensure_rclone_config,
    ipc::events::UPLOAD_PROGRESS_EVENT,
    ipc::types::{
        PreparedUploadCandidate, PreparedUploadItem, StartUploadBatchInput, UploadProgressEvent,
        UploadResultItem,
    },
    rclone_runtime::{run_rclone_owned, DEFAULT_COMMAND_TIMEOUT, INVENTORY_COMMAND_TIMEOUT},
};

use super::component_to_normal_path_part;

pub(super) fn spawn_upload_task(app: AppHandle, input: StartUploadBatchInput) {
    thread::spawn(move || {
        let total_count = input.items.len();
        let config_path = match ensure_rclone_config(&app) {
            Ok(path) => path,
            Err(error) => {
                for item in input.items {
                    emit_upload_progress(
                        &app,
                        UploadProgressEvent {
                            upload_id: input.upload_id.clone(),
                            item_id: item.item_id,
                            status: "failed".to_string(),
                            provider: None,
                            remote_name: None,
                            remote_path: None,
                            completed_count: Some(0),
                            total_count: Some(total_count),
                            error_message: Some(error.clone()),
                        },
                    );
                }
                return;
            }
        };

        let mut completed_count = 0usize;

        for item in input.items {
            emit_upload_progress(
                &app,
                UploadProgressEvent {
                    upload_id: input.upload_id.clone(),
                    item_id: item.item_id.clone(),
                    status: "queued".to_string(),
                    provider: None,
                    remote_name: None,
                    remote_path: None,
                    completed_count: Some(completed_count),
                    total_count: Some(total_count),
                    error_message: None,
                },
            );

            match upload_prepared_item(
                &app,
                &config_path,
                &input.upload_id,
                &item,
                completed_count,
                total_count,
            ) {
                Ok(_) => {
                    completed_count += 1;
                }
                Err(error) => {
                    emit_upload_progress(
                        &app,
                        UploadProgressEvent {
                            upload_id: input.upload_id.clone(),
                            item_id: item.item_id,
                            status: "failed".to_string(),
                            provider: None,
                            remote_name: None,
                            remote_path: None,
                            completed_count: Some(completed_count),
                            total_count: Some(total_count),
                            error_message: Some(error),
                        },
                    );
                }
            }
        }
    });
}

fn upload_prepared_item(
    app: &AppHandle,
    config_path: &Path,
    upload_id: &str,
    item: &PreparedUploadItem,
    completed_count: usize,
    total_count: usize,
) -> Result<UploadResultItem, String> {
    let mut last_error = None;

    for (index, candidate) in item.candidates.iter().enumerate() {
        let retrying = index > 0;

        if retrying {
            emit_upload_progress(
                app,
                UploadProgressEvent {
                    upload_id: upload_id.to_string(),
                    item_id: item.item_id.clone(),
                    status: "retrying".to_string(),
                    provider: Some(candidate.provider.clone()),
                    remote_name: Some(candidate.remote_name.clone()),
                    remote_path: None,
                    completed_count: Some(completed_count),
                    total_count: Some(total_count),
                    error_message: None,
                },
            );
        }

        match prepare_candidate_destination(app, config_path, item, candidate) {
            Ok(remote_path) => {
                emit_upload_progress(
                    app,
                    UploadProgressEvent {
                        upload_id: upload_id.to_string(),
                        item_id: item.item_id.clone(),
                        status: "running".to_string(),
                        provider: Some(candidate.provider.clone()),
                        remote_name: Some(candidate.remote_name.clone()),
                        remote_path: Some(remote_path.clone()),
                        completed_count: Some(completed_count),
                        total_count: Some(total_count),
                        error_message: None,
                    },
                );

                let upload_target = format!("{}:{}", candidate.remote_name, remote_path);
                let args = vec![
                    "copyto".to_string(),
                    item.original_local_path.clone(),
                    upload_target,
                    "--config".to_string(),
                    config_path.to_string_lossy().into_owned(),
                ];

                match run_rclone_owned(app, &args, INVENTORY_COMMAND_TIMEOUT) {
                    Ok(_) => {
                        let result = UploadResultItem {
                            item_id: item.item_id.clone(),
                            provider: candidate.provider.clone(),
                            remote_name: candidate.remote_name.clone(),
                            remote_path: remote_path.clone(),
                            category: item.category.clone(),
                            original_local_path: item.original_local_path.clone(),
                            relative_path: item.relative_path.clone(),
                            size: item.size,
                        };

                        emit_upload_progress(
                            app,
                            UploadProgressEvent {
                                upload_id: upload_id.to_string(),
                                item_id: item.item_id.clone(),
                                status: "succeeded".to_string(),
                                provider: Some(result.provider.clone()),
                                remote_name: Some(result.remote_name.clone()),
                                remote_path: Some(result.remote_path.clone()),
                                completed_count: Some(completed_count + 1),
                                total_count: Some(total_count),
                                error_message: None,
                            },
                        );

                        return Ok(result);
                    }
                    Err(error) => {
                        crate::mark_remote_reconnect_required(app, &candidate.remote_name, &error);
                        last_error = Some(upload_candidate_error_message(&error));
                    }
                }
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "The file could not be uploaded.".to_string()))
}

fn prepare_candidate_destination(
    app: &AppHandle,
    config_path: &Path,
    item: &PreparedUploadItem,
    candidate: &PreparedUploadCandidate,
) -> Result<String, String> {
    match super::remote_free_space(app, config_path, &candidate.remote_name) {
        Ok(Some(free_bytes)) if free_bytes < item.size => {
            return Err(format!(
                "{} does not have enough free space for {}.",
                candidate.remote_name, item.display_name
            ));
        }
        Ok(_) => {}
        Err(error) => match classify_rclone_error(&error) {
            RcloneErrorKind::UnsupportedAbout => {}
            _ => return Err(upload_candidate_error_message(&error)),
        },
    }

    let relative_path = item.relative_path.replace('\\', "/");
    let parent_path = Path::new(&relative_path).parent().and_then(|value| {
        let normalized = value
            .components()
            .filter_map(component_to_normal_path_part)
            .collect::<Vec<_>>()
            .join("/");
        (!normalized.is_empty()).then_some(normalized)
    });

    ensure_remote_directory(
        app,
        config_path,
        &candidate.remote_name,
        &candidate.base_path,
    )?;

    if let Some(parent_path) = parent_path {
        ensure_remote_directory(
            app,
            config_path,
            &candidate.remote_name,
            &join_remote_path(&candidate.base_path, &parent_path),
        )?;
    }

    resolve_unique_remote_upload_path(
        app,
        config_path,
        &candidate.remote_name,
        &candidate.base_path,
        &relative_path,
    )
}

fn ensure_remote_directory(
    app: &AppHandle,
    config_path: &Path,
    remote_name: &str,
    remote_path: &str,
) -> Result<(), String> {
    let args = vec![
        "mkdir".to_string(),
        format!("{}:{}", remote_name, remote_path.trim_matches('/')),
        "--config".to_string(),
        config_path.to_string_lossy().into_owned(),
    ];

    run_rclone_owned(app, &args, DEFAULT_COMMAND_TIMEOUT).map(|_| ())
}

fn resolve_unique_remote_upload_path(
    app: &AppHandle,
    config_path: &Path,
    remote_name: &str,
    base_path: &str,
    relative_path: &str,
) -> Result<String, String> {
    let direct_path = join_remote_path(base_path, relative_path);

    if !remote_path_exists(app, config_path, remote_name, &direct_path)? {
        return Ok(direct_path);
    }

    let relative_candidate = Path::new(relative_path);
    let parent_path = relative_candidate
        .parent()
        .and_then(|value| {
            let normalized = value
                .components()
                .filter_map(component_to_normal_path_part)
                .collect::<Vec<_>>()
                .join("/");
            (!normalized.is_empty()).then_some(normalized)
        })
        .unwrap_or_default();
    let file_name = relative_candidate
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "The upload path must end with a file name.".to_string())?;
    let file_path = Path::new(&file_name);
    let stem = file_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "uploaded-file".to_string());
    let extension = file_path
        .extension()
        .map(|value| value.to_string_lossy().into_owned());

    for index in 1.. {
        let next_name = match extension.as_deref() {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let relative_candidate = if parent_path.is_empty() {
            next_name
        } else {
            format!("{parent_path}/{next_name}")
        };
        let remote_candidate = join_remote_path(base_path, &relative_candidate);

        if !remote_path_exists(app, config_path, remote_name, &remote_candidate)? {
            return Ok(remote_candidate);
        }
    }

    unreachable!("remote conflict resolution always returns once an unused path is found")
}

fn remote_path_exists(
    app: &AppHandle,
    config_path: &Path,
    remote_name: &str,
    remote_path: &str,
) -> Result<bool, String> {
    let args = vec![
        "lsjson".to_string(),
        format!("{}:{}", remote_name, remote_path.trim_matches('/')),
        "--config".to_string(),
        config_path.to_string_lossy().into_owned(),
    ];

    match run_rclone_owned(app, &args, DEFAULT_COMMAND_TIMEOUT) {
        Ok(output) => Ok(!parse_lsjson_items(&output)?.is_empty()),
        Err(error) => {
            let normalized = error.to_ascii_lowercase();
            if normalized.contains("directory not found")
                || normalized.contains("object not found")
                || normalized.contains("not found")
            {
                Ok(false)
            } else {
                Err(error)
            }
        }
    }
}

pub(super) fn join_remote_path(base_path: &str, relative_path: &str) -> String {
    let trimmed_base = base_path.trim_matches('/');
    let trimmed_relative = relative_path.trim_matches('/');

    if trimmed_base.is_empty() {
        trimmed_relative.to_string()
    } else if trimmed_relative.is_empty() {
        trimmed_base.to_string()
    } else {
        format!("{trimmed_base}/{trimmed_relative}")
    }
}

fn emit_upload_progress(app: &AppHandle, event: UploadProgressEvent) {
    if let Err(error) = app.emit(UPLOAD_PROGRESS_EVENT, event) {
        log::warn!("failed to emit upload progress event: {error}");
    }
}

fn upload_candidate_error_message(detail: &str) -> String {
    match classify_rclone_error(detail) {
        RcloneErrorKind::RcloneUnavailable => {
            "The bundled rclone binary could not be found. Run the rclone setup step and restart the app."
                .to_string()
        }
        RcloneErrorKind::InsufficientSpace => {
            "The destination does not have enough free space.".to_string()
        }
        RcloneErrorKind::UnsupportedAbout => {
            "The destination cannot report free space.".to_string()
        }
        RcloneErrorKind::AuthError => "The upload destination needs to be reconnected.".to_string(),
        _ if detail.is_empty() => "The file could not be uploaded.".to_string(),
        _ => format!("The file could not be uploaded: {detail}"),
    }
}
