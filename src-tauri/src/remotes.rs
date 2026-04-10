use crate::{
    auth_session::remove_auth_session_record,
    backend_common::{default_remote_config_state, ensure_rclone_config, user_facing_command_error},
    ipc::types::{ActionResult, RemoteSummary},
    load_remote_config_states, remote_status, remote_status_message, run_rclone, run_rclone_owned,
    validate_remote_name, DEFAULT_COMMAND_TIMEOUT,
};
use tauri::AppHandle;

#[tauri::command]
pub async fn list_storage_remotes(app: AppHandle) -> Result<Vec<RemoteSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_storage_remotes_impl(app))
        .await
        .map_err(|error| format!("failed to join storage list task: {error}"))?
}

#[tauri::command]
pub async fn delete_remote(app: AppHandle, name: String) -> Result<ActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || delete_remote_impl(app, name))
        .await
        .map_err(|error| format!("failed to join delete task: {error}"))?
}

pub(crate) fn list_storage_remotes_impl(app: AppHandle) -> Result<Vec<RemoteSummary>, String> {
    let config_path = ensure_rclone_config(&app)?;
    let stdout = run_rclone(
        &app,
        &["listremotes", "--json", "--config"],
        &[config_path.as_os_str()],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    let remotes = rclone_logic::parse_listremotes(&stdout)?;
    let remote_config_by_name = load_remote_config_states(&app, &config_path)?;

    let mut summaries = remotes
        .into_iter()
        .map(|remote_name| {
            let config_state = remote_config_by_name
                .get(&remote_name)
                .cloned()
                .unwrap_or_else(default_remote_config_state);
            let status = remote_status(&app, &remote_name, &config_state).to_string();
            let message = remote_status_message(&app, &remote_name, &config_state);

            RemoteSummary {
                name: remote_name,
                provider: config_state.provider.clone(),
                status,
                message,
            }
        })
        .collect::<Vec<_>>();

    summaries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(summaries)
}

fn delete_remote_impl(app: AppHandle, name: String) -> Result<ActionResult, String> {
    validate_remote_name(&name)?;

    let config_path = ensure_rclone_config(&app)?;
    let owned_args = vec![
        "config".to_string(),
        "delete".to_string(),
        name.clone(),
        "--config".to_string(),
        config_path.to_string_lossy().into_owned(),
    ];

    match run_rclone_owned(&app, &owned_args, DEFAULT_COMMAND_TIMEOUT) {
        Ok(_) => {
            remove_auth_session_record(&app, &name);
            Ok(ActionResult {
                status: "success".to_string(),
                message: format!("{name} was removed."),
            })
        }
        Err(error) => Ok(ActionResult {
            status: "error".to_string(),
            message: user_facing_command_error(&error),
        }),
    }
}
