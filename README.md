# Cloud Weave

Cloud Weave is a Windows desktop app for browsing files across multiple cloud storages in one place.

It uses `rclone` under the hood, but the product focus is not on exposing storage internals. Cloud Weave aims to make connected storages feel easier to understand by giving users a single, readable workspace with clear source visibility.

## What Cloud Weave Does

- Connect multiple cloud storages in one desktop app
- Show files from connected storages in a unified library
- Make it easy to browse by `Recent`, `Documents`, `Photos`, `Videos`, `Audio`, and `Other`
- Keep the original storage visible through source badges and metadata
- Reduce the need to think about provider-specific details during everyday browsing

## Current Status

Cloud Weave is an early prototype, but the core desktop flow is already working.

Current capabilities in `v0.2`:

- Tauri + React + TypeScript desktop app foundation
- Connected storage management from the sidebar
- Unified file browsing across connected storages
- Search across file names, paths, storage names, and categories
- Logical views for `Recent`, `Documents`, `Photos`, `Videos`, `Audio`, and `Other`
- OneDrive-specific handling for drive selection and skipping protected or unsupported folders during unified listing

Not implemented yet:

- smart save routing across storages
- duplicate management workflows
- sensitive-file workflows
- full physical folder-tree reconstruction

## Direction

Cloud Weave is designed as a thin desktop UI layer on top of `rclone`.

That means:

- `rclone` handles storage operations and provider integration
- Cloud Weave focuses on unified browsing, visibility, and interaction design
- the product aims to feel approachable to non-technical users

## Roadmap

Near-term direction:

- make unified browsing more reliable and more readable
- improve search and file discovery across connected storages
- refine source visibility and cross-storage trust cues

Longer-term direction:

- smarter file placement guidance
- better workflows for organizing files across clouds
- richer unified views beyond simple file categories

## Development

Typical development commands:

```bash
npm run dev
npm run build
npm run setup:rclone
npm run pr:check
```

- `npm run dev`
  Run the desktop app locally with the Vite frontend and Tauri backend in development mode.
- `npm run build`
  Create a production build when you want to verify the app can be packaged successfully.
- `npm run setup:rclone`
  Download the bundled `rclone` binary for local development on Windows.
- `npm run pr:check`
  Run the standard pre-PR checks: Rust formatting, formatting check, frontend tests, and UI build.

Node.js version:

```bash
24.14.0
```

The project pins this via `.nvmrc`, `.node-version`, and `package.json` `engines`.

For OneDrive troubleshooting and deeper developer debugging, see [docs/onedrive-troubleshooting.md](/mnt/c/Users/taroh/Documents/repositories/tauri/cloud-weave/docs/onedrive-troubleshooting.md).

## License

Cloud Weave bundles `rclone`. See `THIRD_PARTY_NOTICES.md` and `LICENSES/rclone-MIT.txt`.
