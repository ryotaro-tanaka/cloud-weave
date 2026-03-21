use serde::{Deserialize, Serialize};
use std::{
  collections::HashMap,
  fs,
  path::{Path, PathBuf},
  process::Command,
};
use tauri::{AppHandle, Manager};

const RCLONE_BINARY: &str = "rclone-x86_64-pc-windows-msvc.exe";

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateRemoteResult {
  remote_name: String,
  provider: String,
  status: String,
  next_step: String,
  message: String,
}

#[tauri::command]
fn list_storage_remotes(app: AppHandle) -> Result<Vec<RemoteSummary>, String> {
  let config_path = ensure_rclone_config(&app)?;
  let stdout = run_rclone(&app, &["listremotes", "--json", "--config"], &[config_path.as_os_str()])?;
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

#[tauri::command]
fn create_onedrive_remote(
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

  if let Some(client_secret) = input
    .client_secret
    .filter(|value| !value.trim().is_empty())
  {
    owned_args.push(format!("client_secret={client_secret}"));
  }

  owned_args.push("--config".to_string());
  owned_args.push(config_path.to_string_lossy().into_owned());

  match run_rclone_owned(&app, &owned_args) {
    Ok(stdout) => Ok(CreateRemoteResult {
      remote_name: input.remote_name,
      provider: "onedrive".to_string(),
      status: "connected".to_string(),
      next_step: "done".to_string(),
      message: success_message(&stdout),
    }),
    Err(error) => match classify_rclone_error(&error) {
      RcloneErrorKind::DuplicateRemote => Ok(CreateRemoteResult {
        remote_name: input.remote_name,
        provider: "onedrive".to_string(),
        status: "error".to_string(),
        next_step: "rename".to_string(),
        message: "A storage connection with that name already exists. Choose a different remote name.".to_string(),
      }),
      RcloneErrorKind::AuthFlow => Ok(CreateRemoteResult {
        remote_name: input.remote_name,
        provider: "onedrive".to_string(),
        status: "pending".to_string(),
        next_step: "open_browser".to_string(),
        message: "Browser authentication was started but did not complete yet. Finish the Microsoft sign-in flow, then refresh the storage list.".to_string(),
      }),
      RcloneErrorKind::RcloneUnavailable => Err(
        "The bundled rclone binary could not be found. Run the rclone setup step and restart the app.".to_string(),
      ),
      RcloneErrorKind::Other => Ok(CreateRemoteResult {
        remote_name: input.remote_name,
        provider: "onedrive".to_string(),
        status: "error".to_string(),
        next_step: "retry".to_string(),
        message: user_facing_command_error(&error),
      }),
    },
  }
}

#[tauri::command]
fn reconnect_remote(app: AppHandle, name: String) -> Result<CreateRemoteResult, String> {
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

  match run_rclone_owned(&app, &owned_args) {
    Ok(stdout) => Ok(CreateRemoteResult {
      remote_name: name,
      provider: "onedrive".to_string(),
      status: "connected".to_string(),
      next_step: "done".to_string(),
      message: success_message(&stdout),
    }),
    Err(error) => match classify_rclone_error(&error) {
      RcloneErrorKind::AuthFlow => Ok(CreateRemoteResult {
        remote_name: name,
        provider: "onedrive".to_string(),
        status: "pending".to_string(),
        next_step: "open_browser".to_string(),
        message: "Browser authentication is still in progress. Complete the Microsoft sign-in flow, then refresh the list.".to_string(),
      }),
      RcloneErrorKind::RcloneUnavailable => Err(
        "The bundled rclone binary could not be found. Run the rclone setup step and restart the app.".to_string(),
      ),
      _ => Ok(CreateRemoteResult {
        remote_name: name,
        provider: "onedrive".to_string(),
        status: "error".to_string(),
        next_step: "retry".to_string(),
        message: user_facing_command_error(&error),
      }),
    },
  }
}

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
    .invoke_handler(tauri::generate_handler![
      list_storage_remotes,
      create_onedrive_remote,
      reconnect_remote
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
    candidates.push(current_dir.join("src-tauri").join("binaries").join(RCLONE_BINARY));
    candidates.push(current_dir.join("binaries").join(RCLONE_BINARY));
  }

  candidates
    .into_iter()
    .find(|candidate| candidate.exists())
    .ok_or_else(|| "rclone binary was not found in the expected locations".to_string())
}

fn run_rclone(app: &AppHandle, static_args: &[&str], path_args: &[&std::ffi::OsStr]) -> Result<String, String> {
  let binary = resolve_rclone_binary(app)?;
  let mut command = Command::new(binary);
  command.args(static_args);
  command.args(path_args);
  execute_command(command)
}

fn run_rclone_owned(app: &AppHandle, args: &[String]) -> Result<String, String> {
  let binary = resolve_rclone_binary(app)?;
  let mut command = Command::new(binary);
  command.args(args);
  execute_command(command)
}

fn execute_command(mut command: Command) -> Result<String, String> {
  let output = command
    .output()
    .map_err(|error| format!("failed to run rclone: {error}"))?;

  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

  if output.status.success() {
    Ok(stdout)
  } else {
    let detail = if stderr.is_empty() { stdout } else { stderr };
    Err(detail)
  }
}

fn parse_listremotes(raw: &str) -> Result<Vec<String>, String> {
  if raw.trim().is_empty() {
    return Ok(Vec::new());
  }

  let parsed = serde_json::from_str::<Vec<String>>(raw)
    .map_err(|error| format!("failed to parse rclone listremotes output: {error}"))?;

  Ok(
    parsed
      .into_iter()
      .map(|remote| remote.trim_end_matches(':').to_string())
      .filter(|remote| !remote.is_empty())
      .collect(),
  )
}

fn load_remote_types(app: &AppHandle, config_path: &Path) -> Result<HashMap<String, String>, String> {
  let config_text = run_rclone(app, &["config", "show", "--config"], &[config_path.as_os_str()])?;
  Ok(parse_provider_map(&config_text))
}

fn parse_provider_map(config_text: &str) -> HashMap<String, String> {
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
    "The storage connection was saved and browser authentication completed.".to_string()
  }
}

fn user_facing_command_error(detail: &str) -> String {
  if detail.is_empty() {
    "rclone could not complete the request. Try again and confirm the browser sign-in finished.".to_string()
  } else {
    format!("rclone could not complete the request: {detail}")
  }
}

enum RcloneErrorKind {
  DuplicateRemote,
  AuthFlow,
  RcloneUnavailable,
  Other,
}

fn classify_rclone_error(detail: &str) -> RcloneErrorKind {
  let normalized = detail.to_lowercase();

  if normalized.contains("already exists") {
    return RcloneErrorKind::DuplicateRemote;
  }

  if normalized.contains("failed to run rclone") || normalized.contains("binary was not found") {
    return RcloneErrorKind::RcloneUnavailable;
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
