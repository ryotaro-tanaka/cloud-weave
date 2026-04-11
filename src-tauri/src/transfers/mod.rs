use std::{
    collections::{HashMap, VecDeque},
    fs,
    hash::{Hash, Hasher},
    path::Component,
    path::{Path, PathBuf},
};

use rclone_logic::{
    category_base_path as category_base_path_for_provider, classify_item, classify_rclone_error,
    default_upload_routing_tables, derive_extension, open_cache_key_suffix,
    providers_for_extension as providers_for_extension_from_maps, rank_upload_remotes_by_capacity,
    sanitize_open_cache_stem, select_preview_open_mode, RcloneErrorKind, UploadRemoteCapacity,
};
use tauri::{AppHandle, Manager};

use crate::{
    auth_session::callback_unavailable_message,
    backend_common::{ensure_rclone_config, resolve_app_local_data_dir},
    ipc::types::{
        AboutJson, DownloadAcceptedResult, DownloadProgressEvent, PrepareOpenFileInput,
        PrepareOpenFileResult, PrepareUploadBatchInput, PreparedUploadBatch,
        PreparedUploadCandidate, PreparedUploadItem, StartDownloadInput, StartUploadBatchInput,
        UploadAcceptedResult, UploadRoutingConfig, UploadSelectionInput,
    },
    rclone_runtime::{run_rclone_owned, INVENTORY_COMMAND_TIMEOUT},
    unified_library::{list_connected_remote_targets, RemoteLoadTarget},
    validate_remote_name,
};

mod download;
mod upload;

use download::{
    emit_download_progress, resolve_unique_download_target, select_download_file_name,
    spawn_download_task,
};

const OPEN_TEMP_MAX_AGE: std::time::Duration = std::time::Duration::from_secs(60 * 60 * 24);
const UPLOAD_ROUTING_CONFIG_FILE: &str = "upload-routing.json";

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    input: StartDownloadInput,
) -> Result<DownloadAcceptedResult, String> {
    tauri::async_runtime::spawn_blocking(move || start_download_impl(app, input))
        .await
        .map_err(|error| format!("failed to join download task: {error}"))?
}

#[tauri::command]
pub async fn prepare_open_file(
    app: AppHandle,
    input: PrepareOpenFileInput,
) -> Result<PrepareOpenFileResult, String> {
    tauri::async_runtime::spawn_blocking(move || prepare_open_file_impl(app, input))
        .await
        .map_err(|error| format!("failed to join open preparation task: {error}"))?
}

#[tauri::command]
pub async fn prepare_upload_batch(
    app: AppHandle,
    input: PrepareUploadBatchInput,
) -> Result<PreparedUploadBatch, String> {
    tauri::async_runtime::spawn_blocking(move || prepare_upload_batch_impl(app, input))
        .await
        .map_err(|error| format!("failed to join upload preparation task: {error}"))?
}

#[tauri::command]
pub async fn start_upload_batch(
    app: AppHandle,
    input: StartUploadBatchInput,
) -> Result<UploadAcceptedResult, String> {
    tauri::async_runtime::spawn_blocking(move || start_upload_batch_impl(app, input))
        .await
        .map_err(|error| format!("failed to join upload task: {error}"))?
}

fn prepare_upload_batch_impl(
    app: AppHandle,
    input: PrepareUploadBatchInput,
) -> Result<PreparedUploadBatch, String> {
    if input.selections.is_empty() {
        return Err("Add at least one file or folder to upload.".to_string());
    }

    let config_path = ensure_rclone_config(&app)?;
    let routing = load_upload_routing_config(&app)?;
    let remotes = list_connected_remote_targets(&app, &config_path)?;
    let remotes_by_provider = group_remotes_by_provider(remotes);
    let mut items = Vec::new();

    for selection in input.selections {
        items.extend(expand_upload_selection(&selection)?);
    }

    if items.is_empty() {
        return Err("No files were found in the selected paths.".to_string());
    }

    let prepared_items = items
        .into_iter()
        .map(|item| prepare_upload_item(&app, &config_path, &routing, &remotes_by_provider, item))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(PreparedUploadBatch {
        upload_id: build_upload_batch_id(),
        items: prepared_items,
        notices: Vec::new(),
    })
}

fn start_upload_batch_impl(
    app: AppHandle,
    input: StartUploadBatchInput,
) -> Result<UploadAcceptedResult, String> {
    if input.upload_id.trim().is_empty() {
        return Err("Upload ID is required.".to_string());
    }

    if input.items.is_empty() {
        return Err("There are no prepared upload items to start.".to_string());
    }

    let upload_id = input.upload_id.clone();
    let total_items = input.items.len();

    upload::spawn_upload_task(app, input);

    Ok(UploadAcceptedResult {
        upload_id,
        status: "accepted".to_string(),
        total_items,
    })
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

    let Some(open_mode) =
        select_preview_open_mode(input.mime_type.as_deref(), input.extension.as_deref())
    else {
        return Err(
            "Open is only available for previewable files and supported documents.".to_string(),
        );
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

pub(crate) fn resolve_downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|error| format!("failed to resolve the Downloads folder: {error}"))?;

    fs::create_dir_all(&downloads_dir)
        .map_err(|error| format!("failed to prepare the Downloads folder: {error}"))?;

    Ok(downloads_dir)
}

fn resolve_open_temp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let temp_dir = resolve_app_local_data_dir(app)?.join("open-cache");

    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("failed to prepare the open file cache: {error}"))?;

    Ok(temp_dir)
}

#[derive(Clone, Debug)]
struct ExpandedUploadSource {
    original_local_path: String,
    relative_path: String,
    display_name: String,
    size: u64,
    extension: Option<String>,
    category: String,
}

fn expand_upload_selection(
    selection: &UploadSelectionInput,
) -> Result<Vec<ExpandedUploadSource>, String> {
    let path = PathBuf::from(&selection.path);

    if !path.exists() {
        return Err(format!(
            "The selected path does not exist: {}",
            selection.path
        ));
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("failed to inspect the selected path: {error}"))?;

    match selection.kind.as_str() {
        "file" if metadata.is_file() => {
            Ok(vec![expanded_upload_source_from_file(&path, &path, false)?])
        }
        "directory" if metadata.is_dir() => expand_upload_directory(&path),
        "file" | "directory" => {
            if metadata.is_dir() {
                expand_upload_directory(&path)
            } else if metadata.is_file() {
                Ok(vec![expanded_upload_source_from_file(&path, &path, false)?])
            } else {
                Err(format!(
                    "The selected path is not a file or folder: {}",
                    selection.path
                ))
            }
        }
        other => Err(format!("Unsupported upload selection kind: {other}")),
    }
}

fn expand_upload_directory(directory_path: &Path) -> Result<Vec<ExpandedUploadSource>, String> {
    let root_name = directory_path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "A selected folder must have a name.".to_string())?;

    let mut queue = VecDeque::from([directory_path.to_path_buf()]);
    let mut items = Vec::new();

    while let Some(current_dir) = queue.pop_front() {
        for entry in fs::read_dir(&current_dir)
            .map_err(|error| format!("failed to read the selected folder: {error}"))?
        {
            let entry = entry.map_err(|error| format!("failed to read a folder entry: {error}"))?;
            let path = entry.path();
            let metadata = entry
                .metadata()
                .map_err(|error| format!("failed to read folder entry metadata: {error}"))?;

            if metadata.is_dir() {
                queue.push_back(path);
                continue;
            }

            if metadata.is_file() {
                items.push(expanded_upload_source_from_file(
                    directory_path,
                    &path,
                    true,
                )?);
            }
        }
    }

    items.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    if items.is_empty() {
        return Err(format!(
            "The selected folder {root_name} does not contain any files."
        ));
    }

    Ok(items)
}

fn expanded_upload_source_from_file(
    root_path: &Path,
    file_path: &Path,
    include_root_name: bool,
) -> Result<ExpandedUploadSource, String> {
    let metadata = fs::metadata(file_path)
        .map_err(|error| format!("failed to read the selected file: {error}"))?;
    let display_name = file_path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "A selected file must have a name.".to_string())?;
    let extension = derive_extension(&display_name);
    let category = classify_item(None, extension.as_deref()).to_string();

    let relative_path = if include_root_name {
        let root_name = root_path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "A selected folder must have a name.".to_string())?;
        let nested = file_path
            .strip_prefix(root_path)
            .map_err(|error| format!("failed to derive a relative folder path: {error}"))?;
        let normalized_nested = nested
            .components()
            .filter_map(component_to_normal_path_part)
            .collect::<Vec<_>>()
            .join("/");

        if normalized_nested.is_empty() {
            root_name
        } else {
            format!("{root_name}/{normalized_nested}")
        }
    } else {
        display_name.clone()
    };

    Ok(ExpandedUploadSource {
        original_local_path: file_path.to_string_lossy().into_owned(),
        relative_path,
        display_name,
        size: metadata.len(),
        extension,
        category,
    })
}

fn prepare_upload_item(
    app: &AppHandle,
    config_path: &Path,
    routing: &UploadRoutingConfig,
    remotes_by_provider: &HashMap<String, Vec<String>>,
    source: ExpandedUploadSource,
) -> Result<PreparedUploadItem, String> {
    let providers = providers_for_extension(routing, source.extension.as_deref());
    let mut candidates = Vec::new();

    for provider in providers {
        let base_path = category_base_path_for_provider(
            &routing.category_path_by_provider,
            &provider,
            &source.category,
        );

        candidates.extend(resolve_upload_candidates_for_provider(
            app,
            config_path,
            remotes_by_provider,
            &provider,
            &base_path,
            source.size,
        ));
    }

    if candidates.is_empty() {
        return Err(format!(
            "No connected upload destination is available for {}. Connect a storage with enough space and try again.",
            source.display_name
        ));
    }

    let item_id = build_upload_item_id(&source.original_local_path, &source.relative_path);

    Ok(PreparedUploadItem {
        item_id,
        original_local_path: source.original_local_path,
        relative_path: source.relative_path,
        display_name: source.display_name,
        size: source.size,
        extension: source.extension,
        category: source.category,
        candidates,
    })
}

fn group_remotes_by_provider(remotes: Vec<RemoteLoadTarget>) -> HashMap<String, Vec<String>> {
    let mut grouped = HashMap::<String, Vec<String>>::new();

    for remote in remotes {
        grouped
            .entry(remote.provider)
            .or_default()
            .push(remote.name);
    }

    for remotes in grouped.values_mut() {
        remotes.sort();
    }

    grouped
}

fn load_upload_routing_config(app: &AppHandle) -> Result<UploadRoutingConfig, String> {
    let config_path = resolve_upload_routing_config_path(app)?;

    if !config_path.exists() {
        let config = default_upload_routing_config();
        write_upload_routing_config(&config_path, &config)?;
        return Ok(config);
    }

    let raw = fs::read_to_string(&config_path)
        .map_err(|error| format!("failed to read upload routing config: {error}"))?;

    if raw.trim().is_empty() {
        let config = default_upload_routing_config();
        write_upload_routing_config(&config_path, &config)?;
        return Ok(config);
    }

    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse upload routing config: {error}"))
}

fn resolve_upload_routing_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;

    Ok(app_data_dir.join(UPLOAD_ROUTING_CONFIG_FILE))
}

fn write_upload_routing_config(path: &Path, config: &UploadRoutingConfig) -> Result<(), String> {
    fs::write(
        path,
        serde_json::to_string_pretty(config)
            .map_err(|error| format!("failed to encode upload routing config: {error}"))?,
    )
    .map_err(|error| format!("failed to write upload routing config: {error}"))
}

fn default_upload_routing_config() -> UploadRoutingConfig {
    let (provider_priority_by_extension, category_path_by_provider) =
        default_upload_routing_tables();
    UploadRoutingConfig {
        provider_priority_by_extension,
        category_path_by_provider,
        preferred_remote_by_provider: HashMap::new(),
    }
}

fn providers_for_extension(routing: &UploadRoutingConfig, extension: Option<&str>) -> Vec<String> {
    providers_for_extension_from_maps(&routing.provider_priority_by_extension, extension)
}

fn resolve_upload_candidates_for_provider(
    app: &AppHandle,
    config_path: &Path,
    remotes_by_provider: &HashMap<String, Vec<String>>,
    provider: &str,
    base_path: &str,
    file_size: u64,
) -> Vec<PreparedUploadCandidate> {
    let Some(remotes) = remotes_by_provider.get(provider) else {
        return Vec::new();
    };
    let remote_names = rank_upload_remotes_by_capacity(
        remotes,
        &probe_upload_remote_capacities(app, config_path, remotes),
        file_size,
    );

    remote_names
        .into_iter()
        .map(|remote_name| PreparedUploadCandidate {
            provider: provider.to_string(),
            remote_name,
            base_path: base_path.to_string(),
        })
        .collect()
}

fn probe_upload_remote_capacities(
    app: &AppHandle,
    config_path: &Path,
    remotes: &[String],
) -> HashMap<String, UploadRemoteCapacity> {
    remotes
        .iter()
        .map(|remote_name| {
            let capacity = match remote_free_space(app, config_path, remote_name) {
                Ok(Some(free_bytes)) => UploadRemoteCapacity::Supported { free_bytes },
                Ok(None) => UploadRemoteCapacity::SupportedWithoutFree,
                Err(_) => UploadRemoteCapacity::Unsupported,
            };

            (remote_name.clone(), capacity)
        })
        .collect()
}

fn remote_free_space(
    app: &AppHandle,
    config_path: &Path,
    remote_name: &str,
) -> Result<Option<u64>, String> {
    let args = vec![
        "about".to_string(),
        format!("{remote_name}:"),
        "--json".to_string(),
        "--config".to_string(),
        config_path.to_string_lossy().into_owned(),
    ];

    let output = run_rclone_owned(app, &args, crate::rclone_runtime::DEFAULT_COMMAND_TIMEOUT)?;
    let parsed: AboutJson = serde_json::from_str(&output)
        .map_err(|error| format!("failed to parse rclone about output: {error}"))?;
    Ok(parsed.free)
}

fn build_upload_batch_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    format!("upload-{millis}")
}

fn build_upload_item_id(local_path: &str, relative_path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    local_path.hash(&mut hasher);
    relative_path.hash(&mut hasher);
    format!("upload-item-{:016x}", hasher.finish())
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
        .or_else(|| {
            input
                .extension
                .clone()
                .filter(|value| !value.trim().is_empty())
        });

    let sanitized_stem = sanitize_open_cache_stem(&stem);
    let cache_key = open_cache_key_suffix(&input.source_remote, &input.source_path);
    let file_name = match extension.as_deref().filter(|value| !value.is_empty()) {
        Some(extension) => format!("{sanitized_stem}-{cache_key}.{extension}"),
        None => format!("{sanitized_stem}-{cache_key}"),
    };

    open_temp_dir.join(file_name)
}

pub(crate) fn cleanup_stale_open_temp_files(app: &AppHandle) -> Result<(), String> {
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

fn user_facing_open_error(detail: &str) -> String {
    match classify_rclone_error(detail) {
        RcloneErrorKind::RcloneUnavailable => {
            "The bundled rclone binary could not be found. Run the rclone setup step and restart the app."
                .to_string()
        }
        RcloneErrorKind::AuthCallbackUnavailable => callback_unavailable_message(),
        _ if detail.is_empty() => "The file could not be prepared for preview. Try again.".to_string(),
        _ => format!("The file could not be prepared for preview: {detail}"),
    }
}

pub(super) fn component_to_normal_path_part(component: Component<'_>) -> Option<String> {
    match component {
        Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::download::{
        resolve_unique_download_target, select_download_file_name, user_facing_download_error,
    };
    use super::expand_upload_directory;
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
    fn user_facing_download_error_falls_back_to_detail() {
        let message = user_facing_download_error("access denied");
        assert!(message.contains("access denied"));
    }

    #[test]
    fn expand_upload_directory_preserves_root_folder_name() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("cloud-weave-upload-folder-{unique}"));
        let nested = root.join("nested");

        fs::create_dir_all(&nested).expect("nested directory should be created");
        fs::write(nested.join("photo.jpg"), b"image").expect("test file should be written");

        let items = expand_upload_directory(&root).expect("directory expansion should succeed");

        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].relative_path,
            format!(
                "{}{}",
                root.file_name()
                    .and_then(|value| value.to_str())
                    .expect("root name"),
                "/nested/photo.jpg"
            )
        );

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }
}
