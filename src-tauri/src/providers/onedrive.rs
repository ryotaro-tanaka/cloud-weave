use crate::{
    auth_session::CreateRemoteResult,
    backend_common::{
        default_remote_config_state, ensure_rclone_config, success_message, summarize_output,
        validate_remote_after_setup,
    },
    providers::provider_validation_ready,
};
use rclone_logic::{
    is_system_like_onedrive_drive_label, normalize_onedrive_drive_candidates,
    select_auto_onedrive_drive_candidate, OneDriveDriveCandidate,
};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::path::Path;
use std::time::Instant;
use tauri::AppHandle;

use crate::rclone_runtime::{
    collect_child_output, kill_child, load_remote_config_states, spawn_rclone_owned,
    DEFAULT_COMMAND_TIMEOUT, GRAPH_COMMAND_TIMEOUT, POLL_INTERVAL,
};

const GRAPH_BASE_URL: &str = "https://graph.microsoft.com/v1.0";

#[derive(Debug, Deserialize)]
struct OAuthTokenPayload {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct GraphDriveListResponse {
    value: Vec<GraphDrive>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphDrive {
    id: String,
    #[serde(default)]
    name: Option<String>,
    drive_type: String,
    #[serde(default)]
    _web_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphErrorResponse {
    error: GraphErrorPayload,
}

#[derive(Debug, Deserialize)]
struct GraphErrorPayload {
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OneDriveFinalizationCommandState {
    Running,
    ExitedSuccess,
    ExitedError(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OneDriveFinalizationDecision {
    Continue,
    Succeed,
    Fail(String),
}

pub(crate) fn build_post_auth_result(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    stdout: &str,
) -> Result<CreateRemoteResult, String> {
    let validation = validate_remote_after_setup(app, remote_name, provider)?;

    log::info!(
        "onedrive post-auth initial validation remote={} can_list={} has_drive_id={} has_drive_type={} failure_reason={}",
        remote_name,
        validation.can_list,
        validation.has_drive_id,
        validation.has_drive_type,
        validation.failure_reason.as_deref().unwrap_or("none")
    );

    if provider_validation_ready(provider, &validation) {
        return Ok(CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "connected".to_string(),
            stage: Some("connected".to_string()),
            next_step: "done".to_string(),
            message: success_message(stdout),
            error_code: None,
            drive_candidates: None,
        });
    }

    let config_path = ensure_rclone_config(app)?;
    let candidates = load_drive_candidates(app, remote_name)?;
    let reachable_candidates = candidates
        .iter()
        .filter(|candidate| candidate.is_reachable)
        .count();
    let suggested_reachable_candidates = candidates
        .iter()
        .filter(|candidate| candidate.is_reachable && candidate.is_suggested)
        .count();

    log::info!(
        "onedrive drive candidates remote={} total={} reachable={} suggested_reachable={}",
        remote_name,
        candidates.len(),
        reachable_candidates,
        suggested_reachable_candidates
    );

    if let Some(selected) = select_auto_onedrive_drive_candidate(&candidates) {
        log::info!(
            "auto-selecting onedrive drive remote={} drive_id={} label={} drive_type={}",
            remote_name,
            selected.id,
            selected.label,
            selected.drive_type
        );

        return apply_drive_selection(app, remote_name, &selected, &config_path);
    }

    if reachable_candidates > 0 {
        log::info!(
            "manual onedrive drive selection required remote={} reachable_candidates={}",
            remote_name,
            reachable_candidates
        );
        return Ok(CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "requires_drive_selection".to_string(),
            stage: Some("requires_drive_selection".to_string()),
            next_step: "select_drive".to_string(),
            message: "Choose which OneDrive library Cloud Weave should browse for this account."
                .to_string(),
            error_code: None,
            drive_candidates: Some(candidates),
        });
    }

    log::warn!(
        "onedrive drive finalization failed before selection remote={} no reachable candidates available",
        remote_name
    );

    Ok(CreateRemoteResult {
        remote_name: remote_name.to_string(),
        provider: provider.to_string(),
        status: "error".to_string(),
        stage: Some("failed".to_string()),
        next_step: "retry".to_string(),
        message: validation.failure_reason.unwrap_or_else(|| {
            "Cloud Weave finished browser authentication, but could not finalize this OneDrive library."
                .to_string()
        }),
        error_code: None,
        drive_candidates: Some(candidates),
    })
}

pub(crate) fn list_drive_candidates(
    app: &AppHandle,
    remote_name: &str,
) -> Result<Vec<OneDriveDriveCandidate>, String> {
    load_drive_candidates(app, remote_name)
}

pub(crate) fn finalize_remote(
    app: &AppHandle,
    name: &str,
    drive_id: &str,
) -> Result<CreateRemoteResult, String> {
    let config_path = ensure_rclone_config(app)?;
    let candidates = load_drive_candidates(app, name)?;
    let candidate = candidates
        .into_iter()
        .find(|entry| entry.id == drive_id)
        .ok_or_else(|| "The selected OneDrive drive is no longer available.".to_string())?;

    apply_drive_selection(app, name, &candidate, &config_path)
}

fn load_drive_candidates(
    app: &AppHandle,
    remote_name: &str,
) -> Result<Vec<OneDriveDriveCandidate>, String> {
    let config_path = ensure_rclone_config(app)?;
    let remote_config_by_name = load_remote_config_states(app, &config_path)?;
    let config_state = remote_config_by_name
        .get(remote_name)
        .cloned()
        .ok_or_else(|| format!("The OneDrive remote {remote_name} was not found in config."))?;

    if config_state.provider != "onedrive" {
        return Err("Drive discovery is only supported for OneDrive remotes.".to_string());
    }

    let token_json = config_state.token.ok_or_else(|| {
        log::warn!(
            "load_onedrive_drive_candidates missing token remote={}",
            remote_name
        );
        "Cloud Weave could not find the saved OneDrive access token.".to_string()
    })?;
    let access_token = parse_access_token(&token_json).map_err(|error| {
        log::warn!(
            "load_onedrive_drive_candidates failed to parse token remote={} error={}",
            remote_name,
            summarize_output(&error)
        );
        error
    })?;
    let client = Client::builder()
        .timeout(GRAPH_COMMAND_TIMEOUT)
        .build()
        .map_err(|error| format!("failed to create Microsoft Graph client: {error}"))?;

    let response = client
        .get(format!("{GRAPH_BASE_URL}/me/drives"))
        .bearer_auth(&access_token)
        .send()
        .map_err(|error| {
            let message = format!("failed to query Microsoft Graph drives: {error}");
            log::warn!(
                "load_onedrive_drive_candidates graph query failed remote={} error={}",
                remote_name,
                summarize_output(&message)
            );
            message
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        log::warn!(
            "load_onedrive_drive_candidates graph query returned failure remote={} status={} body={}",
            remote_name,
            status.as_u16(),
            summarize_output(&body)
        );
        return Err(format!(
            "failed to query Microsoft Graph drives: {}",
            summarize_graph_error(status.as_u16(), &body)
        ));
    }

    let drive_list = response
        .json::<GraphDriveListResponse>()
        .map_err(|error| format!("failed to parse Microsoft Graph drives response: {error}"))?;

    let raw_candidates = drive_list
        .value
        .into_iter()
        .map(|drive| validate_graph_drive_candidate(&client, &access_token, drive))
        .collect::<Vec<_>>();

    for candidate in &raw_candidates {
        log::info!(
            "onedrive candidate remote={} drive_id={} label={} drive_type={} reachable={} suggested={} system_like={} message={}",
            remote_name,
            candidate.id,
            candidate.label,
            candidate.drive_type,
            candidate.is_reachable,
            candidate.is_suggested,
            candidate.is_system_like,
            candidate.message.as_deref().unwrap_or("none")
        );
    }

    Ok(normalize_onedrive_drive_candidates(raw_candidates))
}

fn validate_graph_drive_candidate(
    client: &Client,
    access_token: &str,
    drive: GraphDrive,
) -> OneDriveDriveCandidate {
    let label = drive
        .name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| drive.id.clone());
    let is_system_like = is_system_like_onedrive_drive_label(&label);
    let is_suggested = label == "OneDrive" && drive.drive_type == "personal";

    let response = client
        .get(format!("{GRAPH_BASE_URL}/drives/{}/root", drive.id))
        .bearer_auth(access_token)
        .send();

    match response {
        Ok(response) if response.status().is_success() => OneDriveDriveCandidate {
            id: drive.id,
            label,
            drive_type: drive.drive_type,
            is_reachable: true,
            is_system_like,
            is_suggested,
            message: None,
        },
        Ok(response) => {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            OneDriveDriveCandidate {
                id: drive.id,
                label,
                drive_type: drive.drive_type,
                is_reachable: false,
                is_system_like,
                is_suggested,
                message: Some(summarize_graph_error(status.as_u16(), &body)),
            }
        }
        Err(error) => OneDriveDriveCandidate {
            id: drive.id,
            label,
            drive_type: drive.drive_type,
            is_reachable: false,
            is_system_like,
            is_suggested,
            message: Some(format!("Could not validate this drive: {error}")),
        },
    }
}

fn parse_access_token(token_json: &str) -> Result<String, String> {
    serde_json::from_str::<OAuthTokenPayload>(token_json)
        .map(|payload| payload.access_token)
        .map_err(|error| format!("failed to parse saved OneDrive token: {error}"))
}

fn summarize_graph_error(status: u16, body: &str) -> String {
    let message = serde_json::from_str::<GraphErrorResponse>(body)
        .ok()
        .and_then(|payload| payload.error.message)
        .unwrap_or_else(|| body.trim().to_string());

    if message.is_empty() {
        format!("Microsoft Graph returned HTTP {status}.")
    } else {
        format!("Microsoft Graph returned HTTP {status}: {message}")
    }
}

pub(crate) fn decide_onedrive_finalization_step(
    command_state: &OneDriveFinalizationCommandState,
    config_persisted: bool,
    validation_ready: bool,
) -> OneDriveFinalizationDecision {
    if config_persisted && validation_ready {
        return OneDriveFinalizationDecision::Succeed;
    }

    match command_state {
        OneDriveFinalizationCommandState::ExitedError(error) if !config_persisted => {
            OneDriveFinalizationDecision::Fail(error.clone())
        }
        _ => OneDriveFinalizationDecision::Continue,
    }
}

fn apply_drive_selection(
    app: &AppHandle,
    remote_name: &str,
    candidate: &OneDriveDriveCandidate,
    config_path: &Path,
) -> Result<CreateRemoteResult, String> {
    let owned_args = vec![
        "config".to_string(),
        "update".to_string(),
        remote_name.to_string(),
        format!("drive_id={}", candidate.id),
        format!("drive_type={}", candidate.drive_type),
        "--config".to_string(),
        config_path.to_string_lossy().into_owned(),
    ];

    log::info!(
        "finalizing onedrive drive remote={} drive_id={} drive_type={} label={}",
        remote_name,
        candidate.id,
        candidate.drive_type,
        candidate.label
    );

    let mut child = Some(spawn_rclone_owned(app, &owned_args)?);
    let start = Instant::now();
    let mut command_state = OneDriveFinalizationCommandState::Running;
    let mut logged_persisted = false;
    let mut logged_validation_ready = false;
    let mut last_validation_failure = None;

    loop {
        if command_state == OneDriveFinalizationCommandState::Running {
            match child
                .as_mut()
                .expect("running finalization should retain child")
                .try_wait()
            {
                Ok(Some(_)) => match collect_child_output(
                    child
                        .take()
                        .expect("completed finalization should retain child"),
                ) {
                    Ok(_) => {
                        command_state = OneDriveFinalizationCommandState::ExitedSuccess;
                        log::info!(
                            "onedrive drive selection command exited successfully remote={} drive_id={} drive_type={}",
                            remote_name,
                            candidate.id,
                            candidate.drive_type
                        );
                    }
                    Err(error) => {
                        log::warn!(
                            "failed to persist onedrive drive selection remote={} drive_id={} drive_type={} error={}",
                            remote_name,
                            candidate.id,
                            candidate.drive_type,
                            summarize_output(&error)
                        );
                        command_state = OneDriveFinalizationCommandState::ExitedError(error);
                    }
                },
                Ok(None) => {}
                Err(error) => {
                    let message = format!("failed while waiting for rclone: {error}");
                    log::warn!(
                        "failed while waiting for onedrive drive selection remote={} drive_id={} drive_type={} error={}",
                        remote_name,
                        candidate.id,
                        candidate.drive_type,
                        summarize_output(&message)
                    );
                    if let Some(mut child) = child.take() {
                        kill_child(&mut child);
                    }
                    command_state = OneDriveFinalizationCommandState::ExitedError(message);
                }
            }
        }

        let remote_config_by_name = load_remote_config_states(app, config_path)?;
        let persisted = remote_config_by_name
            .get(remote_name)
            .cloned()
            .unwrap_or_else(default_remote_config_state);
        let config_persisted = persisted.drive_id.as_deref() == Some(candidate.id.as_str())
            && persisted.drive_type.as_deref() == Some(candidate.drive_type.as_str());

        if config_persisted && !logged_persisted {
            log::info!(
                "persisted onedrive drive selection remote={} persisted_drive_id={} persisted_drive_type={}",
                remote_name,
                persisted.drive_id.as_deref().unwrap_or("none"),
                persisted.drive_type.as_deref().unwrap_or("none")
            );
            logged_persisted = true;
        }

        let mut validation_ready = false;
        if config_persisted {
            let validation = validate_remote_after_setup(app, remote_name, "onedrive")?;

            log::info!(
                "post-selection validation remote={} can_list={} has_drive_id={} has_drive_type={} failure_reason={}",
                remote_name,
                validation.can_list,
                validation.has_drive_id,
                validation.has_drive_type,
                validation.failure_reason.as_deref().unwrap_or("none")
            );

            validation_ready = provider_validation_ready("onedrive", &validation);
            last_validation_failure = validation.failure_reason.clone();

            if validation_ready && !logged_validation_ready {
                log::info!(
                    "onedrive drive finalization validation passed remote={} drive_id={} drive_type={}",
                    remote_name,
                    candidate.id,
                    candidate.drive_type
                );
                logged_validation_ready = true;
            }
        }

        match decide_onedrive_finalization_step(&command_state, config_persisted, validation_ready)
        {
            OneDriveFinalizationDecision::Succeed => {
                if let Some(mut child) = child.take() {
                    kill_child(&mut child);
                }

                return Ok(CreateRemoteResult {
                    remote_name: remote_name.to_string(),
                    provider: "onedrive".to_string(),
                    status: "connected".to_string(),
                    stage: Some("connected".to_string()),
                    next_step: "done".to_string(),
                    message: format!("Connected to {}.", candidate.label),
                    error_code: None,
                    drive_candidates: None,
                });
            }
            OneDriveFinalizationDecision::Fail(error) => {
                return Ok(CreateRemoteResult {
                    remote_name: remote_name.to_string(),
                    provider: "onedrive".to_string(),
                    status: "error".to_string(),
                    stage: Some("failed".to_string()),
                    next_step: "retry".to_string(),
                    message: error,
                    error_code: None,
                    drive_candidates: None,
                });
            }
            OneDriveFinalizationDecision::Continue => {}
        }

        if start.elapsed() >= DEFAULT_COMMAND_TIMEOUT {
            if let Some(mut child) = child.take() {
                kill_child(&mut child);
            }

            log::warn!(
                "onedrive drive finalization timed out remote={} drive_id={} drive_type={} persisted={} validation_ready={}",
                remote_name,
                candidate.id,
                candidate.drive_type,
                config_persisted,
                validation_ready
            );

            return Ok(CreateRemoteResult {
                remote_name: remote_name.to_string(),
                provider: "onedrive".to_string(),
                status: "error".to_string(),
                stage: Some("failed".to_string()),
                next_step: "retry".to_string(),
                message: last_validation_failure.unwrap_or_else(|| {
                    "Cloud Weave saved the selected drive, but it still could not browse it."
                        .to_string()
                }),
                error_code: None,
                drive_candidates: None,
            });
        }

        std::thread::sleep(POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decide_onedrive_finalization_step, OneDriveFinalizationCommandState,
        OneDriveFinalizationDecision,
    };

    #[test]
    fn onedrive_finalization_waits_while_update_is_still_running() {
        assert_eq!(
            decide_onedrive_finalization_step(
                &OneDriveFinalizationCommandState::Running,
                false,
                false,
            ),
            OneDriveFinalizationDecision::Continue
        );
    }

    #[test]
    fn onedrive_finalization_succeeds_when_validation_passes_even_if_command_is_running() {
        assert_eq!(
            decide_onedrive_finalization_step(
                &OneDriveFinalizationCommandState::Running,
                true,
                true,
            ),
            OneDriveFinalizationDecision::Succeed
        );
    }

    #[test]
    fn onedrive_finalization_waits_after_persistence_until_validation_passes() {
        assert_eq!(
            decide_onedrive_finalization_step(
                &OneDriveFinalizationCommandState::ExitedSuccess,
                true,
                false,
            ),
            OneDriveFinalizationDecision::Continue
        );
    }

    #[test]
    fn onedrive_finalization_fails_when_update_exits_before_persistence() {
        assert_eq!(
            decide_onedrive_finalization_step(
                &OneDriveFinalizationCommandState::ExitedError(
                    "operation timed out after 20 seconds".to_string(),
                ),
                false,
                false,
            ),
            OneDriveFinalizationDecision::Fail("operation timed out after 20 seconds".to_string(),)
        );
    }
}
