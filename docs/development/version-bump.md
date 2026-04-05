# Version Bump

When bumping the Cloud Weave app version, update only the product-facing version fields:

- `package.json`
- `package-lock.json` root package entry
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src/App.tsx` for the feedback form `appVersion`
- `src-tauri/Cargo.lock` only for the `[[package]] name = "app"` entry

Do not change dependency or internal crate versions just for a Cloud Weave release label.

- Leave `src-tauri/crates/rclone_logic/Cargo.toml` unchanged unless that crate itself needs a separate version bump
- Do not mass-replace versions inside `src-tauri/Cargo.lock`
