use rclone_logic::OneDriveDriveCandidate;
use serde::Serialize;
use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Manager};

pub(crate) const AUTH_CALLBACK_UNAVAILABLE_CODE: &str = "auth_callback_unavailable";

#[derive(Default)]
pub(crate) struct AuthSessionStore {
    pub(crate) sessions: Mutex<HashMap<String, AuthSessionRecord>>,
}

#[derive(Default)]
pub(crate) struct ReconnectRequestStore {
    pub(crate) remotes: Mutex<HashMap<String, ReconnectRequestRecord>>,
}

#[derive(Clone, Debug)]
pub(crate) struct ReconnectRequestRecord {
    pub(crate) remote_name: String,
    pub(crate) message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateRemoteResult {
    pub(crate) remote_name: String,
    pub(crate) provider: String,
    pub(crate) status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) stage: Option<String>,
    pub(crate) next_step: String,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) drive_candidates: Option<Vec<OneDriveDriveCandidate>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AuthProcessState {
    Running,
    Completed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AuthFlowCompletionAction {
    KeepPending,
    TryFinalize,
    ReturnError,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthSessionRecord {
    pub(crate) remote_name: String,
    pub(crate) provider: String,
    pub(crate) mode: String,
    pub(crate) status: String,
    pub(crate) stage: String,
    pub(crate) next_step: String,
    pub(crate) message: String,
    pub(crate) updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) drive_candidates: Option<Vec<OneDriveDriveCandidate>>,
}

pub(crate) fn callback_unavailable_message() -> String {
    "Cloud Weave could not start the local sign-in callback on port 53682. Close other stalled sign-in windows or retry."
        .to_string()
}

pub(crate) fn callback_unavailable_result(remote_name: &str, provider: &str) -> CreateRemoteResult {
    CreateRemoteResult {
        remote_name: remote_name.to_string(),
        provider: provider.to_string(),
        status: "error".to_string(),
        stage: Some("failed".to_string()),
        next_step: "retry".to_string(),
        message: callback_unavailable_message(),
        error_code: Some(AUTH_CALLBACK_UNAVAILABLE_CODE.to_string()),
        drive_candidates: None,
    }
}

pub(crate) fn pending_auth_session(
    remote_name: &str,
    provider: &str,
    mode: &str,
    message: &str,
) -> AuthSessionRecord {
    AuthSessionRecord {
        remote_name: remote_name.to_string(),
        provider: provider.to_string(),
        mode: mode.to_string(),
        status: "pending".to_string(),
        stage: "pending_auth".to_string(),
        next_step: "open_browser".to_string(),
        message: message.to_string(),
        updated_at_ms: now_timestamp_ms(),
        error_code: None,
        drive_candidates: None,
    }
}

pub(crate) fn finalizing_auth_session(
    remote_name: &str,
    provider: &str,
    mode: &str,
    message: &str,
) -> AuthSessionRecord {
    AuthSessionRecord {
        remote_name: remote_name.to_string(),
        provider: provider.to_string(),
        mode: mode.to_string(),
        status: "pending".to_string(),
        stage: "finalizing".to_string(),
        next_step: "done".to_string(),
        message: message.to_string(),
        updated_at_ms: now_timestamp_ms(),
        error_code: None,
        drive_candidates: None,
    }
}

pub(crate) fn error_auth_session(
    remote_name: &str,
    provider: &str,
    mode: &str,
    message: &str,
) -> AuthSessionRecord {
    AuthSessionRecord {
        remote_name: remote_name.to_string(),
        provider: provider.to_string(),
        mode: mode.to_string(),
        status: "error".to_string(),
        stage: "failed".to_string(),
        next_step: "retry".to_string(),
        message: message.to_string(),
        updated_at_ms: now_timestamp_ms(),
        error_code: None,
        drive_candidates: None,
    }
}

pub(crate) fn auth_session_stage_from_result_status(status: &str) -> String {
    match status {
        "connected" => "connected",
        "requires_drive_selection" => "requires_drive_selection",
        "error" => "failed",
        _ => "pending_auth",
    }
    .to_string()
}

pub(crate) fn auth_session_record_from_result(
    mode: &str,
    result: &CreateRemoteResult,
) -> AuthSessionRecord {
    AuthSessionRecord {
        remote_name: result.remote_name.clone(),
        provider: result.provider.clone(),
        mode: mode.to_string(),
        status: result.status.clone(),
        stage: result
            .stage
            .clone()
            .unwrap_or_else(|| auth_session_stage_from_result_status(&result.status)),
        next_step: result.next_step.clone(),
        message: result.message.clone(),
        updated_at_ms: now_timestamp_ms(),
        error_code: result.error_code.clone(),
        drive_candidates: result.drive_candidates.clone(),
    }
}

pub(crate) fn now_timestamp_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

pub(crate) fn set_auth_session_record(app: &AppHandle, record: AuthSessionRecord) {
    let store = app.state::<AuthSessionStore>();
    let Ok(mut sessions) = store.sessions.lock() else {
        return;
    };
    sessions.insert(record.remote_name.clone(), record);
}

pub(crate) fn get_auth_session_record(
    app: &AppHandle,
    remote_name: &str,
) -> Option<AuthSessionRecord> {
    let store = app.state::<AuthSessionStore>();
    store
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(remote_name).cloned())
}

pub(crate) fn remove_auth_session_record(app: &AppHandle, remote_name: &str) {
    let store = app.state::<AuthSessionStore>();
    let Ok(mut sessions) = store.sessions.lock() else {
        return;
    };
    sessions.remove(remote_name);
}

pub(crate) fn set_reconnect_request_record(app: &AppHandle, record: ReconnectRequestRecord) {
    let store = app.state::<ReconnectRequestStore>();
    let Ok(mut remotes) = store.remotes.lock() else {
        return;
    };
    remotes.insert(record.remote_name.clone(), record);
}

pub(crate) fn get_reconnect_request_record(
    app: &AppHandle,
    remote_name: &str,
) -> Option<ReconnectRequestRecord> {
    let store = app.state::<ReconnectRequestStore>();
    store
        .remotes
        .lock()
        .ok()
        .and_then(|remotes| remotes.get(remote_name).cloned())
}

pub(crate) fn remove_reconnect_request_record(app: &AppHandle, remote_name: &str) {
    let store = app.state::<ReconnectRequestStore>();
    let Ok(mut remotes) = store.remotes.lock() else {
        return;
    };
    remotes.remove(remote_name);
}

pub(crate) fn reconnect_request_record(
    remote_name: &str,
    message: &str,
) -> ReconnectRequestRecord {
    ReconnectRequestRecord {
        remote_name: remote_name.to_string(),
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        callback_unavailable_result, finalizing_auth_session, AUTH_CALLBACK_UNAVAILABLE_CODE,
    };

    #[test]
    fn callback_unavailable_result_sets_dedicated_error_code() {
        let result = callback_unavailable_result("taro", "onedrive");
        assert_eq!(result.status, "error");
        assert_eq!(result.next_step, "retry");
        assert_eq!(
            result.error_code.as_deref(),
            Some(AUTH_CALLBACK_UNAVAILABLE_CODE)
        );
    }

    #[test]
    fn finalizing_auth_session_marks_browser_work_as_done() {
        let session = finalizing_auth_session(
            "taro",
            "onedrive",
            "create",
            "Cloud Weave is finalizing this OneDrive connection.",
        );
        assert_eq!(session.status, "pending");
        assert_eq!(session.stage, "finalizing");
        assert_eq!(session.next_step, "done");
    }
}
