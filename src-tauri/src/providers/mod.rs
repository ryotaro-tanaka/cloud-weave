pub(crate) mod onedrive;

use tauri::AppHandle;

use crate::{
    auth_session::CreateRemoteResult,
    backend_common::{success_message, validate_remote_after_setup, RemoteValidationResult},
};

pub(crate) fn provider_allows_saved_token_finalize(
    provider: &str,
    remote_exists: bool,
    has_token: bool,
) -> bool {
    matches!(provider, "onedrive") && remote_exists && has_token
}

pub(crate) fn provider_finalizing_message(provider: &str) -> Option<&'static str> {
    match provider {
        "onedrive" => Some("Cloud Weave is finalizing this OneDrive connection."),
        _ => None,
    }
}

pub(crate) fn provider_validation_ready(
    provider: &str,
    validation: &RemoteValidationResult,
) -> bool {
    match provider {
        "onedrive" => {
            validation.remote_exists
                && validation.can_list
                && validation.has_drive_id
                && validation.has_drive_type
        }
        _ => validation.remote_exists && validation.can_list,
    }
}

pub(crate) fn build_provider_post_auth_result(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    stdout: &str,
) -> Result<CreateRemoteResult, String> {
    match provider {
        "onedrive" => onedrive::build_post_auth_result(app, remote_name, provider, stdout),
        _ => {
            let validation = validate_remote_after_setup(app, remote_name, provider)?;

            Ok(if provider_validation_ready(provider, &validation) {
                CreateRemoteResult {
                    remote_name: remote_name.to_string(),
                    provider: provider.to_string(),
                    status: "connected".to_string(),
                    stage: Some("connected".to_string()),
                    next_step: "done".to_string(),
                    message: success_message(stdout),
                    error_code: None,
                    drive_candidates: None,
                }
            } else {
                CreateRemoteResult {
                    remote_name: remote_name.to_string(),
                    provider: provider.to_string(),
                    status: "error".to_string(),
                    stage: Some("failed".to_string()),
                    next_step: "retry".to_string(),
                    message: validation.failure_reason.unwrap_or_else(|| {
                        "This storage connection is incomplete. Try again.".to_string()
                    }),
                    error_code: None,
                    drive_candidates: None,
                }
            })
        }
    }
}
