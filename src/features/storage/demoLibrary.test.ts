import { describe, expect, it } from 'vitest'
import { DEMO_REMOTES, DEMO_UNIFIED_ITEMS, getDemoLibraryState } from './demoLibrary'
import { filterItemsByView, groupRecentItems, searchUnifiedItems } from './unifiedItems'

describe('demoLibrary', () => {
  it('provides connected remotes and valid item shapes', () => {
    expect(DEMO_REMOTES.length).toBeGreaterThanOrEqual(2)
    expect(DEMO_REMOTES.every((remote) => remote.status === 'connected')).toBe(true)
    expect(DEMO_UNIFIED_ITEMS.every((item) => item.id && item.name && item.sourceRemote && item.sourcePath)).toBe(true)
    expect(new Set(DEMO_UNIFIED_ITEMS.map((item) => item.sourceProvider))).toEqual(new Set(['onedrive', 'gdrive', 'dropbox']))
  })

  it('keeps recent groups useful for screenshots', () => {
    const now = new Date('2026-04-03T12:00:00Z')
    const grouped = groupRecentItems(getDemoLibraryState(now).items, now)

    expect(grouped.map((group) => group.label)).toEqual(['Today', 'Last 7 days', 'Last 30 days', 'Older than 30 days'])
    expect(grouped[0]?.items.length).toBeGreaterThanOrEqual(2)
  })

  it('includes populated documents and photos views', () => {
    expect(filterItemsByView(DEMO_UNIFIED_ITEMS, 'documents').length).toBeGreaterThanOrEqual(4)
    expect(filterItemsByView(DEMO_UNIFIED_ITEMS, 'photos').length).toBeGreaterThanOrEqual(4)
  })

  it('supports screenshot search queries with persona-aligned shared terms', () => {
    expect(searchUnifiedItems(DEMO_UNIFIED_ITEMS, 'client').length).toBeGreaterThanOrEqual(3)
    expect(searchUnifiedItems(DEMO_UNIFIED_ITEMS, 'product').length).toBeGreaterThanOrEqual(1)
  })
})
