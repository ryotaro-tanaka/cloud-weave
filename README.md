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
- `npm run demo`
  Launch the Tauri desktop app in screenshot demo mode with anonymized sample data.
- `npm run setup:rclone`
  Download the bundled `rclone` binary for local development on Windows.
- `npm run pr:check`
  Run the standard pre-PR checks: Rust formatting, formatting check, frontend tests, and UI build.

### Screenshot Demo Mode

For download-page screenshots, the frontend supports a demo-only library state that avoids showing personal file names.

- Start the desktop app with `npm run demo` when you want the real app chrome and title bar
- Or start normally with `npm run dev` and open the frontend with `?demo=1` appended to the URL, for example `http://localhost:1420/?demo=1`
- The demo view loads anonymized sample storages and files instead of your real library
- Recommended screenshots: `Recent`, `Documents`, and `Photos`

## GitHub Automation

Merged pull requests into `main` can auto-post a short bilingual update to Threads.

- Add the following section to the PR body when you want a post after merge:

```md
## Threads
Cloud Weave now supports file preview for downloads.

Cloud Weave でダウンロードしたファイルのプレビューに対応しました。
```

- Repository secret required: `THREADS_LONG_LIVED_TOKEN`
- Add the label `skip-threads` or `no-threads` to opt out even when the `## Threads` section exists
- If the `## Threads` section is missing, or either the English or Japanese paragraph is empty, the workflow skips posting
- For quick testing without a PR merge, run the `Threads Post Manual` workflow from the Actions tab and enter the English paragraph first and the Japanese paragraph second
- Threads token setup and manual `curl` verification: [docs/development/threads.md](docs/development/threads.md)

Node.js version:

```bash
24.14.0
```

The project pins this via `.nvmrc`, `.node-version`, and `package.json` `engines`.

For OneDrive troubleshooting and deeper developer debugging, see [docs/troubleshooting/onedrive.md](docs/troubleshooting/onedrive.md).

## License

Cloud Weave bundles `rclone`. See `docs/legal/THIRD_PARTY_NOTICES.md` and `LICENSES/rclone-MIT.txt`.
