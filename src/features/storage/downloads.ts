export type DownloadStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type DownloadRequest = {
  downloadId: string
  sourceRemote: string
  sourcePath: string
  displayName: string
  size?: number
}

export type DownloadAcceptedResult = {
  downloadId: string
  status: 'accepted'
  targetPath: string
}

export type DownloadProgressEvent = {
  downloadId: string
  status: DownloadStatus
  progressPercent?: number | null
  bytesTransferred?: number | null
  totalBytes?: number | null
  targetPath?: string | null
  errorMessage?: string | null
}

export type DownloadState = {
  status: 'idle' | DownloadStatus
  progressPercent: number | null
  bytesTransferred: number | null
  totalBytes: number | null
  targetPath: string | null
  errorMessage: string | null
}

export const IDLE_DOWNLOAD_STATE: DownloadState = {
  status: 'idle',
  progressPercent: null,
  bytesTransferred: null,
  totalBytes: null,
  targetPath: null,
  errorMessage: null,
}

export function applyDownloadProgressEvent(
  states: Record<string, DownloadState>,
  event: DownloadProgressEvent,
): Record<string, DownloadState> {
  const current = states[event.downloadId] ?? IDLE_DOWNLOAD_STATE

  return {
    ...states,
    [event.downloadId]: {
      status: event.status,
      progressPercent: event.progressPercent ?? current.progressPercent,
      bytesTransferred: event.bytesTransferred ?? current.bytesTransferred,
      totalBytes: event.totalBytes ?? current.totalBytes,
      targetPath: event.targetPath ?? current.targetPath,
      errorMessage: event.errorMessage ?? (event.status === 'failed' ? 'Download failed.' : null),
    },
  }
}

export function getDownloadStateSummary(state: DownloadState): string {
  switch (state.status) {
    case 'idle':
      return 'Ready to download'
    case 'queued':
      return 'Preparing download...'
    case 'running':
      return state.progressPercent !== null
        ? `Downloading ${Math.round(state.progressPercent)}%`
        : 'Downloading...'
    case 'succeeded':
      return state.targetPath || 'Saved to Downloads'
    case 'failed':
      return state.errorMessage || 'Download failed.'
  }
}
