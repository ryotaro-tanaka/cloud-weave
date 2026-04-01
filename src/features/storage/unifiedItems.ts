export type UnifiedCategory = 'documents' | 'photos' | 'videos' | 'audio' | 'other'

export type LogicalView = 'recent' | UnifiedCategory
export type UnifiedItemSortKey = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc'

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
  label: 'Today' | 'Last 7 days' | 'Last 30 days' | 'Older than 30 days' | 'Unknown date'
  items: UnifiedItem[]
}

export function filterItemsByView(items: UnifiedItem[], view: LogicalView): UnifiedItem[] {
  if (view === 'recent') {
    return sortItemsByRecent(items)
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

export function sortUnifiedItems(items: UnifiedItem[], sortKey: UnifiedItemSortKey = 'name-asc'): UnifiedItem[] {
  return [...items].sort((left, right) => compareItems(left, right, sortKey))
}

export function sortItemsByRecent(items: UnifiedItem[]): UnifiedItem[] {
  return [...items].sort(compareItemsByRecent)
}

export function groupRecentItems(items: UnifiedItem[], now = new Date()): RecentGroup[] {
  const grouped = new Map<RecentGroup['label'], UnifiedItem[]>([
    ['Today', []],
    ['Last 7 days', []],
    ['Last 30 days', []],
    ['Older than 30 days', []],
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

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  const hour = String(parsed.getHours()).padStart(2, '0')
  const minute = String(parsed.getMinutes()).padStart(2, '0')

  return `${year}/${month}/${day} ${hour}:${minute}`
}

export function getCategoryLabel(view: LogicalView): string {
  switch (view) {
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

function compareItems(left: UnifiedItem, right: UnifiedItem, sortKey: UnifiedItemSortKey): number {
  switch (sortKey) {
    case 'updated-desc':
      return compareItemsByRecent(left, right)
    case 'updated-asc':
      return compareItemsByOldest(left, right)
    case 'name-asc':
      return compareItemsByName(left, right)
    case 'name-desc':
      return compareItemsByName(right, left)
    case 'size-desc':
      return compareItemsBySize(left, right, 'desc')
    case 'size-asc':
      return compareItemsBySize(left, right, 'asc')
  }
}

function compareItemsByOldest(left: UnifiedItem, right: UnifiedItem): number {
  const leftTimestamp = toTimestamp(left.modTime)
  const rightTimestamp = toTimestamp(right.modTime)

  if (leftTimestamp === null && rightTimestamp === null) {
    return compareItemsByName(left, right)
  }

  if (leftTimestamp === null) {
    return 1
  }

  if (rightTimestamp === null) {
    return -1
  }

  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp
  }

  return compareItemsByName(left, right)
}

function compareItemsByName(left: UnifiedItem, right: UnifiedItem): number {
  return (
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) ||
    left.sourceRemote.localeCompare(right.sourceRemote, undefined, { sensitivity: 'base' }) ||
    left.sourcePath.localeCompare(right.sourcePath, undefined, { sensitivity: 'base' })
  )
}

function compareItemsBySize(left: UnifiedItem, right: UnifiedItem, direction: 'asc' | 'desc'): number {
  const leftSize = left.isDir ? null : left.size
  const rightSize = right.isDir ? null : right.size

  if (leftSize === null && rightSize === null) {
    return compareItemsByName(left, right)
  }

  if (leftSize === null) {
    return 1
  }

  if (rightSize === null) {
    return -1
  }

  if (leftSize !== rightSize) {
    return direction === 'desc' ? rightSize - leftSize : leftSize - rightSize
  }

  return compareItemsByName(left, right)
}

function resolveRecentGroup(modTime: string | null, now: Date): RecentGroup['label'] {
  const timestamp = toTimestamp(modTime)
  if (timestamp === null) {
    return 'Unknown date'
  }

  const current = new Date(now)
  const itemDate = new Date(timestamp)

  const startOfToday = new Date(current.getFullYear(), current.getMonth(), current.getDate())
  const startOfLast7Days = new Date(startOfToday)
  startOfLast7Days.setDate(startOfLast7Days.getDate() - 6)
  const startOfLast30Days = new Date(startOfToday)
  startOfLast30Days.setDate(startOfLast30Days.getDate() - 29)

  if (itemDate >= startOfToday) {
    return 'Today'
  }

  if (itemDate >= startOfLast7Days) {
    return 'Last 7 days'
  }

  if (itemDate >= startOfLast30Days) {
    return 'Last 30 days'
  }

  return 'Older than 30 days'
}

function toTimestamp(modTime: string | null): number | null {
  if (!modTime) {
    return null
  }

  const parsed = Date.parse(modTime)
  return Number.isNaN(parsed) ? null : parsed
}
