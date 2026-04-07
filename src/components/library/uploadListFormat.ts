import type { PreparedUploadItem, UploadState } from '../../features/storage/uploads'

export function getUploadListStatusLabel(state: UploadState): string {
  switch (state.status) {
    case 'queued':
    case 'running':
    case 'retrying':
      return 'Uploading'
    case 'succeeded':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'idle':
      return 'Ready'
  }
}

export function getUploadListPath(item: PreparedUploadItem, state: UploadState): string {
  if (state.remotePath) {
    return `/${state.remotePath.replace(/^\/+/, '')}`
  }

  const primaryCandidate = item.candidates[0]
  const normalizedRelativePath = item.relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const basePath = primaryCandidate?.basePath?.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') ?? ''

  if (!basePath) {
    return normalizedRelativePath ? `/${normalizedRelativePath}` : '/'
  }

  return normalizedRelativePath ? `/${basePath}/${normalizedRelativePath}` : `/${basePath}`
}

export function getUploadListStorage(item: PreparedUploadItem, state: UploadState): string {
  return state.remoteName ?? item.candidates[0]?.remoteName ?? 'Pending'
}
