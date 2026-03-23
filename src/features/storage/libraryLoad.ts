import { sortUnifiedItems, type UnifiedItem } from './unifiedItems'

export type StartUnifiedLibraryLoadResult = {
  status: 'accepted'
  requestId: string
  totalRemotes: number
}

export type UnifiedLibraryLoadEvent = {
  requestId: string
  status: 'started' | 'remote_loaded' | 'remote_failed' | 'completed'
  remoteName?: string | null
  provider?: string | null
  items?: UnifiedItem[] | null
  notices?: string[] | null
  message?: string | null
  loadedRemoteCount: number
  totalRemoteCount: number
}

export function mergeUnifiedItems(current: UnifiedItem[], incoming: UnifiedItem[]): UnifiedItem[] {
  const byId = new Map(current.map((item) => [item.id, item]))

  for (const item of incoming) {
    byId.set(item.id, item)
  }

  return sortUnifiedItems(Array.from(byId.values()))
}

export function mergeNotices(current: string[], incoming: string[]): string[] {
  return Array.from(new Set([...current, ...incoming])).sort()
}
