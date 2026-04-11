use crate::rclone_runtime::{load_remote_config_states, run_rclone_owned, DEFAULT_COMMAND_TIMEOUT};
use rclone_logic::{classify_rclone_error, RcloneErrorKind, RemoteConfigState};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug)]
pub(crate) struct RemoteValidationResult {
    pub(crate) remote_exists: bool,
    pub(crate) has_drive_id: bool,
    pub(crate) has_drive_type: bool,
    pub(crate) can_list: bool,
    pub(crate) failure_reason: Option<String>,
}

pub(crate) fn redact_args(args: &[String]) -> String {
    args.iter()
        .map(|arg| {
            if arg.starts_with("token=") {
                "token=<redacted>".to_string()
            } else if arg.starts_with("client_secret=") {
                "client_secret=<redacted>".to_string()
            } else if arg.starts_with("client_id=") {
                "client_id=<redacted>".to_string()
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Shortens and strips common OAuth token patterns from rclone/HTTP error text for logs.
/// Diagnostics ZIP may include `cloud-weave.log`; treat logged content as potentially user-shareable.
pub(crate) fn summarize_output(output: &str) -> String {
    let normalized = output.split_whitespace().collect::<Vec<_>>().join(" ");
    let redacted = normalized
        .replace("\"access_token\":\"", "\"access_token\":\"<redacted>")
        .replace("\"refresh_token\":\"", "\"refresh_token\":\"<redacted>");

    if redacted.len() > 220 {
        format!("{}...", &redacted[..220])
    } else {
        redacted
    }
}

pub(crate) fn ensure_rclone_config(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;

    let config_path = app_data_dir.join("rclone.conf");

    if !config_path.exists() {
        fs::write(&config_path, "")
            .map_err(|error| format!("failed to initialize rclone config file: {error}"))?;
    }

    Ok(config_path)
}

pub(crate) fn resolve_app_log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("failed to resolve app log directory: {error}"))?;

    fs::create_dir_all(&app_log_dir)
        .map_err(|error| format!("failed to prepare app log directory: {error}"))?;

    Ok(app_log_dir)
}

pub(crate) fn resolve_app_local_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("failed to resolve local app data directory: {error}"))?;

    fs::create_dir_all(&app_local_data_dir)
        .map_err(|error| format!("failed to prepare local app data directory: {error}"))?;

    Ok(app_local_data_dir)
}

pub(crate) fn resolve_diagnostics_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let diagnostics_dir = resolve_app_local_data_dir(app)?.join("diagnostics");

    fs::create_dir_all(&diagnostics_dir)
        .map_err(|error| format!("failed to prepare diagnostics directory: {error}"))?;

    Ok(diagnostics_dir)
}

pub(crate) fn default_remote_config_state() -> RemoteConfigState {
    RemoteConfigState {
        provider: "unknown".to_string(),
        drive_id: None,
        drive_type: None,
        token: None,
    }
}

pub(crate) fn success_message(stdout: &str) -> String {
    if stdout.trim().is_empty() {
        "The storage connection was saved successfully.".to_string()
    } else {
        "Your storage is connected and ready to use.".to_string()
    }
}

pub(crate) fn user_facing_command_error(detail: &str) -> String {
    match classify_rclone_error(detail) {
        RcloneErrorKind::AuthError => {
            "This storage needs to be reconnected before Cloud Weave can use it.".to_string()
        }
        RcloneErrorKind::AuthCallbackUnavailable => {
            "Cloud Weave could not start the local sign-in callback. Close stalled sign-in windows and try again."
                .to_string()
        }
        _ if detail.is_empty() => "rclone could not complete the request. Try again.".to_string(),
        _ => format!("rclone could not complete the request: {detail}"),
    }
}

pub(crate) fn validate_remote_after_setup(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
) -> Result<RemoteValidationResult, String> {
    let config_path = ensure_rclone_config(app)?;
    let remote_config_by_name = load_remote_config_states(app, &config_path)?;
    let config_state = remote_config_by_name.get(remote_name).cloned();

    let remote_exists = config_state.is_some();
    let config_state = config_state.unwrap_or_else(default_remote_config_state);
    let has_drive_id = config_state.drive_id.is_some();
    let has_drive_type = config_state.drive_type.is_some();

    let mut can_list = false;
    let mut failure_reason = None;

    if !remote_exists {
        failure_reason = Some("The remote section was not saved to config.".to_string());
    } else {
        let owned_args = vec![
            "lsd".to_string(),
            format!("{remote_name}:"),
            "--config".to_string(),
            config_path.to_string_lossy().into_owned(),
        ];

        match run_rclone_owned(app, &owned_args, DEFAULT_COMMAND_TIMEOUT) {
            Ok(_) => {
                can_list = true;
            }
            Err(error) => {
                failure_reason = Some(user_facing_command_error(&error));
            }
        }
    }

    let result = RemoteValidationResult {
        remote_exists,
        has_drive_id,
        has_drive_type,
        can_list,
        failure_reason,
    };

    log::info!(
        "remote validation remote={} provider={} remote_exists={} has_drive_id={} has_drive_type={} can_list={} failure_reason={}",
        remote_name,
        provider,
        result.remote_exists,
        result.has_drive_id,
        result.has_drive_type,
        result.can_list,
        result.failure_reason.as_deref().unwrap_or("none")
    );

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{redact_args, summarize_output};

    #[test]
    fn redact_args_strips_oauth_style_fields() {
        let args = vec![
            "config".to_string(),
            "create".to_string(),
            "myremote".to_string(),
            "onedrive".to_string(),
            "client_id=abc123".to_string(),
            "client_secret=secret".to_string(),
            "token={\"x\":1}".to_string(),
            "--config".to_string(),
            "C:/app/rclone.conf".to_string(),
        ];
        let s = redact_args(&args);
        assert!(!s.contains("client_id=abc123"));
        assert!(!s.contains("client_secret=secret"));
        assert!(!s.contains("token={"));
        assert!(s.contains("client_id=<redacted>"));
        assert!(s.contains("client_secret=<redacted>"));
        assert!(s.contains("token=<redacted>"));
        assert!(s.contains("C:/app/rclone.conf"));
    }

    #[test]
    fn summarize_output_inserts_redacted_markers_and_truncates() {
        let short = r#"{"error":"x","access_token":"eyJ","refresh_token":"rt"}"#;
        let out = summarize_output(short);
        assert!(out.contains("<redacted>"));
        assert!(out.contains("access_token"));

        let long = "x".repeat(300);
        let with_tokens = format!(
            r#"{{"access_token":"{0}","refresh_token":"{0}","msg":"{1}"}}"#,
            "t".repeat(50),
            long
        );
        let summarized = summarize_output(&with_tokens);
        assert!(summarized.len() <= 223);
        assert!(summarized.ends_with("..."));
    }
}
