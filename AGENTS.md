# AGENTS.md

## Repository expectations

### Responsibility boundaries
- Keep shared multi-provider logic and provider-specific logic clearly separated.
- Do not mix OneDrive-specific behavior into common library, domain, or UI logic unless it is explicitly abstracted behind a shared interface.
- When implementing or changing behavior, make the boundary clear:
  - **Common**: logic that should work the same for all providers
  - **Provider-specific**: logic that exists only because of OneDrive API, auth, path, metadata, or capability differences
- If a change is OneDrive-specific, keep the code, naming, and comments OneDrive-specific.
- If a change is shared, avoid naming or shaping it around OneDrive assumptions.

### Theme and colors
- Use existing defined color tokens and theme variables.
- Shared theme color tokens are defined in `src/index.css`.
- Do not introduce ad-hoc colors in components unless there is an explicit design decision to add or revise a theme token first.
- Prefer updating shared theme tokens over hardcoding one-off visual values.
- Keep visual changes consistent with the current Cloud Weave UI direction: quiet, clear, and utility-first.

### UI role boundaries
- **side**: navigation for logical views and app sections. Keep storages secondary; side is not a storage management showcase.
- **top**: workspace action bar for search, upload, sort, filter, and view controls. Top is not a hero section or storage status dashboard.
- **main**: primary content area for files, photos, search results, and transfers. Prioritize usability and density; use list/table by default and photo grid only where it clearly fits.

## Working style
- Keep instructions small and practical.
- Prefer minimal, targeted changes over wide visual or architectural drift.
