import type { UnifiedItemSortKey } from './unifiedItems'
import { SORT_OPTIONS } from './workspaceAppConstants'

export function getSortLabel(sortKey: UnifiedItemSortKey): string {
  return SORT_OPTIONS.find((option) => option.value === sortKey)?.label ?? 'Newest'
}
