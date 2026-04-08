import type { LogicalView, UnifiedItemSortKey } from './unifiedItems'

export function isScreenshotDemoEnabled(): boolean {
  return import.meta.env.VITE_SCREENSHOT_DEMO === '1'
}

export function getDefaultSortKey(view: LogicalView): UnifiedItemSortKey {
  return view === 'recent' ? 'updated-desc' : 'name-asc'
}
