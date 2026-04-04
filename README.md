# Cloud Weave

[![CI](https://github.com/ryotaro-tanaka/cloud-weave/actions/workflows/ci.yml/badge.svg)](https://github.com/ryotaro-tanaka/cloud-weave/actions/workflows/ci.yml)

## Overview

Cloud Weave is a Windows desktop app for browsing files across multiple cloud storages in one place.

It uses `rclone` underneath, but the main product value is the UI layer: one readable workspace that lets you find files without constantly thinking about which storage they live in.

## Persona

Cloud Weave is aimed at individual knowledge workers who use multiple cloud storages every day and do not want to think about the save location every time.

Typical users include solo developers, freelancers, one-person businesses, and other PC-heavy workers who upload files, then rely on search, `Recent`, and category views to get them back quickly while still seeing the real storage source.

## Strengths

- Multiple cloud storages in one workspace
- Source-visible browsing that does not hide where a file actually lives
- Faster day-to-day retrieval through `Recent`, search, and logical views like `Documents` and `Photos`
- Natural desktop flows for upload, download, open, and preview

## Setup

Required: Node.js `24.14.x`

```bash
npm install
npm run setup:rclone
npm run dev
```

Useful commands:

- `npm run dev` starts the Tauri app in development mode
- `npm run build` builds the desktop app
- `npm run pr:check` runs the main checks

## Feature Map

- Storage connection management from the sidebar
- Unified library browsing across connected storages
- Search by file name, path, storage, and category
- Category views for `Recent`, `Documents`, `Photos`, `Videos`, `Audio`, and `Other`
- Upload flow for sending files into connected storage
- Provider-specific connection handling where needed, especially for OneDrive

## Tech Stack

- React
- TypeScript
- Vite
- Tauri
- Rust
- `rclone`
