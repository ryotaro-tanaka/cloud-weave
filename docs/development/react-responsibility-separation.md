# React Responsibility Separation

This document defines a practical responsibility model for React code in Cloud Weave, so large files can be split by role and avoid God Components.

## Goal

- Keep UI behavior clear and predictable as features grow.
- Separate "what to render" from "how to fetch/update state".
- Make large files split naturally by responsibility.

## Core Principle

For each feature, separate concerns into these layers:

1. **View Components**
  - Pure rendering and local interaction.
  - No direct network / Tauri side effects.
  - Receive data and callbacks via props or context hooks.
2. **Feature Containers**
  - Compose View Components for one screen area (for example: `top`, `side`, `main`, `modals`).
  - Read global state from context.
  - Trigger high-level actions.
3. **State Layer (Context + useReducer)**
  - Own shared state and reducers.
  - Keep transitions explicit with typed actions.
  - Never place large JSX here.
4. **Usecase Layer (async orchestration)**
  - Run side effects (`invoke`, event listeners, polling, timers).
  - Dispatch reducer actions.
  - No styling and minimal rendering logic.

## Stability Policy

This document is a long-lived engineering policy, not a one-time migration note.

- Apply it to all new React features and refactors.
- Prefer incremental alignment (small PRs) over large rewrites.
- If current code cannot follow all rules immediately, document the gap and add a follow-up task.

## Shared vs Local State Rules

### Shared state (Context)

Use context when state is needed by multiple areas, or affects global screen behavior.

Examples:

- current view, search query, sort key
- modal open/close states
- item/remotes/issues/toasts datasets
- transfer/progress maps
- loading/error flags used across sections

### Local state (component only)

Keep state local when it is temporary and scoped to one component instance.

Examples:

- form input text in one modal
- one widget's expanded/collapsed flag
- preview-only transient state (`previewUrl`, `previewError`)

Rule of thumb:

- If closing the component can safely discard the state, keep it local.
- If other parts of the app need it, move it to context.

## Context Boundary Rules (Cloud Weave)

To keep state ownership consistent across future refactors, use these boundaries:

- `**workspaceUI`**
  - Screen-level UI state only: view/sort/search, open/close UI states, modal visibility, row/menu focus.
  - No remote/item transfer payloads except UI selection handles.
- `**workspaceData`**
  - Domain data and user-visible state: remotes, unified items, issues, toasts, loading/error, pending auth session.
  - Owns domain-facing usecases such as issue/toast recording and library/remotes fetch orchestration.
- `**transfers`**
  - High-frequency transfer/open/download/upload progress and queues only.
  - No modal visibility or layout-level UI flags.

If a state candidate matches multiple contexts, place it where its writes happen most often and expose selectors to other layers.

## Naming and Placement Conventions

Use naming to keep responsibilities obvious:

- **Components**
  - `*View` (pure render), `*Panel` (section container), `*Modal` (modal content), `*Shell` (layout frame)
- **Hooks**
  - `use*Flow` for feature flows, `use*Listeners` for subscriptions, `use*Polling` for periodic checks
- **State**
  - Reducer action names follow `domain/verbNoun` (for example: `data/setRemotes`, `ui/setSortMenuOpen`)

Placement rules:

- UI-only hook -> near component (`src/components/`**)
- Domain hook/usecase -> `src/features/`** or `src/state/`**
- Reusable utility -> `src/features/`** (domain) or `src/lib/`** (cross-domain)

## File Ownership Model

Recommended ownership boundaries:

- `src/components/ui/`
  - Reusable primitives (`Button`, modal shell, badges, empty/error/toast blocks)
- `src/components/workspace/`
  - Screen section containers (`top`, `side`, `main`, shell)
- `src/components/library/`
  - Domain-specific list and item rendering
- `src/components/modals/`
  - Modal feature components with local form state where possible
- `src/state/workspaceUI/`
  - UI global state and reducer
- `src/state/workspaceData/`
  - Shared domain data state and reducer
- `src/state/transfers/`
  - High-frequency transfer/open/download state
- `src/features/`**
  - Domain logic, formatting, and non-React helpers

## Anti-Patterns to Avoid

- A single component that:
  - contains large JSX trees
  - owns many unrelated `useEffect`s
  - manages side effects for multiple domains
  - defines utility functions unrelated to rendering
- Contexts containing JSX or presentation logic.
- Components directly calling `invoke` for unrelated domains.
- Global CSS files that own every feature style with no domain mapping.

## Refactoring Checklist (for large files)

When a file grows, split in this order:

1. Extract repeated JSX blocks into components.
2. Move local-only form/input state into that component.
3. Move event listeners/polling/timers into feature hooks.
4. Move shared state transitions into reducer actions.
5. Move utility functions to `features/**` or `lib/**`.
6. Keep the root component as orchestrator/composer only.

## Decision Flow (before adding code)

Use this sequence before introducing new state or files:

1. Is this state needed outside one component instance?
  - No -> keep local.
  - Yes -> continue.
2. Is it layout/UI control or domain data?
  - UI control -> `workspaceUI`.
  - Domain data -> continue.
3. Is it high-frequency transfer progress?
  - Yes -> `transfers`.
  - No -> `workspaceData`.
4. Does this logic call external side effects?
  - Yes -> usecase/hook layer, not view component.

## `App.tsx` Specific Guidance

`App.tsx` should eventually be limited to:

- mounting section containers (`WorkspaceShell`, `StorageSidebar`, `LibraryTopbar`, `LibraryMain`)
- wiring contexts and feature hooks
- delegating modal rendering to a dedicated modal container

`App.tsx` should not permanently contain:

- full auth state machine details
- transfer event merge logic internals
- large modal form implementations
- unrelated utility helpers

## CSS Responsibility Notes

To match React responsibility boundaries:

- Keep style ownership close to component domain.
- Split global CSS by domain (`app-shell`, `workspace-sidebar`, `workspace-topbar`, `library`, `modals`, `feedback/toasts`, `responsive`).
- Preserve existing class names first; move files before renaming selectors.
- Keep design tokens and shared variables in `[src/index.css](src/index.css)`; component/domain CSS should consume tokens rather than redefining color/spacing primitives.

## Review Standard

A refactor is acceptable when:

- behavior is unchanged
- `ui:build` and tests pass
- state boundaries are clearer than before
- at least one concern cluster moved out of the God Component
- new code follows context boundary and naming conventions in this document