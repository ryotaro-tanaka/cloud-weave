import { describe, expect, it } from 'vitest'
import {
  filterItemsByView,
  formatFileSize,
  groupRecentItems,
  searchUnifiedItems,
  type UnifiedItem,
} from './unifiedItems'

const items: UnifiedItem[] = [
  {
    id: '1',
    sourceRemote: 'onedrive-main',
    sourceProvider: 'onedrive',
    sourcePath: 'Docs/Quarterly Plan.pdf',
    name: 'Quarterly Plan.pdf',
    isDir: false,
    size: 1024,
    modTime: '2026-03-20T09:00:00Z',
    mimeType: 'application/pdf',
    extension: '.pdf',
    category: 'documents',
  },
  {
    id: '2',
    sourceRemote: 'photo-backup',
    sourceProvider: 'dropbox',
    sourcePath: 'Photos/Trip/sunrise.jpg',
    name: 'sunrise.jpg',
    isDir: false,
    size: 2048,
    modTime: '2026-03-21T08:00:00Z',
    mimeType: 'image/jpeg',
    extension: '.jpg',
    category: 'photos',
  },
  {
    id: '3',
    sourceRemote: 'audio-archive',
    sourceProvider: 'gdrive',
    sourcePath: 'Music/demo.mp3',
    name: 'demo.mp3',
    isDir: false,
    size: 4096,
    modTime: null,
    mimeType: 'audio/mpeg',
    extension: '.mp3',
    category: 'audio',
  },
]

describe('filterItemsByView', () => {
  it('filters by category view', () => {
    expect(filterItemsByView(items, 'photos').map((item) => item.id)).toEqual(['2'])
  })

  it('sorts recent items with undated files last', () => {
    expect(filterItemsByView(items, 'recent').map((item) => item.id)).toEqual(['2', '1', '3'])
  })
})

describe('searchUnifiedItems', () => {
  it('matches file names, paths, remote names, categories, and provider labels', () => {
    expect(searchUnifiedItems(items, 'quarterly').map((item) => item.id)).toEqual(['1'])
    expect(searchUnifiedItems(items, 'trip').map((item) => item.id)).toEqual(['2'])
    expect(searchUnifiedItems(items, 'audio-archive').map((item) => item.id)).toEqual(['3'])
    expect(searchUnifiedItems(items, 'documents').map((item) => item.id)).toEqual(['1'])
    expect(searchUnifiedItems(items, 'dropbox').map((item) => item.id)).toEqual(['2'])
  })
})

describe('groupRecentItems', () => {
  it('groups items into recent buckets', () => {
    const grouped = groupRecentItems(items, new Date('2026-03-21T12:00:00Z'))

    expect(grouped).toEqual([
      {
        label: 'Today',
        items: [items[1]],
      },
      {
        label: 'This week',
        items: [items[0]],
      },
      {
        label: 'Unknown date',
        items: [items[2]],
      },
    ])
  })
})

describe('formatFileSize', () => {
  it('formats consumer-friendly file sizes', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
  })
})
