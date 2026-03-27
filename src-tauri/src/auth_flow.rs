use crate::{
    auth_session::{
        auth_session_record_from_result, auth_session_stage_from_result_status,
        callback_unavailable_result, error_auth_session, finalizing_auth_session,
        pending_auth_session, remove_auth_session_record, remove_reconnect_request_record,
        set_auth_session_record, AuthFlowCompletionAction, AuthProcessState, AuthSessionRecord,
        CreateRemoteResult,
    },
    backend_common::{
        ensure_rclone_config, redact_args, summarize_output, user_facing_command_error,
    },
    providers,
};
use rclone_logic::{classify_rclone_error, RcloneErrorKind};
use std::{process::Child, thread, time::Instant};
use tauri::AppHandle;

use crate::rclone_runtime::{
    collect_child_output, ensure_auth_callback_available, kill_child, load_remote_config_states,
    spawn_rclone_owned, AUTH_START_GRACE_PERIOD, POLL_INTERVAL,
};

const AUTH_COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);
const MISSING_TOKEN_RECONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);
const STALLED_RECONNECT_MESSAGE: &str =
    "Cloud Weave could not complete reconnect for this storage. Finish the sign-in flow in your browser and try again, or remove and connect again.";

pub(crate) fn start_auth_flow(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    mode: &str,
    args: &[String],
) -> Result<CreateRemoteResult, String> {
    log::info!(
        "starting auth flow remote={} provider={} mode={} args={}",
        remote_name,
        provider,
        mode,
        redact_args(args)
    );

    if let Some(existing) = crate::auth_session::get_auth_session_record(app, remote_name) {
        if existing.status == "pending" {
            return Ok(CreateRemoteResult {
                remote_name: remote_name.to_string(),
                provider: provider.to_string(),
                status: "pending".to_string(),
                stage: Some("pending_auth".to_string()),
                next_step: "open_browser".to_string(),
                message: "Authentication is already in progress for this storage.".to_string(),
                error_code: None,
                drive_candidates: None,
            });
        }
    }

    if let Err(error) = ensure_auth_callback_available() {
        log::warn!(
            "auth callback preflight remote={} provider={} mode={} port={} available=false error={}",
            remote_name,
            provider,
            mode,
            crate::rclone_runtime::AUTH_CALLBACK_BIND_ADDR,
            error
        );
        remove_auth_session_record(app, remote_name);
        return Ok(callback_unavailable_result(remote_name, provider));
    }

    let mut child = spawn_rclone_owned(app, args)?;
    thread::sleep(AUTH_START_GRACE_PERIOD);

    match child.try_wait() {
        Ok(Some(_)) => match collect_child_output(child) {
            Ok(stdout) => build_success_result(app, remote_name, provider, mode, &stdout),
            Err(error) => build_auth_error_result(
                app,
                remote_name,
                provider,
                mode,
                &error,
                AuthProcessState::Completed,
            ),
        },
        Ok(None) => {
            let pending = pending_auth_session(
                remote_name,
                provider,
                mode,
                "Complete authentication in your browser to finish connecting this storage.",
            );
            set_auth_session_record(app, pending);
            spawn_auth_watcher(
                app.clone(),
                child,
                remote_name.to_string(),
                provider.to_string(),
                mode.to_string(),
            );

            Ok(CreateRemoteResult {
                remote_name: remote_name.to_string(),
                provider: provider.to_string(),
                status: "pending".to_string(),
                stage: Some("pending_auth".to_string()),
                next_step: "open_browser".to_string(),
                message:
                    "Authentication started in your browser. Return here after you finish signing in."
                        .to_string(),
                error_code: None,
                drive_candidates: None,
            })
        }
        Err(error) => {
            kill_child(&mut child);
            Err(format!("failed while checking rclone process: {error}"))
        }
    }
}

pub(crate) fn spawn_auth_watcher(
    app: AppHandle,
    mut child: Child,
    remote_name: String,
    provider: String,
    mode: String,
) {
    thread::spawn(move || {
        let start = Instant::now();

        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    match collect_child_output(child) {
                        Ok(stdout) => {
                            if let Ok(result) =
                                build_success_result(&app, &remote_name, &provider, &mode, &stdout)
                            {
                                let record = auth_session_record_from_result(&mode, &result);
                                set_auth_session_record(&app, record);
                            }
                        }
                        Err(error) => {
                            if let Ok(result) = build_auth_error_result(
                                &app,
                                &remote_name,
                                &provider,
                                &mode,
                                &error,
                                AuthProcessState::Completed,
                            ) {
                                let record = auth_session_record_from_result(&mode, &result);
                                set_auth_session_record(&app, record);
                            }
                        }
                    }

                    break;
                }
                Ok(None) => {
                    match auth_flow_completion_action(
                        &app,
                        &remote_name,
                        &provider,
                        &mode,
                        AuthProcessState::Running,
                        start.elapsed(),
                    ) {
                        Ok(AuthFlowCompletionAction::TryFinalize) => {
                            log::info!(
                                "auth flow running with saved config remote={} provider={} mode={} recovering_via_post_auth=true",
                                remote_name,
                                provider,
                                mode
                            );
                            if let Some(message) = providers::provider_finalizing_message(&provider)
                            {
                                set_auth_session_record(
                                    &app,
                                    finalizing_auth_session(
                                        &remote_name,
                                        &provider,
                                        &mode,
                                        message,
                                    ),
                                );
                            }
                            kill_child(&mut child);
                            match build_success_result(&app, &remote_name, &provider, &mode, "") {
                                Ok(result) => {
                                    let record = auth_session_record_from_result(&mode, &result);
                                    set_auth_session_record(&app, record);
                                }
                                Err(error) => {
                                    let record =
                                        error_auth_session(&remote_name, &provider, &mode, &error);
                                    set_auth_session_record(&app, record);
                                }
                            }
                            break;
                        }
                        Ok(AuthFlowCompletionAction::KeepPending) => {}
                        Ok(AuthFlowCompletionAction::FailPending) => {
                            kill_child(&mut child);
                            let record = error_auth_session(
                                &remote_name,
                                &provider,
                                &mode,
                                STALLED_RECONNECT_MESSAGE,
                            );
                            set_auth_session_record(&app, record);
                            break;
                        }
                        Ok(AuthFlowCompletionAction::ReturnError) => {}
                        Err(error) => {
                            log::warn!(
                                "auth flow completion check failed remote={} provider={} mode={} error={}",
                                remote_name,
                                provider,
                                mode,
                                error
                            );
                        }
                    }

                    if start.elapsed() >= AUTH_COMMAND_TIMEOUT {
                        kill_child(&mut child);
                        let record = error_auth_session(
                            &remote_name,
                            &provider,
                            &mode,
                            "Authentication was not completed in time. Try again when you are ready.",
                        );
                        set_auth_session_record(&app, record);
                        break;
                    }
                }
                Err(_) => {
                    kill_child(&mut child);
                    let record = error_auth_session(
                        &remote_name,
                        &provider,
                        &mode,
                        "Authentication could not be completed. Try again.",
                    );
                    set_auth_session_record(&app, record);
                    break;
                }
            }

            thread::sleep(POLL_INTERVAL);
        }
    });
}

pub(crate) fn build_auth_error_result(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    mode: &str,
    error: &str,
    process_state: AuthProcessState,
) -> Result<CreateRemoteResult, String> {
    log::warn!(
        "auth flow failed remote={} provider={} mode={} process_state={:?} error={}",
        remote_name,
        provider,
        mode,
        process_state,
        summarize_output(error)
    );

    let error_kind = classify_rclone_error(error);

    log::info!(
        "auth flow classified remote={} provider={} mode={} kind={:?}",
        remote_name,
        provider,
        mode,
        error_kind
    );

    if matches!(error_kind, RcloneErrorKind::AuthFlow) {
        match auth_flow_completion_action(
            app,
            remote_name,
            provider,
            mode,
            process_state,
            std::time::Duration::ZERO,
        )? {
            AuthFlowCompletionAction::KeepPending => {
                let result = CreateRemoteResult {
                    remote_name: remote_name.to_string(),
                    provider: provider.to_string(),
                    status: "pending".to_string(),
                    stage: Some("pending_auth".to_string()),
                    next_step: "open_browser".to_string(),
                    message: "Authentication is still in progress in your browser.".to_string(),
                    error_code: None,
                    drive_candidates: None,
                };
                let session = AuthSessionRecord {
                    remote_name: result.remote_name.clone(),
                    provider: result.provider.clone(),
                    mode: mode.to_string(),
                    status: result.status.clone(),
                    stage: auth_session_stage_from_result_status(&result.status),
                    next_step: result.next_step.clone(),
                    message: result.message.clone(),
                    updated_at_ms: crate::auth_session::now_timestamp_ms(),
                    error_code: result.error_code.clone(),
                    drive_candidates: result.drive_candidates.clone(),
                };
                set_auth_session_record(app, session);
                return Ok(result);
            }
            AuthFlowCompletionAction::TryFinalize => {
                log::info!(
                    "auth flow completed with saved config remote={} provider={} mode={} recovering_via_post_auth=true",
                    remote_name,
                    provider,
                    mode
                );
                return build_success_result(app, remote_name, provider, mode, error);
            }
            AuthFlowCompletionAction::FailPending => {
                let result = CreateRemoteResult {
                    remote_name: remote_name.to_string(),
                    provider: provider.to_string(),
                    status: "error".to_string(),
                    stage: Some("failed".to_string()),
                    next_step: "retry".to_string(),
                    message: STALLED_RECONNECT_MESSAGE.to_string(),
                    error_code: None,
                    drive_candidates: None,
                };
                let session = auth_session_record_from_result(mode, &result);
                set_auth_session_record(app, session);
                return Ok(result);
            }
            AuthFlowCompletionAction::ReturnError => {
                log::warn!(
                    "auth flow completed without recoverable saved config remote={} provider={} mode={}",
                    remote_name,
                    provider,
                    mode
                );
            }
        }
    }

    let result = match error_kind {
        RcloneErrorKind::DuplicateRemote => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "error".to_string(),
            stage: Some("failed".to_string()),
            next_step: "rename".to_string(),
            message: "A storage connection with that name already exists. Choose a different remote name."
                .to_string(),
            error_code: None,
            drive_candidates: None,
        },
        RcloneErrorKind::AuthCancelled => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "error".to_string(),
            stage: Some("failed".to_string()),
            next_step: "retry".to_string(),
            message: "Authentication was not completed. You can try again when you are ready."
                .to_string(),
            error_code: None,
            drive_candidates: None,
        },
        RcloneErrorKind::AuthCallbackUnavailable => callback_unavailable_result(remote_name, provider),
        RcloneErrorKind::AuthFlow => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "error".to_string(),
            stage: Some("failed".to_string()),
            next_step: "retry".to_string(),
            message:
                "Authentication finished, but Cloud Weave could not confirm the saved connection. Try again."
                    .to_string(),
            error_code: None,
            drive_candidates: None,
        },
        RcloneErrorKind::RcloneUnavailable => {
            return Err(
                "The bundled rclone binary could not be found. Run the rclone setup step and restart the app."
                    .to_string(),
            )
        }
        RcloneErrorKind::AlreadyExists
        | RcloneErrorKind::InsufficientSpace
        | RcloneErrorKind::UnsupportedAbout
        | RcloneErrorKind::AuthError
        | RcloneErrorKind::Other => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "error".to_string(),
            stage: Some("failed".to_string()),
            next_step: "retry".to_string(),
            message: user_facing_command_error(error),
            error_code: None,
            drive_candidates: None,
        },
    };

    let session = auth_session_record_from_result(mode, &result);
    set_auth_session_record(app, session);

    Ok(result)
}

pub(crate) fn auth_flow_completion_action(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    mode: &str,
    process_state: AuthProcessState,
    elapsed: std::time::Duration,
) -> Result<AuthFlowCompletionAction, String> {
    let config_path = ensure_rclone_config(app)?;
    let remote_config_by_name = load_remote_config_states(app, &config_path)?;
    let saved_state = remote_config_by_name.get(remote_name);
    let remote_exists = saved_state.is_some();
    let has_token = saved_state.and_then(|state| state.token.as_ref()).is_some();

    log::info!(
        "auth flow completion check remote={} provider={} process_state={:?} remote_exists={} has_token={}",
        remote_name,
        provider,
        process_state,
        remote_exists,
        has_token
    );

    Ok(decide_auth_flow_completion_action(
        provider,
        mode,
        process_state,
        remote_exists,
        has_token,
        elapsed >= MISSING_TOKEN_RECONNECT_TIMEOUT,
    ))
}

pub(crate) fn decide_auth_flow_completion_action(
    provider: &str,
    mode: &str,
    process_state: AuthProcessState,
    remote_exists: bool,
    has_token: bool,
    missing_token_reconnect_timed_out: bool,
) -> AuthFlowCompletionAction {
    if providers::provider_allows_saved_token_finalize(provider, remote_exists, has_token) {
        AuthFlowCompletionAction::TryFinalize
    } else if provider == "onedrive"
        && mode == "reconnect"
        && process_state == AuthProcessState::Running
        && remote_exists
        && !has_token
        && missing_token_reconnect_timed_out
    {
        AuthFlowCompletionAction::FailPending
    } else if process_state == AuthProcessState::Running {
        AuthFlowCompletionAction::KeepPending
    } else {
        AuthFlowCompletionAction::ReturnError
    }
}

pub(crate) fn build_success_result(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    mode: &str,
    stdout: &str,
) -> Result<CreateRemoteResult, String> {
    log::info!(
        "auth flow finished remote={} provider={} mode={} stdout={}",
        remote_name,
        provider,
        mode,
        summarize_output(stdout)
    );

    if let Some(message) = providers::provider_finalizing_message(provider) {
        set_auth_session_record(
            app,
            finalizing_auth_session(remote_name, provider, mode, message),
        );
    }

    let result =
        match providers::build_provider_post_auth_result(app, remote_name, provider, stdout) {
            Ok(result) => result,
            Err(error) => {
                log::warn!(
                    "provider post-auth finalization failed remote={} provider={} error={}",
                    remote_name,
                    provider,
                    summarize_output(&error)
                );

                CreateRemoteResult {
                    remote_name: remote_name.to_string(),
                    provider: provider.to_string(),
                    status: "error".to_string(),
                    stage: Some("failed".to_string()),
                    next_step: "retry".to_string(),
                    message: error,
                    error_code: None,
                    drive_candidates: None,
                }
            }
        };

    let session = auth_session_record_from_result(mode, &result);
    set_auth_session_record(app, session);

    if result.status == "connected" {
        remove_reconnect_request_record(app, remote_name);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::decide_auth_flow_completion_action;
    use crate::auth_session::{AuthFlowCompletionAction, AuthProcessState};

    #[test]
    fn auth_flow_completion_action_keeps_running_auth_pending_without_saved_token() {
        assert_eq!(
            decide_auth_flow_completion_action(
                "onedrive",
                "create",
                AuthProcessState::Running,
                false,
                false,
                false,
            ),
            AuthFlowCompletionAction::KeepPending
        );
    }

    #[test]
    fn auth_flow_completion_action_finalizes_running_onedrive_with_saved_token() {
        assert_eq!(
            decide_auth_flow_completion_action(
                "onedrive",
                "reconnect",
                AuthProcessState::Running,
                true,
                true,
                false,
            ),
            AuthFlowCompletionAction::TryFinalize
        );
    }

    #[test]
    fn auth_flow_completion_action_fails_stalled_tokenless_onedrive_reconnect() {
        assert_eq!(
            decide_auth_flow_completion_action(
                "onedrive",
                "reconnect",
                AuthProcessState::Running,
                true,
                false,
                true,
            ),
            AuthFlowCompletionAction::FailPending
        );
    }

    #[test]
    fn auth_flow_completion_action_retries_when_completed_remote_is_not_saved() {
        assert_eq!(
            decide_auth_flow_completion_action(
                "onedrive",
                "reconnect",
                AuthProcessState::Completed,
                false,
                false,
                false,
            ),
            AuthFlowCompletionAction::ReturnError
        );
    }

    #[test]
    fn auth_flow_completion_action_finalizes_completed_onedrive_with_saved_token() {
        assert_eq!(
            decide_auth_flow_completion_action(
                "onedrive",
                "reconnect",
                AuthProcessState::Completed,
                true,
                true,
                false,
            ),
            AuthFlowCompletionAction::TryFinalize
        );
    }
}
