import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openPath } from '@tauri-apps/plugin-shell'
import {
  applyDownloadProgressEvent,
  type DownloadAcceptedResult,
  type DownloadRequest,
} from '../downloads'
import {
  canOpenInDefaultApp,
  canPreviewItem,
  toFailedOpenState,
  toPreparingOpenState,
  toPreviewPayload,
  toReadyOpenState,
  type OpenRequest,
  type OpenResult,
} from '../openFiles'
import type { RemoteSummary } from '../pendingState'
import type { UnifiedItem } from '../unifiedItems'
import type { ActionResult } from '../tauriActionResults'

/**
 * Download / open+preview / delete remote — invoke-heavy file operations (Usecase layer).
 */
export function useFileTransferActions(params: {
  isDemoMode: boolean
  removeTarget: RemoteSummary | null
  setDownloadStates: (
    next:
      | import('../../../state/transfers/TransfersContext').DownloadStateMap
      | ((
          current: import('../../../state/transfers/TransfersContext').DownloadStateMap,
        ) => import('../../../state/transfers/TransfersContext').DownloadStateMap),
  ) => void
  setOpenStates: (
    next:
      | import('../../../state/transfers/TransfersContext').OpenStateMap
      | ((
          current: import('../../../state/transfers/TransfersContext').OpenStateMap,
        ) => import('../../../state/transfers/TransfersContext').OpenStateMap),
  ) => void
  setPreviewPayload: (payload: import('../openFiles').PreviewPayload | null) => void
  setActiveModal: (modal: import('../../../state/workspaceUI/WorkspaceUIContext').ModalName) => void
  setRemoveTarget: (target: RemoteSummary | null) => void
  setRemoveError: (error: string) => void
  setIsRemoving: (removing: boolean) => void
  refreshLibrary: (options?: { silent?: boolean }) => Promise<void>
}) {
  const {
    isDemoMode,
    removeTarget,
    setDownloadStates,
    setOpenStates,
    setPreviewPayload,
    setActiveModal,
    setRemoveTarget,
    setRemoveError,
    setIsRemoving,
    refreshLibrary,
  } = params

  const handleDownload = useCallback(
    async (item: UnifiedItem) => {
      if (isDemoMode) {
        return
      }

      if (item.isDir) {
        return
      }

      const request = {
        downloadId: item.id,
        sourceRemote: item.sourceRemote,
        sourcePath: item.sourcePath,
        displayName: item.name,
        size: item.size > 0 ? item.size : undefined,
      } satisfies DownloadRequest

      setDownloadStates((current) =>
        applyDownloadProgressEvent(current, {
          downloadId: request.downloadId,
          status: 'queued',
          totalBytes: request.size ?? null,
          errorMessage: null,
        }),
      )

      try {
        const result = await invoke<DownloadAcceptedResult>('start_download', { input: request })

        setDownloadStates((current) =>
          applyDownloadProgressEvent(current, {
            downloadId: result.downloadId,
            status: 'queued',
            targetPath: result.targetPath,
            totalBytes: request.size ?? null,
            errorMessage: null,
          }),
        )
      } catch (error) {
        setDownloadStates((current) =>
          applyDownloadProgressEvent(current, {
            downloadId: request.downloadId,
            status: 'failed',
            totalBytes: request.size ?? null,
            errorMessage: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    },
    [isDemoMode, setDownloadStates],
  )

  const handleOpen = useCallback(
    async (item: UnifiedItem) => {
      if (isDemoMode) {
        return
      }

      if (item.isDir || (!canPreviewItem(item) && !canOpenInDefaultApp(item))) {
        return
      }

      const request = {
        requestId: item.id,
        sourceRemote: item.sourceRemote,
        sourcePath: item.sourcePath,
        displayName: item.name,
        mimeType: item.mimeType,
        extension: item.extension,
      } satisfies OpenRequest

      setOpenStates((current) => ({
        ...current,
        [item.id]: toPreparingOpenState(current[item.id]),
      }))

      try {
        const result = await invoke<OpenResult>('prepare_open_file', { input: request })

        setOpenStates((current) => ({
          ...current,
          [item.id]: toReadyOpenState(result),
        }))

        const preview = toPreviewPayload(item.id, item.name, result)
        if (preview) {
          setPreviewPayload(preview)
          return
        }

        await openPath(result.localPath)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setOpenStates((current) => ({
          ...current,
          [item.id]: toFailedOpenState(message, current[item.id]),
        }))
      }
    },
    [isDemoMode, setOpenStates, setPreviewPayload],
  )

  const handleDeleteRemote = useCallback(async () => {
    if (isDemoMode) {
      return
    }

    if (!removeTarget) {
      return
    }

    setIsRemoving(true)
    setRemoveError('')

    try {
      const result = await invoke<ActionResult>('delete_remote', { name: removeTarget.name })

      if (result.status === 'error') {
        setRemoveError(result.message)
        return
      }

      setActiveModal('none')
      setRemoveTarget(null)
      await refreshLibrary({ silent: true })
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRemoving(false)
    }
  }, [isDemoMode, refreshLibrary, removeTarget, setActiveModal, setIsRemoving, setRemoveError, setRemoveTarget])

  return {
    handleDownload,
    handleOpen,
    handleDeleteRemote,
  }
}
