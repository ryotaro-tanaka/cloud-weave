import type { DownloadState } from '../../features/storage/downloads'
import { canOpenInDefaultApp, canPreviewItem, type OpenState } from '../../features/storage/openFiles'
import type { UnifiedItem } from '../../features/storage/unifiedItems'

export function getListItemStatusLabel(item: UnifiedItem, downloadState: DownloadState, openState: OpenState): string {
  if (downloadState.status === 'failed') {
    return 'Download failed'
  }

  if (openState.status === 'failed') {
    return 'Open failed'
  }

  if (downloadState.status === 'queued' || downloadState.status === 'running') {
    return 'Downloading'
  }

  if (downloadState.status === 'succeeded') {
    return 'Downloaded'
  }

  if (openState.status === 'preparing') {
    return canPreviewItem(item) ? 'Preparing preview' : 'Opening'
  }

  if (openState.status === 'ready') {
    return openState.openMode === 'system-default' ? 'Opened' : 'Ready to preview'
  }

  if (item.isDir) {
    return 'Folder'
  }

  if (canPreviewItem(item)) {
    return 'Preview'
  }

  if (canOpenInDefaultApp(item)) {
    return 'Ready'
  }

  return 'Ready'
}

export function formatListPath(item: UnifiedItem): string {
  const normalizedPath = item.sourcePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

  if (!normalizedPath) {
    return '/'
  }

  if (item.isDir) {
    return `/${normalizedPath}`
  }

  const lastSeparatorIndex = normalizedPath.lastIndexOf('/')

  if (lastSeparatorIndex < 0) {
    return '/'
  }

  const parentPath = normalizedPath.slice(0, lastSeparatorIndex)

  return parentPath ? `/${parentPath}` : '/'
}
