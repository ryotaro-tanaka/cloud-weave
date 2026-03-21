use serde::Deserialize;
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

#[derive(Debug, PartialEq, Eq)]
pub enum RcloneErrorKind {
    DuplicateRemote,
    AuthFlow,
    AuthCancelled,
    RcloneUnavailable,
    Other,
}

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
                if key.trim() == "type" {
                    providers.insert(remote_name.clone(), value.trim().to_string());
                }
            }
        }
    }

    providers
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

#[cfg(test)]
mod tests {
    use super::{classify_rclone_error, parse_listremotes, parse_provider_map, RcloneErrorKind};

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
