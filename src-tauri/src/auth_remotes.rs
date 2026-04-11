use crate::{
    auth_flow::start_auth_flow,
    auth_session::{
        get_auth_session_record, remove_reconnect_request_record, AuthSessionRecord,
        CreateRemoteResult,
    },
    backend_common::ensure_rclone_config,
    ipc::types::CreateOneDriveRemoteInput,
    providers::onedrive::{
        finalize_remote as finalize_onedrive_remote_with_drive,
        list_drive_candidates as list_onedrive_drive_candidates_for_remote,
    },
    validate_remote_name,
};
use rclone_logic::OneDriveDriveCandidate;
use tauri::AppHandle;

#[tauri::command]
pub async fn create_onedrive_remote(
    app: AppHandle,
    input: CreateOneDriveRemoteInput,
) -> Result<CreateRemoteResult, String> {
    tauri::async_runtime::spawn_blocking(move || create_onedrive_remote_impl(app, input))
        .await
        .map_err(|error| format!("failed to join OneDrive setup task: {error}"))?
}

#[tauri::command]
pub async fn reconnect_remote(app: AppHandle, name: String) -> Result<CreateRemoteResult, String> {
    tauri::async_runtime::spawn_blocking(move || reconnect_remote_impl(app, name))
        .await
        .map_err(|error| format!("failed to join reconnect task: {error}"))?
}

#[tauri::command]
pub async fn list_onedrive_drive_candidates(
    app: AppHandle,
    name: String,
) -> Result<Vec<OneDriveDriveCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || list_onedrive_drive_candidates_impl(app, name))
        .await
        .map_err(|error| format!("failed to join drive candidate task: {error}"))?
}

#[tauri::command]
pub async fn finalize_onedrive_remote(
    app: AppHandle,
    name: String,
    drive_id: String,
) -> Result<CreateRemoteResult, String> {
    tauri::async_runtime::spawn_blocking(move || finalize_onedrive_remote_impl(app, name, drive_id))
        .await
        .map_err(|error| format!("failed to join drive finalization task: {error}"))?
}

#[tauri::command]
pub async fn get_auth_session_status(
    app: AppHandle,
    name: String,
) -> Result<Option<AuthSessionRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(get_auth_session_record(&app, &name)))
        .await
        .map_err(|error| format!("failed to join auth status task: {error}"))?
}

fn create_onedrive_remote_impl(
    app: AppHandle,
    input: CreateOneDriveRemoteInput,
) -> Result<CreateRemoteResult, String> {
    validate_remote_name(&input.remote_name)?;

    let config_path = ensure_rclone_config(&app)?;
    let mut owned_args = vec![
        "config".to_string(),
        "create".to_string(),
        input.remote_name.clone(),
        "onedrive".to_string(),
        "config_is_local=true".to_string(),
    ];

    if let Some(client_id) = input.client_id.filter(|value| !value.trim().is_empty()) {
        owned_args.push(format!("client_id={client_id}"));
    }

    if let Some(client_secret) = input.client_secret.filter(|value| !value.trim().is_empty()) {
        owned_args.push(format!("client_secret={client_secret}"));
    }

    owned_args.push("--config".to_string());
    owned_args.push(config_path.to_string_lossy().into_owned());

    start_auth_flow(&app, &input.remote_name, "onedrive", "create", &owned_args)
}

fn reconnect_remote_impl(app: AppHandle, name: String) -> Result<CreateRemoteResult, String> {
    validate_remote_name(&name)?;

    let config_path = ensure_rclone_config(&app)?;
    let remote_target = format!("{name}:");
    let owned_args = vec![
        "config".to_string(),
        "reconnect".to_string(),
        remote_target,
        "--config".to_string(),
        config_path.to_string_lossy().into_owned(),
    ];

    let result = start_auth_flow(&app, &name, "onedrive", "reconnect", &owned_args)?;

    if result.status == "connected" {
        remove_reconnect_request_record(&app, &name);
    }

    Ok(result)
}

fn list_onedrive_drive_candidates_impl(
    app: AppHandle,
    name: String,
) -> Result<Vec<OneDriveDriveCandidate>, String> {
    validate_remote_name(&name)?;
    list_onedrive_drive_candidates_for_remote(&app, &name)
}

fn finalize_onedrive_remote_impl(
    app: AppHandle,
    name: String,
    drive_id: String,
) -> Result<CreateRemoteResult, String> {
    validate_remote_name(&name)?;
    finalize_onedrive_remote_with_drive(&app, &name, &drive_id)
}
