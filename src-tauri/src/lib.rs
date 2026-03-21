use serde::{Deserialize, Serialize};
use rclone_logic::{
    classify_rclone_error,
    parse_listremotes,
    parse_provider_map,
    RcloneErrorKind,
};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const RCLONE_BINARY: &str = "rclone-x86_64-pc-windows-msvc.exe";
const AUTH_COMMAND_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_millis(250);
const AUTH_START_GRACE_PERIOD: Duration = Duration::from_millis(350);

#[derive(Default)]
struct AuthSessionStore {
    sessions: Mutex<HashMap<String, AuthSessionRecord>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteSummary {
    name: String,
    provider: String,
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateOneDriveRemoteInput {
    remote_name: String,
    client_id: Option<String>,
    client_secret: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateRemoteResult {
    remote_name: String,
    provider: String,
    status: String,
    next_step: String,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSessionRecord {
    remote_name: String,
    provider: String,
    mode: String,
    status: String,
    next_step: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    status: String,
    message: String,
}

#[tauri::command]
async fn list_storage_remotes(app: AppHandle) -> Result<Vec<RemoteSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_storage_remotes_impl(app))
        .await
        .map_err(|error| format!("failed to join storage list task: {error}"))?
}

#[tauri::command]
async fn create_onedrive_remote(
    app: AppHandle,
    input: CreateOneDriveRemoteInput,
) -> Result<CreateRemoteResult, String> {
    tauri::async_runtime::spawn_blocking(move || create_onedrive_remote_impl(app, input))
        .await
        .map_err(|error| format!("failed to join OneDrive setup task: {error}"))?
}

#[tauri::command]
async fn reconnect_remote(app: AppHandle, name: String) -> Result<CreateRemoteResult, String> {
    tauri::async_runtime::spawn_blocking(move || reconnect_remote_impl(app, name))
        .await
        .map_err(|error| format!("failed to join reconnect task: {error}"))?
}

#[tauri::command]
async fn get_auth_session_status(
    app: AppHandle,
    name: String,
) -> Result<Option<AuthSessionRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(get_auth_session_record(&app, &name)))
        .await
        .map_err(|error| format!("failed to join auth status task: {error}"))?
}

#[tauri::command]
async fn delete_remote(app: AppHandle, name: String) -> Result<ActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || delete_remote_impl(app, name))
        .await
        .map_err(|error| format!("failed to join delete task: {error}"))?
}

fn list_storage_remotes_impl(app: AppHandle) -> Result<Vec<RemoteSummary>, String> {
    let config_path = ensure_rclone_config(&app)?;
    let stdout = run_rclone(
        &app,
        &["listremotes", "--json", "--config"],
        &[config_path.as_os_str()],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    let remotes = parse_listremotes(&stdout)?;
    let provider_by_remote = load_remote_types(&app, &config_path)?;

    let mut summaries = remotes
        .into_iter()
        .map(|remote_name| {
            let provider = provider_by_remote
                .get(&remote_name)
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());

            RemoteSummary {
                name: remote_name,
                provider,
                status: "connected".to_string(),
            }
        })
        .collect::<Vec<_>>();

    summaries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(summaries)
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

    start_auth_flow(&app, &name, "onedrive", "reconnect", &owned_args)
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

fn start_auth_flow(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    mode: &str,
    args: &[String],
) -> Result<CreateRemoteResult, String> {
    if let Some(existing) = get_auth_session_record(app, remote_name) {
        if existing.status == "pending" {
            return Ok(CreateRemoteResult {
                remote_name: remote_name.to_string(),
                provider: provider.to_string(),
                status: "pending".to_string(),
                next_step: "open_browser".to_string(),
                message: "Authentication is already in progress for this storage.".to_string(),
            });
        }
    }

    let mut child = spawn_rclone_owned(app, args)?;
    thread::sleep(AUTH_START_GRACE_PERIOD);

    match child.try_wait() {
        Ok(Some(_)) => match collect_child_output(child) {
            Ok(stdout) => {
                let record =
                    success_auth_session(remote_name, provider, mode, &success_message(&stdout));
                set_auth_session_record(app, record.clone());

                Ok(CreateRemoteResult {
                    remote_name: record.remote_name,
                    provider: record.provider,
                    status: record.status,
                    next_step: record.next_step,
                    message: record.message,
                })
            }
            Err(error) => build_auth_error_result(app, remote_name, provider, mode, &error),
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
                next_step: "open_browser".to_string(),
                message:
                    "Authentication started in your browser. Return here after you finish signing in."
                        .to_string(),
            })
        }
        Err(error) => {
            kill_child(&mut child);
            Err(format!("failed while checking rclone process: {error}"))
        }
    }
}

fn spawn_auth_watcher(
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
                            let record = success_auth_session(
                                &remote_name,
                                &provider,
                                &mode,
                                &success_message(&stdout),
                            );
                            set_auth_session_record(&app, record);
                        }
                        Err(error) => {
                            if let Ok(result) = build_auth_error_result(
                                &app,
                                &remote_name,
                                &provider,
                                &mode,
                                &error,
                            ) {
                                let record = AuthSessionRecord {
                                    remote_name: result.remote_name,
                                    provider: result.provider,
                                    mode: mode.clone(),
                                    status: result.status,
                                    next_step: result.next_step,
                                    message: result.message,
                                };
                                set_auth_session_record(&app, record);
                            }
                        }
                    }

                    break;
                }
                Ok(None) => {
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

fn build_auth_error_result(
    app: &AppHandle,
    remote_name: &str,
    provider: &str,
    mode: &str,
    error: &str,
) -> Result<CreateRemoteResult, String> {
    let result = match classify_rclone_error(error) {
        RcloneErrorKind::DuplicateRemote => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "error".to_string(),
            next_step: "rename".to_string(),
            message: "A storage connection with that name already exists. Choose a different remote name."
                .to_string(),
        },
        RcloneErrorKind::AuthCancelled => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "error".to_string(),
            next_step: "retry".to_string(),
            message: "Authentication was not completed. You can try again when you are ready."
                .to_string(),
        },
        RcloneErrorKind::AuthFlow => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "pending".to_string(),
            next_step: "open_browser".to_string(),
            message: "Authentication is still in progress in your browser.".to_string(),
        },
        RcloneErrorKind::RcloneUnavailable => {
            return Err(
                "The bundled rclone binary could not be found. Run the rclone setup step and restart the app."
                    .to_string(),
            )
        }
        RcloneErrorKind::Other => CreateRemoteResult {
            remote_name: remote_name.to_string(),
            provider: provider.to_string(),
            status: "error".to_string(),
            next_step: "retry".to_string(),
            message: user_facing_command_error(error),
        },
    };

    let session = AuthSessionRecord {
        remote_name: result.remote_name.clone(),
        provider: result.provider.clone(),
        mode: mode.to_string(),
        status: result.status.clone(),
        next_step: result.next_step.clone(),
        message: result.message.clone(),
    };
    set_auth_session_record(app, session);

    Ok(result)
}

pub fn run() {
    tauri::Builder::default()
        .manage(AuthSessionStore::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            list_storage_remotes,
            create_onedrive_remote,
            reconnect_remote,
            get_auth_session_status,
            delete_remote
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn ensure_rclone_config(app: &AppHandle) -> Result<PathBuf, String> {
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

fn resolve_rclone_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("binaries").join(RCLONE_BINARY));
        candidates.push(resource_dir.join(RCLONE_BINARY));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(RCLONE_BINARY));
            candidates.push(exe_dir.join("binaries").join(RCLONE_BINARY));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(
            current_dir
                .join("src-tauri")
                .join("binaries")
                .join(RCLONE_BINARY),
        );
        candidates.push(current_dir.join("binaries").join(RCLONE_BINARY));
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| "rclone binary was not found in the expected locations".to_string())
}

fn run_rclone(
    app: &AppHandle,
    static_args: &[&str],
    path_args: &[&std::ffi::OsStr],
    timeout: Duration,
) -> Result<String, String> {
    let binary = resolve_rclone_binary(app)?;
    let mut command = Command::new(binary);
    command.args(static_args);
    command.args(path_args);
    execute_command(command, timeout)
}

fn run_rclone_owned(app: &AppHandle, args: &[String], timeout: Duration) -> Result<String, String> {
    let binary = resolve_rclone_binary(app)?;
    let mut command = Command::new(binary);
    command.args(args);
    execute_command(command, timeout)
}

fn spawn_rclone_owned(app: &AppHandle, args: &[String]) -> Result<Child, String> {
    let binary = resolve_rclone_binary(app)?;
    let mut command = Command::new(binary);
    command.args(args);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    command
        .spawn()
        .map_err(|error| format!("failed to run rclone: {error}"))
}

fn execute_command(mut command: Command, timeout: Duration) -> Result<String, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to run rclone: {error}"))?;

    let start = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_)) => return collect_child_output(child),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    kill_child(&mut child);
                    return Err(format!(
                        "operation timed out after {} seconds",
                        timeout.as_secs()
                    ));
                }
            }
            Err(error) => {
                kill_child(&mut child);
                return Err(format!("failed while waiting for rclone: {error}"));
            }
        }

        thread::sleep(POLL_INTERVAL);
    }
}

fn collect_child_output(child: Child) -> Result<String, String> {
    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to collect rclone output: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        let detail = if stderr.is_empty() { stdout } else { stderr };
        Err(detail)
    }
}

fn kill_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn load_remote_types(
    app: &AppHandle,
    config_path: &Path,
) -> Result<HashMap<String, String>, String> {
    let config_text = run_rclone(
        app,
        &["config", "show", "--config"],
        &[config_path.as_os_str()],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    Ok(parse_provider_map(&config_text))
}

fn validate_remote_name(remote_name: &str) -> Result<(), String> {
    let trimmed = remote_name.trim();

    if trimmed.is_empty() {
        return Err("Remote name is required.".to_string());
    }

    if trimmed.contains(':') || trimmed.contains(' ') {
        return Err("Remote name cannot contain spaces or colons.".to_string());
    }

    Ok(())
}

fn success_message(stdout: &str) -> String {
    if stdout.trim().is_empty() {
        "The storage connection was saved successfully.".to_string()
    } else {
        "Your storage is connected and ready to use.".to_string()
    }
}

fn user_facing_command_error(detail: &str) -> String {
    if detail.is_empty() {
        "rclone could not complete the request. Try again.".to_string()
    } else {
        format!("rclone could not complete the request: {detail}")
    }
}

fn pending_auth_session(
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
        next_step: "open_browser".to_string(),
        message: message.to_string(),
    }
}

fn success_auth_session(
    remote_name: &str,
    provider: &str,
    mode: &str,
    message: &str,
) -> AuthSessionRecord {
    AuthSessionRecord {
        remote_name: remote_name.to_string(),
        provider: provider.to_string(),
        mode: mode.to_string(),
        status: "connected".to_string(),
        next_step: "done".to_string(),
        message: message.to_string(),
    }
}

fn error_auth_session(
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
        next_step: "retry".to_string(),
        message: message.to_string(),
    }
}

fn set_auth_session_record(app: &AppHandle, record: AuthSessionRecord) {
    let store = app.state::<AuthSessionStore>();
    let Ok(mut sessions) = store.sessions.lock() else {
        return;
    };
    sessions.insert(record.remote_name.clone(), record);
}

fn get_auth_session_record(app: &AppHandle, remote_name: &str) -> Option<AuthSessionRecord> {
    let store = app.state::<AuthSessionStore>();
    store
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(remote_name).cloned())
}

fn remove_auth_session_record(app: &AppHandle, remote_name: &str) {
    let store = app.state::<AuthSessionStore>();
    let Ok(mut sessions) = store.sessions.lock() else {
        return;
    };
    sessions.remove(remote_name);
}
