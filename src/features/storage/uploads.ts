import { formatFileSize, type UnifiedCategory } from './unifiedItems'

export type UploadSelection = {
  path: string
  kind: 'file' | 'directory'
}

export type PreparedUploadCandidate = {
  provider: string
  remoteName: string
  basePath: string
}

export type PreparedUploadItem = {
  itemId: string
  originalLocalPath: string
  relativePath: string
  displayName: string
  size: number
  extension?: string | null
  category: UnifiedCategory
  candidates: PreparedUploadCandidate[]
}

export type PreparedUploadBatch = {
  uploadId: string
  items: PreparedUploadItem[]
  notices: string[]
}

export type UploadResultItem = {
  itemId: string
  provider: string
  remoteName: string
  remotePath: string
  category: UnifiedCategory
  originalLocalPath: string
  relativePath: string
  size: number
}

export type UploadAcceptedResult = {
  uploadId: string
  status: 'accepted'
  totalItems: number
}

export type UploadStatus = 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed'

export type UploadProgressEvent = {
  uploadId: string
  itemId: string
  status: UploadStatus
  provider?: string | null
  remoteName?: string | null
  remotePath?: string | null
  completedCount?: number | null
  totalCount?: number | null
  errorMessage?: string | null
}

export type UploadState = {
  status: 'idle' | UploadStatus
  provider: string | null
  remoteName: string | null
  remotePath: string | null
  completedCount: number | null
  totalCount: number | null
  errorMessage: string | null
}

export const IDLE_UPLOAD_STATE: UploadState = {
  status: 'idle',
  provider: null,
  remoteName: null,
  remotePath: null,
  completedCount: null,
  totalCount: null,
  errorMessage: null,
}

export function applyUploadProgressEvent(
  states: Record<string, UploadState>,
  event: UploadProgressEvent,
): Record<string, UploadState> {
  const current = states[event.itemId] ?? IDLE_UPLOAD_STATE

  return {
    ...states,
    [event.itemId]: {
      status: event.status,
      provider: event.provider ?? current.provider,
      remoteName: event.remoteName ?? current.remoteName,
      remotePath: event.remotePath ?? current.remotePath,
      completedCount: event.completedCount ?? current.completedCount,
      totalCount: event.totalCount ?? current.totalCount,
      errorMessage: event.errorMessage ?? (event.status === 'failed' ? 'Upload failed.' : null),
    },
  }
}

export function getUploadStateSummary(state: UploadState): string {
  switch (state.status) {
    case 'idle':
      return 'Ready to upload'
    case 'queued':
      return 'Queued for upload'
    case 'running':
      return 'Uploading...'
    case 'retrying':
      return 'Trying the next destination...'
    case 'succeeded':
      return state.remotePath ?? 'Uploaded'
    case 'failed':
      return state.errorMessage ?? 'Upload failed.'
  }
}

export function getUploadBatchSummary(
  items: PreparedUploadItem[],
  states: Record<string, UploadState>,
): { completed: number; failed: number; active: number; total: number; label: string } {
  const total = items.length
  let completed = 0
  let failed = 0
  let active = 0

  for (const item of items) {
    const state = states[item.itemId] ?? IDLE_UPLOAD_STATE

    if (state.status === 'succeeded') {
      completed += 1
    } else if (state.status === 'failed') {
      failed += 1
    } else if (state.status === 'queued' || state.status === 'running' || state.status === 'retrying') {
      active += 1
    }
  }

  let label = 'Ready to upload'

  if (total === 0) {
    label = 'Add files or folders to begin.'
  } else if (active > 0) {
    label = `${completed} of ${total} uploaded`
  } else if (completed === total) {
    label = `${total} file${total === 1 ? '' : 's'} uploaded`
  } else if (failed > 0 && completed > 0) {
    label = `${completed} uploaded, ${failed} failed`
  } else if (failed > 0) {
    label = `${failed} failed`
  } else {
    label = `${total} file${total === 1 ? '' : 's'} queued`
  }

  return { completed, failed, active, total, label }
}

export function describeUploadTarget(item: PreparedUploadItem): string {
  if (item.candidates.length === 0) {
    return 'No eligible destination'
  }

  const [first, ...rest] = item.candidates
  const primary = `${getProviderLabel(first.provider)} (${first.remoteName})`

  return rest.length > 0 ? `${primary} +${rest.length} fallback` : primary
}

export function formatUploadItemMeta(item: PreparedUploadItem): string {
  return `${item.category} • ${formatFileSize(item.size)}`
}

function getProviderLabel(provider: string): string {
  switch (provider) {
    case 'onedrive':
      return 'OneDrive'
    case 'gdrive':
      return 'Google Drive'
    case 'dropbox':
      return 'Dropbox'
    case 'icloud':
      return 'iCloud Drive'
    default:
      return provider
  }
}
