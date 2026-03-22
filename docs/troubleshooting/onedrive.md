# OneDrive Troubleshooting

Use this note when a OneDrive remote authenticates in the browser but still fails inside Cloud Weave.

## Inspect the saved app config

```powershell
.\src-tauri\binaries\rclone-x86_64-pc-windows-msvc.exe config show --config "$env:APPDATA\com.ryotaro.cloudweave\rclone.conf"
.\src-tauri\binaries\rclone-x86_64-pc-windows-msvc.exe lsd <remote-name>: --config "$env:APPDATA\com.ryotaro.cloudweave\rclone.conf" -vv
```

## Common issues

- Missing `drive_id` or `drive_type`
  The OneDrive connection was authenticated, but Cloud Weave could not finish drive selection.
- Multiple OneDrive drives found
  Choose the intended drive, usually `OneDrive (personal)` when it is reachable and matches the user-facing library.
- Protected or unsupported folders fail during unified listing
  Cloud Weave skips those folders during staged listing and continues loading the rest of the library.

## Manual recovery

If the remote exists but still lacks `drive_id` or `drive_type`, use interactive `rclone config` against the same config file and confirm which drive should be used for that account.
