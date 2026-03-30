export type UnifiedCategory = 'documents' | 'photos' | 'videos' | 'audio' | 'other'

export type LogicalView = 'all-files' | 'recent' | UnifiedCategory | 'transfers'

export type UnifiedItem = {
  id: string
  sourceRemote: string
  sourceProvider: string
  sourcePath: string
  name: string
  isDir: boolean
  size: number
  modTime: string | null
  mimeType: string | null
  extension: string | null
  category: UnifiedCategory
}

export type RecentGroup = {
  label: 'Today' | 'This week' | 'This month' | 'Older' | 'Unknown date'
  items: UnifiedItem[]
}

export function filterItemsByView(items: UnifiedItem[], view: LogicalView): UnifiedItem[] {
  if (view === 'all-files') {
    return items
  }

  if (view === 'recent') {
    return sortItemsByRecent(items)
  }

  if (view === 'transfers') {
    return []
  }

  return items.filter((item) => item.category === view)
}

export function searchUnifiedItems(items: UnifiedItem[], query: string): UnifiedItem[] {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return items
  }

  return items.filter((item) =>
    [item.name, item.sourcePath, item.sourceRemote, item.category, item.sourceProvider]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedQuery)),
  )
}

export function sortUnifiedItems(items: UnifiedItem[]): UnifiedItem[] {
  return [...items].sort((left, right) =>
    left.sourceRemote.localeCompare(right.sourceRemote) || left.sourcePath.localeCompare(right.sourcePath),
  )
}

export function sortItemsByRecent(items: UnifiedItem[]): UnifiedItem[] {
  return [...items].sort(compareItemsByRecent)
}

export function groupRecentItems(items: UnifiedItem[], now = new Date()): RecentGroup[] {
  const grouped = new Map<RecentGroup['label'], UnifiedItem[]>([
    ['Today', []],
    ['This week', []],
    ['This month', []],
    ['Older', []],
    ['Unknown date', []],
  ])

  for (const item of sortItemsByRecent(items)) {
    grouped.get(resolveRecentGroup(item.modTime, now))?.push(item)
  }

  return Array.from(grouped.entries())
    .filter(([, groupItems]) => groupItems.length > 0)
    .map(([label, groupItems]) => ({
      label,
      items: groupItems,
    }))
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return 'Unknown size'
  }

  if (size < 1024) {
    return `${size} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

export function formatModifiedTime(modTime: string | null): string {
  if (!modTime) {
    return 'Unknown date'
  }

  const parsed = new Date(modTime)
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown date'
  }

  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function getCategoryLabel(view: LogicalView): string {
  switch (view) {
    case 'all-files':
      return 'All Files'
    case 'recent':
      return 'Recent'
    case 'documents':
      return 'Documents'
    case 'photos':
      return 'Photos'
    case 'videos':
      return 'Videos'
    case 'audio':
      return 'Audio'
    case 'other':
      return 'Other'
    case 'transfers':
      return 'Transfers'
  }
}

export function getCategoryMonogram(category: UnifiedCategory): string {
  switch (category) {
    case 'documents':
      return 'D'
    case 'photos':
      return 'P'
    case 'videos':
      return 'V'
    case 'audio':
      return 'A'
    case 'other':
      return 'O'
  }
}

function compareItemsByRecent(left: UnifiedItem, right: UnifiedItem): number {
  const leftTimestamp = toTimestamp(left.modTime)
  const rightTimestamp = toTimestamp(right.modTime)

  if (leftTimestamp === null && rightTimestamp === null) {
    return left.name.localeCompare(right.name)
  }

  if (leftTimestamp === null) {
    return 1
  }

  if (rightTimestamp === null) {
    return -1
  }

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp
  }

  return left.name.localeCompare(right.name)
}

function resolveRecentGroup(modTime: string | null, now: Date): RecentGroup['label'] {
  const timestamp = toTimestamp(modTime)
  if (timestamp === null) {
    return 'Unknown date'
  }

  const current = new Date(now)
  const itemDate = new Date(timestamp)

  const startOfToday = new Date(current.getFullYear(), current.getMonth(), current.getDate())
  const startOfWeek = new Date(startOfToday)
  const dayOfWeek = startOfWeek.getDay()
  const normalizedDayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  startOfWeek.setDate(startOfWeek.getDate() - normalizedDayOffset)

  const startOfMonth = new Date(current.getFullYear(), current.getMonth(), 1)

  if (itemDate >= startOfToday) {
    return 'Today'
  }

  if (itemDate >= startOfWeek) {
    return 'This week'
  }

  if (itemDate >= startOfMonth) {
    return 'This month'
  }

  return 'Older'
}

function toTimestamp(modTime: string | null): number | null {
  if (!modTime) {
    return null
  }

  const parsed = Date.parse(modTime)
  return Number.isNaN(parsed) ? null : parsed
}
