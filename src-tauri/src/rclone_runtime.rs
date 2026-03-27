use rclone_logic::{parse_remote_config_state_map, RemoteConfigState};
use std::{
    collections::HashMap,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

pub(crate) const RCLONE_BINARY: &str = "rclone-x86_64-pc-windows-msvc.exe";
pub(crate) const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
pub(crate) const INVENTORY_COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
pub(crate) const POLL_INTERVAL: Duration = Duration::from_millis(250);
pub(crate) const AUTH_START_GRACE_PERIOD: Duration = Duration::from_millis(350);
pub(crate) const GRAPH_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
pub(crate) const AUTH_CALLBACK_BIND_ADDR: &str = "127.0.0.1:53682";

pub(crate) fn resolve_rclone_binary(app: &AppHandle) -> Result<PathBuf, String> {
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

pub(crate) fn run_rclone(
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

pub(crate) fn run_rclone_owned(
    app: &AppHandle,
    args: &[String],
    timeout: Duration,
) -> Result<String, String> {
    let binary = resolve_rclone_binary(app)?;
    let mut command = Command::new(binary);
    command.args(args);
    execute_command(command, timeout)
}

pub(crate) fn spawn_rclone_owned(app: &AppHandle, args: &[String]) -> Result<Child, String> {
    let binary = resolve_rclone_binary(app)?;
    let mut command = Command::new(binary);
    command.args(args);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    command
        .spawn()
        .map_err(|error| format!("failed to run rclone: {error}"))
}

pub(crate) fn execute_command(mut command: Command, timeout: Duration) -> Result<String, String> {
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

pub(crate) fn collect_child_output(child: Child) -> Result<String, String> {
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

pub(crate) fn kill_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn load_remote_config_states(
    app: &AppHandle,
    config_path: &Path,
) -> Result<HashMap<String, RemoteConfigState>, String> {
    let config_text = run_rclone(
        app,
        &["config", "show", "--config"],
        &[config_path.as_os_str()],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    Ok(parse_remote_config_state_map(&config_text))
}

pub(crate) fn ensure_auth_callback_available() -> Result<(), String> {
    match TcpListener::bind(AUTH_CALLBACK_BIND_ADDR) {
        Ok(listener) => {
            drop(listener);
            log::info!(
                "auth callback preflight port={} available=true",
                AUTH_CALLBACK_BIND_ADDR
            );
            Ok(())
        }
        Err(error) => {
            log::info!(
                "auth callback preflight port={} available=false",
                AUTH_CALLBACK_BIND_ADDR
            );
            Err(error.to_string())
        }
    }
}
