# Feedback V1 Implementation Note

## Summary

This note records the current Cloud Weave feedback implementation for V1.

It exists to preserve the effective Step 0 contract: how feedback works today, what the diagnostics payload contains, and how Basin is used.

For the Basin form field contract, see [feedback-basin-v1.md](./feedback-basin-v1.md).

## Current User Flow

1. Open the Issues modal.
2. Press `Report issue`.
3. Cloud Weave opens a short in-app prompt explaining what happens next.
4. When the user continues, Cloud Weave exports `diagnostics.zip` to `Downloads`.
5. Cloud Weave opens the Basin hosted form in an external browser and tells the user which ZIP filename to attach from `Downloads`.
6. In V1, `diagnostics.zip` is attached manually by the user.

## Diagnostics Payload Contract

### `summary.json`

Cloud Weave writes a `summary.json` file with these fields:

- `appVersion` (the Cloud Weave version)
- `platform`
- `currentLogicalView`
- `connectedStorageCount`
- `connectedStorageNames`
- `storageStateSummary`
- `recentIssuesSummary`
- `exportedAt`

### `diagnostics.zip`

Cloud Weave creates the user-facing diagnostics ZIP in `Downloads`.

The ZIP currently contains:

- `summary.json`
- `logs/cloud-weave.log` if the log file exists

## Storage Policy

### Local app data

Used for local-only and machine-local data:

- `logs/cloud-weave.log`
- `diagnostics/export-.../summary.json`
- `open-cache/...`

### Downloads

Used for user-facing exported files:

- `cloud-weave-diagnostics-export-....zip`

### Roaming app data

Used for user configuration and durable app data:

- `rclone.conf`
- `upload-routing.json`

## Basin Integration in V1

- Cloud Weave uses a Basin hosted form opened in an external browser.
- V1 does not render or submit the form directly in the app.
- V1 assumes manual attachment of `diagnostics.zip`.
- Cloud Weave currently prefills only:
  - `app_version`
  - `feedback_type`

## Explicit Non-Goals for V1

- No automatic ZIP attachment
- No `notices.json` or issue snapshot in diagnostics export
- No email collection
- No embedded Basin form
- No app-controlled submission flow

## Notes

- This document describes the current implementation, not a future ideal design.
- If the diagnostics payload or Basin integration changes, update this file together with the implementation.
