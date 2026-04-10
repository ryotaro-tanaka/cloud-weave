use rclone_logic::UnifiedItem;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSummary {
    pub name: String,
    pub provider: String,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOneDriveRemoteInput {
    pub remote_name: String,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub status: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiagnosticsResult {
    pub status: String,
    pub diagnostics_dir: String,
    pub summary_path: String,
    pub zip_path: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiagnosticsInput {
    pub current_logical_view: String,
    pub recent_issues_summary: Vec<DiagnosticsIssueSummary>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsIssueSummary {
    pub level: String,
    pub source: String,
    pub timestamp: i64,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsStorageSummary {
    pub name: String,
    pub provider: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSummary {
    pub app_version: String,
    pub platform: String,
    pub current_logical_view: String,
    pub connected_storage_count: usize,
    pub connected_storage_names: Vec<String>,
    pub storage_state_summary: Vec<DiagnosticsStorageSummary>,
    pub recent_issues_summary: Vec<DiagnosticsIssueSummary>,
    pub exported_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadInput {
    pub download_id: String,
    pub source_remote: String,
    pub source_path: String,
    pub display_name: String,
    pub size: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareOpenFileInput {
    pub request_id: String,
    pub source_remote: String,
    pub source_path: String,
    pub display_name: String,
    pub mime_type: Option<String>,
    pub extension: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadAcceptedResult {
    pub download_id: String,
    pub status: String,
    pub target_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareOpenFileResult {
    pub request_id: String,
    pub status: String,
    pub local_path: String,
    pub open_mode: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub download_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_transferred: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSelectionInput {
    pub path: String,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUploadBatchInput {
    pub selections: Vec<UploadSelectionInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartUploadBatchInput {
    pub upload_id: String,
    pub items: Vec<PreparedUploadItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedUploadCandidate {
    pub provider: String,
    pub remote_name: String,
    pub base_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedUploadItem {
    pub item_id: String,
    pub original_local_path: String,
    pub relative_path: String,
    pub display_name: String,
    pub size: u64,
    pub extension: Option<String>,
    pub category: String,
    pub candidates: Vec<PreparedUploadCandidate>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedUploadBatch {
    pub upload_id: String,
    pub items: Vec<PreparedUploadItem>,
    pub notices: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadAcceptedResult {
    pub upload_id: String,
    pub status: String,
    pub total_items: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResultItem {
    pub item_id: String,
    pub provider: String,
    pub remote_name: String,
    pub remote_path: String,
    pub category: String,
    pub original_local_path: String,
    pub relative_path: String,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgressEvent {
    pub upload_id: String,
    pub item_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRoutingConfig {
    pub provider_priority_by_extension: HashMap<String, Vec<String>>,
    pub category_path_by_provider: HashMap<String, HashMap<String, String>>,
    pub preferred_remote_by_provider: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct AboutJson {
    #[serde(default)]
    pub free: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartUnifiedLibraryLoadResult {
    pub status: String,
    pub request_id: String,
    pub total_remotes: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedLibraryLoadEvent {
    pub request_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<UnifiedItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notices: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub loaded_remote_count: usize,
    pub total_remote_count: usize,
}
