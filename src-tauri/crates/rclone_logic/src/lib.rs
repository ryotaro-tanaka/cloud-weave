use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ListRemotesJson {
    Names(Vec<String>),
    Records(Vec<ListRemoteRecord>),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListRemoteRecord {
    name: String,
    #[serde(default)]
    _type: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct LsjsonItem {
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub size: i64,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub mod_time: Option<String>,
    #[serde(default)]
    pub is_dir: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedLibraryResult {
    pub items: Vec<UnifiedItem>,
    pub notices: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedItem {
    pub id: String,
    pub source_remote: String,
    pub source_provider: String,
    pub source_path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mod_time: Option<String>,
    pub mime_type: Option<String>,
    pub extension: Option<String>,
    pub category: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteConfigState {
    pub provider: String,
    pub drive_id: Option<String>,
    pub drive_type: Option<String>,
    pub token: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveDriveCandidate {
    pub id: String,
    pub label: String,
    pub drive_type: String,
    pub is_reachable: bool,
    pub is_system_like: bool,
    pub is_suggested: bool,
    pub message: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RcloneErrorKind {
    DuplicateRemote,
    AuthFlow,
    AuthCancelled,
    RcloneUnavailable,
    Other,
}

const DOCUMENT_MIME_TYPES: &[&str] = &[
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/rtf",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
];

const DOCUMENT_EXTENSIONS: &[&str] = &[
    ".pdf", ".txt", ".md", ".csv", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".rtf",
    ".odt", ".ods", ".odp", ".pages", ".numbers", ".key",
];

const PHOTO_EXTENSIONS: &[&str] = &[
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".tif", ".tiff", ".bmp", ".svg",
    ".dng", ".cr2", ".nef", ".arw",
];

const VIDEO_EXTENSIONS: &[&str] = &[
    ".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".wmv", ".flv", ".mpeg", ".mpg",
];

const AUDIO_EXTENSIONS: &[&str] = &[".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus"];

pub fn parse_listremotes(raw: &str) -> Result<Vec<String>, String> {
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    let parsed = serde_json::from_str::<ListRemotesJson>(raw)
        .map_err(|error| format!("failed to parse rclone listremotes output: {error}"))?;

    let remotes = match parsed {
        ListRemotesJson::Names(names) => names,
        ListRemotesJson::Records(records) => {
            records.into_iter().map(|record| record.name).collect()
        }
    };

    Ok(remotes
        .into_iter()
        .map(|remote| remote.trim_end_matches(':').to_string())
        .filter(|remote| !remote.is_empty())
        .collect())
}

pub fn parse_provider_map(config_text: &str) -> HashMap<String, String> {
    parse_remote_config_state_map(config_text)
        .into_iter()
        .map(|(name, state)| (name, state.provider))
        .collect()
}

pub fn parse_remote_config_state_map(config_text: &str) -> HashMap<String, RemoteConfigState> {
    let mut providers = HashMap::new();
    let mut current_remote: Option<String> = None;

    for line in config_text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            current_remote = Some(line[1..line.len() - 1].to_string());
            continue;
        }

        if let Some(remote_name) = current_remote.as_ref() {
            if let Some((key, value)) = line.split_once('=') {
                let entry =
                    providers
                        .entry(remote_name.clone())
                        .or_insert_with(|| RemoteConfigState {
                            provider: "unknown".to_string(),
                            drive_id: None,
                            drive_type: None,
                            token: None,
                        });

                match key.trim() {
                    "type" => {
                        entry.provider = value.trim().to_string();
                    }
                    "drive_id" => {
                        entry.drive_id = Some(value.trim().to_string());
                    }
                    "drive_type" => {
                        entry.drive_type = Some(value.trim().to_string());
                    }
                    "token" => {
                        entry.token = Some(value.trim().to_string());
                    }
                    _ => {}
                }
            }
        }
    }

    providers
}

pub fn parse_unified_items(
    raw: &str,
    source_remote: &str,
    source_provider: &str,
) -> Result<Vec<UnifiedItem>, String> {
    let parsed = parse_lsjson_items(raw)?;

    Ok(parsed
        .into_iter()
        .filter(|item| !item.is_dir)
        .map(|item| normalize_unified_item(item, source_remote, source_provider))
        .collect())
}

pub fn parse_lsjson_items(raw: &str) -> Result<Vec<LsjsonItem>, String> {
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<LsjsonItem>>(raw)
        .map_err(|error| format!("failed to parse rclone lsjson output: {error}"))
}

pub fn classify_item(mime_type: Option<&str>, extension: Option<&str>) -> &'static str {
    if let Some(mime_type) = mime_type.map(|value| value.trim().to_ascii_lowercase()) {
        if DOCUMENT_MIME_TYPES.contains(&mime_type.as_str()) {
            return "documents";
        }

        if mime_type.starts_with("image/") {
            return "photos";
        }

        if mime_type.starts_with("video/") {
            return "videos";
        }

        if mime_type.starts_with("audio/") {
            return "audio";
        }
    }

    if let Some(extension) = extension.map(|value| value.trim().to_ascii_lowercase()) {
        if DOCUMENT_EXTENSIONS.contains(&extension.as_str()) {
            return "documents";
        }

        if PHOTO_EXTENSIONS.contains(&extension.as_str()) {
            return "photos";
        }

        if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
            return "videos";
        }

        if AUDIO_EXTENSIONS.contains(&extension.as_str()) {
            return "audio";
        }
    }

    "other"
}

pub fn derive_extension(file_name: &str) -> Option<String> {
    let trimmed = file_name.trim();

    if trimmed.is_empty() {
        return None;
    }

    let (_, extension) = trimmed.rsplit_once('.')?;
    if extension.is_empty() {
        return None;
    }

    Some(format!(".{}", extension.to_ascii_lowercase()))
}

pub fn sort_onedrive_drive_candidates(candidates: &mut [OneDriveDriveCandidate]) {
    candidates.sort_by(|left, right| {
        rank_onedrive_drive_candidate(left)
            .cmp(&rank_onedrive_drive_candidate(right))
            .then(
                left.label
                    .to_ascii_lowercase()
                    .cmp(&right.label.to_ascii_lowercase()),
            )
            .then(left.id.cmp(&right.id))
    });
}

pub fn select_auto_onedrive_drive_candidate(
    candidates: &[OneDriveDriveCandidate],
) -> Option<OneDriveDriveCandidate> {
    let reachable = candidates
        .iter()
        .filter(|candidate| candidate.is_reachable)
        .cloned()
        .collect::<Vec<_>>();

    if reachable.len() == 1 {
        return reachable.into_iter().next();
    }

    let suggested = reachable
        .iter()
        .filter(|candidate| candidate.is_suggested)
        .cloned()
        .collect::<Vec<_>>();

    if suggested.len() == 1 {
        return suggested.into_iter().next();
    }

    None
}

pub fn normalize_onedrive_drive_candidates(
    raw_candidates: Vec<OneDriveDriveCandidate>,
) -> Vec<OneDriveDriveCandidate> {
    let mut by_id = HashMap::<String, OneDriveDriveCandidate>::new();

    for candidate in raw_candidates {
        match by_id.get(&candidate.id) {
            Some(existing)
                if rank_onedrive_drive_candidate(existing)
                    <= rank_onedrive_drive_candidate(&candidate) => {}
            _ => {
                by_id.insert(candidate.id.clone(), candidate);
            }
        }
    }

    let mut candidates = by_id.into_values().collect::<Vec<_>>();
    sort_onedrive_drive_candidates(&mut candidates);
    candidates
}

pub fn is_system_like_onedrive_drive_label(label: &str) -> bool {
    let normalized = label.trim().to_ascii_lowercase();

    normalized.starts_with("bundles_")
        || normalized.contains("metadataarchive")
        || normalized.contains("metadata archive")
        || normalized.contains("archive")
}

fn rank_onedrive_drive_candidate(candidate: &OneDriveDriveCandidate) -> (u8, u8, String) {
    let reachability_rank = if candidate.is_reachable { 0 } else { 1 };
    let system_rank = if candidate.is_system_like { 1 } else { 0 };
    let suggestion_rank = if candidate.is_suggested { 0 } else { 1 };

    (
        reachability_rank,
        system_rank,
        format!("{suggestion_rank}:{}", candidate.label),
    )
}

pub fn classify_rclone_error(detail: &str) -> RcloneErrorKind {
    let normalized = detail.to_lowercase();

    if normalized.contains("already exists") {
        return RcloneErrorKind::DuplicateRemote;
    }

    if normalized.contains("failed to run rclone") || normalized.contains("binary was not found") {
        return RcloneErrorKind::RcloneUnavailable;
    }

    if normalized.contains("timed out")
        || normalized.contains("context canceled")
        || normalized.contains("access_denied")
        || normalized.contains("authentication window was closed")
        || normalized.contains("window closed")
        || normalized.contains("user canceled")
        || normalized.contains("closed the browser")
    {
        return RcloneErrorKind::AuthCancelled;
    }

    if normalized.contains("browser")
        || normalized.contains("authorize")
        || normalized.contains("authentication")
        || normalized.contains("oauth")
        || normalized.contains("token")
    {
        return RcloneErrorKind::AuthFlow;
    }

    RcloneErrorKind::Other
}

fn normalize_unified_item(
    item: LsjsonItem,
    source_remote: &str,
    source_provider: &str,
) -> UnifiedItem {
    let name = item.name.unwrap_or_else(|| basename_from_path(&item.path));
    let extension = derive_extension(&name);
    let category = classify_item(item.mime_type.as_deref(), extension.as_deref()).to_string();

    UnifiedItem {
        id: format!("{source_remote}::{path}", path = item.path),
        source_remote: source_remote.to_string(),
        source_provider: source_provider.to_string(),
        source_path: item.path,
        name,
        is_dir: item.is_dir,
        size: item.size.max(0) as u64,
        mod_time: item.mod_time,
        mime_type: item.mime_type,
        extension,
        category,
    }
}

fn basename_from_path(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        classify_item, classify_rclone_error, derive_extension,
        is_system_like_onedrive_drive_label, normalize_onedrive_drive_candidates,
        parse_listremotes, parse_lsjson_items, parse_provider_map, parse_remote_config_state_map,
        parse_unified_items, select_auto_onedrive_drive_candidate, OneDriveDriveCandidate,
        RcloneErrorKind,
    };

    #[test]
    fn parse_listremotes_supports_string_arrays() {
        let raw = r#"["onedrive-main:","archive:"]"#;

        let parsed = parse_listremotes(raw).expect("string array output should parse");

        assert_eq!(parsed, vec!["onedrive-main", "archive"]);
    }

    #[test]
    fn parse_listremotes_supports_object_arrays() {
        let raw = r#"
      [
        {"name":"onedrive-main:","type":"onedrive"},
        {"name":"dropbox-backup:","type":"dropbox"}
      ]
    "#;

        let parsed = parse_listremotes(raw).expect("object array output should parse");

        assert_eq!(parsed, vec!["onedrive-main", "dropbox-backup"]);
    }

    #[test]
    fn parse_listremotes_rejects_invalid_json() {
        let raw = r#"{"unexpected":true}"#;

        let error = parse_listremotes(raw).expect_err("invalid output should fail");

        assert!(error.contains("failed to parse rclone listremotes output"));
    }

    #[test]
    fn parse_provider_map_reads_types_from_config() {
        let config = r#"
      [onedrive-main]
      type = onedrive
      token = abc

      [dropbox-backup]
      type = dropbox
    "#;

        let parsed = parse_provider_map(config);

        assert_eq!(
            parsed.get("onedrive-main").map(String::as_str),
            Some("onedrive")
        );
        assert_eq!(
            parsed.get("dropbox-backup").map(String::as_str),
            Some("dropbox")
        );
    }

    #[test]
    fn parse_remote_config_state_map_reads_drive_fields() {
        let config = r#"
      [onedrive-main]
      type = onedrive
      drive_id = abc123
      drive_type = personal
    "#;

        let parsed = parse_remote_config_state_map(config);
        let state = parsed
            .get("onedrive-main")
            .expect("remote state should exist");

        assert_eq!(state.provider, "onedrive");
        assert_eq!(state.drive_id.as_deref(), Some("abc123"));
        assert_eq!(state.drive_type.as_deref(), Some("personal"));
        assert_eq!(state.token.as_deref(), None);
    }

    #[test]
    fn parse_remote_config_state_map_reads_token() {
        let config = r#"
      [onedrive-main]
      type = onedrive
      token = {"access_token":"abc"}
    "#;

        let parsed = parse_remote_config_state_map(config);
        let state = parsed
            .get("onedrive-main")
            .expect("remote state should exist");

        assert_eq!(state.token.as_deref(), Some(r#"{"access_token":"abc"}"#));
    }

    #[test]
    fn classify_item_prefers_document_mime() {
        assert_eq!(
            classify_item(Some("application/pdf"), Some(".jpg")),
            "documents"
        );
    }

    #[test]
    fn classify_item_falls_back_to_extension() {
        assert_eq!(classify_item(None, Some(".mp3")), "audio");
    }

    #[test]
    fn classify_item_returns_other_for_unknown_types() {
        assert_eq!(
            classify_item(Some("application/octet-stream"), None),
            "other"
        );
    }

    #[test]
    fn derive_extension_lowercases_file_extensions() {
        assert_eq!(derive_extension("Vacation.JPG"), Some(".jpg".to_string()));
    }

    #[test]
    fn identify_system_like_onedrive_drive_labels() {
        assert!(is_system_like_onedrive_drive_label("ODCMetadataArchive"));
        assert!(is_system_like_onedrive_drive_label("Bundles_b896e2"));
        assert!(!is_system_like_onedrive_drive_label("OneDrive"));
    }

    #[test]
    fn normalize_onedrive_drive_candidates_deduplicates_by_id_and_prefers_human_label() {
        let candidates = vec![
            OneDriveDriveCandidate {
                id: "drive-1".to_string(),
                label: "Bundles_abc".to_string(),
                drive_type: "personal".to_string(),
                is_reachable: true,
                is_system_like: true,
                is_suggested: false,
                message: None,
            },
            OneDriveDriveCandidate {
                id: "drive-1".to_string(),
                label: "OneDrive".to_string(),
                drive_type: "personal".to_string(),
                is_reachable: true,
                is_system_like: false,
                is_suggested: true,
                message: None,
            },
        ];

        let normalized = normalize_onedrive_drive_candidates(candidates);

        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].label, "OneDrive");
        assert!(normalized[0].is_suggested);
    }

    #[test]
    fn auto_selects_single_reachable_candidate() {
        let candidates = vec![OneDriveDriveCandidate {
            id: "drive-1".to_string(),
            label: "OneDrive".to_string(),
            drive_type: "personal".to_string(),
            is_reachable: true,
            is_system_like: false,
            is_suggested: true,
            message: None,
        }];

        let selected = select_auto_onedrive_drive_candidate(&candidates);

        assert_eq!(
            selected.expect("candidate should be selected").id,
            "drive-1"
        );
    }

    #[test]
    fn auto_selects_single_suggested_candidate_among_multiple_reachable() {
        let candidates = vec![
            OneDriveDriveCandidate {
                id: "drive-1".to_string(),
                label: "OneDrive".to_string(),
                drive_type: "personal".to_string(),
                is_reachable: true,
                is_system_like: false,
                is_suggested: true,
                message: None,
            },
            OneDriveDriveCandidate {
                id: "drive-2".to_string(),
                label: "Archive".to_string(),
                drive_type: "personal".to_string(),
                is_reachable: true,
                is_system_like: true,
                is_suggested: false,
                message: None,
            },
        ];

        let selected = select_auto_onedrive_drive_candidate(&candidates);

        assert_eq!(
            selected.expect("candidate should be selected").id,
            "drive-1"
        );
    }

    #[test]
    fn does_not_auto_select_when_multiple_plausible_candidates_exist() {
        let candidates = vec![
            OneDriveDriveCandidate {
                id: "drive-1".to_string(),
                label: "Docs".to_string(),
                drive_type: "personal".to_string(),
                is_reachable: true,
                is_system_like: false,
                is_suggested: false,
                message: None,
            },
            OneDriveDriveCandidate {
                id: "drive-2".to_string(),
                label: "Photos".to_string(),
                drive_type: "personal".to_string(),
                is_reachable: true,
                is_system_like: false,
                is_suggested: false,
                message: None,
            },
        ];

        assert!(select_auto_onedrive_drive_candidate(&candidates).is_none());
    }

    #[test]
    fn parse_unified_items_filters_directories_and_normalizes_fields() {
        let raw = r#"
      [
        {
          "Path": "Pictures/Trip/photo.JPG",
          "Name": "photo.JPG",
          "Size": 128,
          "MimeType": "image/jpeg",
          "ModTime": "2026-01-01T10:00:00Z",
          "IsDir": false
        },
        {
          "Path": "Pictures",
          "Name": "Pictures",
          "Size": 0,
          "IsDir": true
        }
      ]
    "#;

        let parsed =
            parse_unified_items(raw, "onedrive-main", "onedrive").expect("lsjson should parse");

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].source_remote, "onedrive-main");
        assert_eq!(parsed[0].source_provider, "onedrive");
        assert_eq!(parsed[0].source_path, "Pictures/Trip/photo.JPG");
        assert_eq!(parsed[0].name, "photo.JPG");
        assert_eq!(parsed[0].extension.as_deref(), Some(".jpg"));
        assert_eq!(parsed[0].category, "photos");
        assert_eq!(parsed[0].size, 128);
        assert_eq!(parsed[0].mod_time.as_deref(), Some("2026-01-01T10:00:00Z"));
    }

    #[test]
    fn parse_lsjson_items_keeps_directories_for_staged_listing() {
        let raw = r#"
      [
        {
          "Path": "Documents",
          "Name": "Documents",
          "Size": -1,
          "IsDir": true
        },
        {
          "Path": "resume.docx",
          "Name": "resume.docx",
          "Size": 128,
          "MimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "IsDir": false
        }
      ]
    "#;

        let parsed = parse_lsjson_items(raw).expect("lsjson should parse");

        assert_eq!(parsed.len(), 2);
        assert!(parsed[0].is_dir);
        assert_eq!(parsed[0].path, "Documents");
        assert_eq!(parsed[0].size, -1);
        assert!(!parsed[1].is_dir);
    }

    #[test]
    fn classify_rclone_error_detects_duplicate_remote() {
        assert!(matches!(
            classify_rclone_error("remote onedrive-main already exists"),
            RcloneErrorKind::DuplicateRemote
        ));
    }

    #[test]
    fn classify_rclone_error_detects_auth_cancelled() {
        assert!(matches!(
            classify_rclone_error("user canceled authentication in the browser"),
            RcloneErrorKind::AuthCancelled
        ));
    }

    #[test]
    fn classify_rclone_error_detects_auth_flow() {
        assert!(matches!(
            classify_rclone_error("waiting for browser oauth token"),
            RcloneErrorKind::AuthFlow
        ));
    }

    #[test]
    fn classify_rclone_error_detects_missing_rclone_binary() {
        assert!(matches!(
            classify_rclone_error("failed to run rclone: binary was not found"),
            RcloneErrorKind::RcloneUnavailable
        ));
    }

    #[test]
    fn classify_rclone_error_falls_back_to_other() {
        assert!(matches!(
            classify_rclone_error("something unrelated happened"),
            RcloneErrorKind::Other
        ));
    }
}
