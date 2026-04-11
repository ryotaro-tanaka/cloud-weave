use chrono::{SecondsFormat, Utc};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use tauri::AppHandle;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::{
    backend_common::{ensure_rclone_config, resolve_app_log_dir, resolve_diagnostics_dir},
    ipc::types::{
        DiagnosticsStorageSummary, DiagnosticsSummary, ExportDiagnosticsInput, ExportDiagnosticsResult,
    },
    remotes::list_storage_remotes_impl,
    transfers::resolve_downloads_dir,
    unified_library::list_connected_remote_targets,
};

const APP_LOG_FILE_NAME: &str = "cloud-weave.log";
const DIAGNOSTICS_ZIP_DOWNLOAD_PREFIX: &str = "cloud-weave-diagnostics";

#[tauri::command]
pub async fn export_diagnostics(
    app: AppHandle,
    input: ExportDiagnosticsInput,
) -> Result<ExportDiagnosticsResult, String> {
    tauri::async_runtime::spawn_blocking(move || export_diagnostics_impl(app, input))
        .await
        .map_err(|error| format!("failed to join diagnostics export task: {error}"))?
}

// ZIP contains `summary.json` (app version, storage names, statuses) and optionally `cloud-weave.log`.
// Both may include machine-specific paths or account labels; review before sharing externally.
// Log lines should follow `backend_common` redaction; sensitive rclone errors are often passed through `summarize_output` at the call site.
fn export_diagnostics_impl(
    app: AppHandle,
    input: ExportDiagnosticsInput,
) -> Result<ExportDiagnosticsResult, String> {
    let exported_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let export_id = Utc::now().format("export-%Y%m%dT%H%M%SZ-%f").to_string();
    let diagnostics_dir = resolve_diagnostics_dir(&app)?.join(&export_id);

    fs::create_dir_all(&diagnostics_dir)
        .map_err(|error| format!("failed to create diagnostics export directory: {error}"))?;

    let config_path = ensure_rclone_config(&app)?;
    let connected_targets = list_connected_remote_targets(&app, &config_path)?;
    let connected_storage_names = connected_targets
        .iter()
        .map(|target| target.name.clone())
        .collect::<Vec<_>>();
    let connected_storage_count = connected_storage_names.len();
    let storage_state_summary = list_storage_remotes_impl(app.clone())?
        .into_iter()
        .map(|remote| DiagnosticsStorageSummary {
            name: remote.name,
            provider: remote.provider,
            status: remote.status,
        })
        .collect::<Vec<_>>();
    let summary_path = diagnostics_dir.join("summary.json");
    let summary = DiagnosticsSummary {
        app_version: app.package_info().version.to_string(),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        current_logical_view: input.current_logical_view,
        connected_storage_count,
        connected_storage_names,
        storage_state_summary,
        recent_issues_summary: input.recent_issues_summary,
        exported_at,
    };

    let summary_json = serde_json::to_string_pretty(&summary)
        .map_err(|error| format!("failed to serialize diagnostics summary: {error}"))?;

    fs::write(&summary_path, summary_json)
        .map_err(|error| format!("failed to write diagnostics summary: {error}"))?;

    let zip_path = resolve_downloads_dir(&app)?
        .join(format!("{DIAGNOSTICS_ZIP_DOWNLOAD_PREFIX}-{export_id}.zip"));
    let app_log_path = resolve_app_log_dir(&app)?.join(APP_LOG_FILE_NAME);
    let included_log_path = app_log_path.exists().then_some(app_log_path.as_path());

    create_diagnostics_zip(&zip_path, &summary_path, included_log_path)?;

    Ok(ExportDiagnosticsResult {
        status: "success".to_string(),
        diagnostics_dir: diagnostics_dir.to_string_lossy().into_owned(),
        summary_path: summary_path.to_string_lossy().into_owned(),
        zip_path: zip_path.to_string_lossy().into_owned(),
        message: if included_log_path.is_some() {
            "Diagnostics ZIP was exported to Downloads successfully.".to_string()
        } else {
            "Diagnostics ZIP was exported to Downloads successfully without the current log file."
                .to_string()
        },
    })
}

fn create_diagnostics_zip(
    zip_path: &Path,
    summary_path: &Path,
    app_log_path: Option<&Path>,
) -> Result<(), String> {
    let zip_file = fs::File::create(zip_path)
        .map_err(|error| format!("failed to create diagnostics ZIP: {error}"))?;
    let mut zip_writer = ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    add_file_to_zip(&mut zip_writer, summary_path, "summary.json", options)?;

    if let Some(log_path) = app_log_path {
        add_file_to_zip(&mut zip_writer, log_path, "logs/cloud-weave.log", options)?;
    }

    zip_writer
        .finish()
        .map_err(|error| format!("failed to finalize diagnostics ZIP: {error}"))?;

    Ok(())
}

fn add_file_to_zip(
    zip_writer: &mut ZipWriter<fs::File>,
    source_path: &Path,
    zip_entry_name: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let mut source_file = fs::File::open(source_path)
        .map_err(|error| format!("failed to open file for ZIP packaging: {error}"))?;
    let mut buffer = Vec::new();

    source_file
        .read_to_end(&mut buffer)
        .map_err(|error| format!("failed to read file for ZIP packaging: {error}"))?;

    zip_writer
        .start_file(zip_entry_name, options)
        .map_err(|error| format!("failed to start ZIP entry: {error}"))?;
    zip_writer
        .write_all(&buffer)
        .map_err(|error| format!("failed to write ZIP entry: {error}"))?;

    Ok(())
}
