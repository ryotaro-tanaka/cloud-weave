import type { UnifiedItem } from './unifiedItems'

export type OpenMode = 'preview-image' | 'preview-pdf'

export type OpenRequest = {
  requestId: string
  sourceRemote: string
  sourcePath: string
  displayName: string
  mimeType?: string | null
  extension?: string | null
}

export type OpenResult = {
  requestId: string
  status: 'ready'
  localPath: string
  openMode: OpenMode
}

export type OpenState = {
  status: 'idle' | 'preparing' | 'ready' | 'failed'
  localPath: string | null
  openMode: OpenMode | null
  errorMessage: string | null
}

export type PreviewPayload = {
  itemId: string
  itemName: string
  localPath: string
  previewKind: 'image' | 'pdf'
}

export const IDLE_OPEN_STATE: OpenState = {
  status: 'idle',
  localPath: null,
  openMode: null,
  errorMessage: null,
}

export function toPreparingOpenState(current?: OpenState): OpenState {
  return {
    status: 'preparing',
    localPath: current?.localPath ?? null,
    openMode: current?.openMode ?? null,
    errorMessage: null,
  }
}

export function toReadyOpenState(result: OpenResult): OpenState {
  return {
    status: 'ready',
    localPath: result.localPath,
    openMode: result.openMode,
    errorMessage: null,
  }
}

export function toFailedOpenState(message: string, current?: OpenState): OpenState {
  return {
    status: 'failed',
    localPath: current?.localPath ?? null,
    openMode: current?.openMode ?? null,
    errorMessage: message,
  }
}

export function getOpenStateSummary(state: OpenState): string | null {
  switch (state.status) {
    case 'idle':
      return null
    case 'preparing':
      return 'Preparing preview...'
    case 'ready':
      return 'Ready to preview'
    case 'failed':
      return state.errorMessage || 'The preview could not be opened.'
  }
}

export function toPreviewPayload(itemId: string, itemName: string, result: OpenResult): PreviewPayload | null {
  if (result.openMode === 'preview-image') {
    return {
      itemId,
      itemName,
      localPath: result.localPath,
      previewKind: 'image',
    }
  }

  if (result.openMode === 'preview-pdf') {
    return {
      itemId,
      itemName,
      localPath: result.localPath,
      previewKind: 'pdf',
    }
  }

  return null
}

export function canPreviewItem(item: Pick<UnifiedItem, 'mimeType' | 'extension'>): boolean {
  const mimeType = item.mimeType?.trim().toLowerCase() ?? ''
  const extension = item.extension?.trim().replace(/^\./, '').toLowerCase() ?? ''

  return (
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'pdf'].includes(extension)
  )
}
