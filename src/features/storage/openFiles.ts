export type OpenMode = 'preview-image' | 'preview-pdf' | 'system-default'

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
      return 'Preparing file...'
    case 'ready':
      return state.openMode === 'system-default' ? 'Opened in your default app' : 'Ready to preview'
    case 'failed':
      return state.errorMessage || 'The file could not be opened.'
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
