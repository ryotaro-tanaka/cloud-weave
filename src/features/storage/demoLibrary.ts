import type { RemoteSummary } from './pendingState'
import type { UnifiedItem } from './unifiedItems'

export type DemoLibraryState = {
  remotes: RemoteSummary[]
  items: UnifiedItem[]
}

const DEMO_BASE_TIME_ISO = '2026-04-03T12:00:00Z'

export function getDemoLibraryState(now = new Date()): DemoLibraryState {
  const remotes: RemoteSummary[] = [
    {
      name: 'Freelance Ops',
      provider: 'onedrive',
      status: 'connected',
    },
    {
      name: 'Product Lab',
      provider: 'gdrive',
      status: 'connected',
    },
    {
      name: 'Client Delivery',
      provider: 'dropbox',
      status: 'connected',
    },
  ]

  const items: UnifiedItem[] = [
    createDemoItem(now, {
      id: 'demo-client-proposal',
      sourceRemote: 'Freelance Ops',
      sourceProvider: 'onedrive',
      sourcePath: 'Clients/Northwind/Proposal v3.docx',
      name: 'Proposal v3.docx',
      size: 428_032,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: '.docx',
      category: 'documents',
      daysAgo: 0,
      minutesOffset: 18,
    }),
    createDemoItem(now, {
      id: 'demo-design-board',
      sourceRemote: 'Client Delivery',
      sourceProvider: 'dropbox',
      sourcePath: 'Northwind/Assets/Design board.jpg',
      name: 'Design board.jpg',
      size: 3_845_120,
      mimeType: 'image/jpeg',
      extension: '.jpg',
      category: 'photos',
      daysAgo: 0,
      minutesOffset: 64,
    }),
    createDemoItem(now, {
      id: 'demo-roadmap-recap',
      sourceRemote: 'Product Lab',
      sourceProvider: 'gdrive',
      sourcePath: 'Notes/Roadmap recap.md',
      name: 'Roadmap recap.md',
      size: 26_624,
      mimeType: 'text/markdown',
      extension: '.md',
      category: 'documents',
      daysAgo: 1,
      minutesOffset: 14,
    }),
    createDemoItem(now, {
      id: 'demo-moodboard',
      sourceRemote: 'Client Delivery',
      sourceProvider: 'dropbox',
      sourcePath: 'Northwind/Photos/Moodboard frame.png',
      name: 'Moodboard frame.png',
      size: 2_684_928,
      mimeType: 'image/png',
      extension: '.png',
      category: 'photos',
      daysAgo: 2,
      minutesOffset: 41,
    }),
    createDemoItem(now, {
      id: 'demo-quarterly-invoices',
      sourceRemote: 'Freelance Ops',
      sourceProvider: 'onedrive',
      sourcePath: 'Finance/Quarterly invoices.xlsx',
      name: 'Quarterly invoices.xlsx',
      size: 182_272,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: '.xlsx',
      category: 'documents',
      daysAgo: 4,
      minutesOffset: 0,
    }),
    createDemoItem(now, {
      id: 'demo-podcast-cut',
      sourceRemote: 'Product Lab',
      sourceProvider: 'gdrive',
      sourcePath: 'Audio/Podcast rough cut.mp3',
      name: 'Podcast rough cut.mp3',
      size: 9_214_000,
      mimeType: 'audio/mpeg',
      extension: '.mp3',
      category: 'audio',
      daysAgo: 6,
      minutesOffset: 0,
    }),
    createDemoItem(now, {
      id: 'demo-client-assets',
      sourceRemote: 'Client Delivery',
      sourceProvider: 'dropbox',
      sourcePath: 'Northwind/Deliverables/Client assets.zip',
      name: 'Client assets.zip',
      size: 56_184_832,
      mimeType: 'application/zip',
      extension: '.zip',
      category: 'other',
      daysAgo: 9,
      minutesOffset: 0,
    }),
    createDemoItem(now, {
      id: 'demo-user-flow',
      sourceRemote: 'Product Lab',
      sourceProvider: 'gdrive',
      sourcePath: 'Research/Screens/User flow whiteboard.jpg',
      name: 'User flow whiteboard.jpg',
      size: 4_214_784,
      mimeType: 'image/jpeg',
      extension: '.jpg',
      category: 'photos',
      daysAgo: 12,
      minutesOffset: 30,
    }),
    createDemoItem(now, {
      id: 'demo-api-brief',
      sourceRemote: 'Product Lab',
      sourceProvider: 'gdrive',
      sourcePath: 'Docs/API integration brief.pdf',
      name: 'API integration brief.pdf',
      size: 1_184_512,
      mimeType: 'application/pdf',
      extension: '.pdf',
      category: 'documents',
      daysAgo: 18,
      minutesOffset: 0,
    }),
    createDemoItem(now, {
      id: 'demo-workshop-shot',
      sourceRemote: 'Freelance Ops',
      sourceProvider: 'onedrive',
      sourcePath: 'Photos/Workshop/Workshop desk shot.jpg',
      name: 'Workshop desk shot.jpg',
      size: 5_126_144,
      mimeType: 'image/jpeg',
      extension: '.jpg',
      category: 'photos',
      daysAgo: 24,
      minutesOffset: 0,
    }),
    createDemoItem(now, {
      id: 'demo-feature-walkthrough',
      sourceRemote: 'Product Lab',
      sourceProvider: 'gdrive',
      sourcePath: 'Video/Feature walkthrough cut.mp4',
      name: 'Feature walkthrough cut.mp4',
      size: 132_450_560,
      mimeType: 'video/mp4',
      extension: '.mp4',
      category: 'videos',
      daysAgo: 37,
      minutesOffset: 0,
    }),
    createDemoItem(now, {
      id: 'demo-client-hand-off',
      sourceRemote: 'Client Delivery',
      sourceProvider: 'dropbox',
      sourcePath: 'Northwind/Handoff/Client handoff notes.txt',
      name: 'Client handoff notes.txt',
      size: 14_336,
      mimeType: 'text/plain',
      extension: '.txt',
      category: 'documents',
      daysAgo: 52,
      minutesOffset: 0,
    }),
  ]

  return { remotes, items }
}

export const DEMO_LIBRARY_STATE = getDemoLibraryState(new Date(DEMO_BASE_TIME_ISO))
export const DEMO_REMOTES = DEMO_LIBRARY_STATE.remotes
export const DEMO_UNIFIED_ITEMS = DEMO_LIBRARY_STATE.items

function createDemoItem(
  now: Date,
  input: {
    id: string
    sourceRemote: string
    sourceProvider: string
    sourcePath: string
    name: string
    size: number
    mimeType: string
    extension: string
    category: UnifiedItem['category']
    daysAgo: number
    minutesOffset: number
  },
): UnifiedItem {
  return {
    id: input.id,
    sourceRemote: input.sourceRemote,
    sourceProvider: input.sourceProvider,
    sourcePath: input.sourcePath,
    name: input.name,
    isDir: false,
    size: input.size,
    modTime: toRelativeIso(now, input.daysAgo, input.minutesOffset),
    mimeType: input.mimeType,
    extension: input.extension,
    category: input.category,
  }
}

function toRelativeIso(now: Date, daysAgo: number, minutesOffset: number): string {
  const timestamp = new Date(now)
  timestamp.setUTCDate(timestamp.getUTCDate() - daysAgo)
  timestamp.setUTCMinutes(timestamp.getUTCMinutes() - minutesOffset)
  return timestamp.toISOString()
}
