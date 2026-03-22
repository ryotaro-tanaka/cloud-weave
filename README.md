# Cloud Weave

Cloud Weave is a Windows desktop app that aims to make multi-cloud file management easier.

The project is built as a desktop UI layer on top of rclone.  
Instead of building a new sync engine, Cloud Weave focuses on usability, workspace design, and a simpler experience for managing files across multiple cloud storage providers.

## Goals

- Provide a simple desktop UI for multi-cloud workflows
- Present multiple storage providers in a unified workspace
- Make file placement easier without forcing users to think about low-level storage details
- Build an app that feels approachable for non-technical users

## Current Status

This project is in an early prototype stage.

At the moment:
- the desktop app foundation is set up with Tauri
- the frontend foundation is set up with React + TypeScript + Vite
- rclone integration is the next major step

## Tech Stack

- Tauri
- React
- TypeScript
- Vite
- rclone

## Project Direction

Cloud Weave is intended to be a thin UI wrapper around rclone.

That means:
- rclone handles storage operations
- Cloud Weave provides the desktop experience
- the app focuses on workspaces, visibility, and interaction design

## Planned Features

- Multi-cloud workspace view
- File browsing across connected storage providers
- Better visibility into where files are stored
- Smarter file placement based on available space
- A cleaner workflow for moving and organizing files

## Non-Goals

- Replacing rclone's core engine
- Building a brand new cloud sync protocol
- Supporting every advanced rclone feature in the first version

## Development

This repository currently contains the Tauri + React app foundation.

Typical local development commands:

```bash
npm run dev
npm run build
npm run test:run
cargo test --manifest-path src-tauri/crates/rclone_logic/Cargo.toml
```

Node.js version:

```bash
24.14.0
```

The project pins this via `.nvmrc`, `.node-version`, and `package.json` `engines`.

## OneDrive Debug Workflow

If a OneDrive remote authenticates in the browser but still fails inside Cloud Weave, inspect the app config directly:

```powershell
.\src-tauri\binaries\rclone-x86_64-pc-windows-msvc.exe config show --config "$env:APPDATA\com.ryotaro.cloudweave\rclone.conf"
.\src-tauri\binaries\rclone-x86_64-pc-windows-msvc.exe lsd <remote-name>: --config "$env:APPDATA\com.ryotaro.cloudweave\rclone.conf" -vv
```

If the remote exists but still lacks `drive_id` or `drive_type`, use interactive `rclone config` against the same config file to confirm whether the issue is specific to Cloud Weave's setup flow.

## note

This is an experimental project and the structure may change frequently while the app direction is still being refined.

## LICENSES

Cloud Weave bundles rclone. See `THIRD_PARTY_NOTICES.md` and `LICENSES/rclone-MIT.txt`.
