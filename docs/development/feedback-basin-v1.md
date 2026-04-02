# Basin Hosted Form Contract for V1

## Summary

This document defines the Basin hosted form contract for the first Cloud Weave feedback flow.

V1 uses a Basin hosted form and a manually attached `diagnostics.zip`.
Cloud Weave will later open the hosted form URL, but it does not render or submit the form itself in this phase.

## Form Identity

- Form title: `Cloud Weave Feedback`
- Form mode: `Hosted form`
- Purpose: one intake for bug reports, UX issues, ideas, and other feedback

## Fields

### 1. `feedback_type`

- Required: yes
- Type: select
- Label: `Feedback type`
- Options:
  - `Bug`
  - `UX issue`
  - `Idea`
  - `Other`

### 2. `message`

- Required: yes
- Type: textarea
- Label: `What happened?`

### 3. `reproduction_steps`

- Required: no
- Type: textarea
- Label: `How can we reproduce it?`

### 4. `app_version`

- Required: no
- Type: short text
- Label: `Cloud Weave version`
- Visibility: visible field

### 5. `diagnostics_attached`

- Required: yes
- Type: select or radio
- Label: `Did you attach diagnostics.zip?`
- Options:
  - `Yes`
  - `No`

### 6. `attachment`

- Required: no
- Type: file upload
- Label: `Attach diagnostics.zip`
- Expected file: `diagnostics.zip`
- File count: single file

## Explicit Non-Goals for V1

- No `email` field
- No hidden fields
- No prefilled fields
- No automatic diagnostics attachment
- No in-app embedded Basin form
- No app-controlled success page flow

## User-Facing Guidance

Show this guidance in the hosted form:

- `Describe the issue briefly.`
- `Attach diagnostics.zip if you want help debugging.`
- `Do not include personal or sensitive information.`

## Cloud Weave Integration Assumptions

Future Cloud Weave implementation should assume:

- there is exactly one hosted form URL for V1
- users may submit without an attachment
- users may attach one `diagnostics.zip`
- `app_version` is a normal visible field, not a hidden system field

## Manual Setup Checklist

1. Create a new Basin hosted form.
2. Set the title to `Cloud Weave Feedback`.
3. Add the six fields in this document using the same field names.
4. Enable file upload for the `attachment` field.
5. Keep the default Basin success page.
6. Copy and save the hosted form URL for later Cloud Weave integration.

## Manual Verification Checklist

1. Open the hosted form URL in a browser.
2. Confirm required fields behave correctly.
3. Confirm the file upload field accepts a single file.
4. Submit a test entry without an attachment.
5. Submit a test entry with `diagnostics.zip`.
6. Confirm both submissions appear in Basin.
7. Confirm the attachment appears on the submission with the uploaded ZIP.

## Notes

- Basin file uploads support up to 100 MB per submission in the official documentation at the time this contract was defined.
- If Cloud Weave later prefills fields or passes context, that should be treated as a separate follow-up change, not part of this V1 contract.
