import { useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  getUploadBatchSummary,
  IDLE_UPLOAD_STATE,
  type PreparedUploadBatch,
  type UploadAcceptedResult,
  type UploadSelection,
} from '../uploads'
import {
  getUploadSelectionDisplayName,
  normalizeDialogSelection,
  toUploadSelections,
} from '../uploadSelection'
import type { ModalName } from '../../../state/workspaceUI/WorkspaceUIContext'

type UploadSummary = ReturnType<typeof getUploadBatchSummary>

type ShowToast = (notice: {
  kind: 'info' | 'warning' | 'error' | 'success'
  message: string
  source: string
  actionLabel?: string
  action?: { type: 'open-upload' }
}) => void

/**
 * Upload modal: file/folder pickers, prepare/merge batch, start_upload_batch, DnD, post-upload toast + refresh.
 * Complements useTransferProgressListeners (progress events) in App.
 */
export function useUploadWorkspaceFlow(params: {
  isDemoMode: boolean
  activeModal: ModalName
  uploadBatch: PreparedUploadBatch | null
  uploadStates: Record<string, import('../uploads').UploadState>
  hasPendingUploadRefresh: boolean
  isStartingUpload: boolean
  showToast: ShowToast
  refreshLibrary: (options?: { silent?: boolean }) => Promise<void>
  setActiveModal: (modal: ModalName) => void
  setUploadError: (error: string) => void
  setIsUploadDragActive: (active: boolean) => void
  setPreparingUploadItems: (items: Array<{ id: string; displayName: string }>) => void
  setIsPreparingUpload: (preparing: boolean) => void
  setUploadBatch: (
    next: PreparedUploadBatch | null | ((current: PreparedUploadBatch | null) => PreparedUploadBatch | null),
  ) => void
  setUploadStates: (
    next:
      | Record<string, import('../uploads').UploadState>
      | ((
          current: Record<string, import('../uploads').UploadState>,
        ) => Record<string, import('../uploads').UploadState>),
  ) => void
  setIsStartingUpload: (starting: boolean) => void
  setHasPendingUploadRefresh: (pending: boolean) => void
}) {
  const {
    isDemoMode,
    activeModal,
    uploadBatch,
    uploadStates,
    hasPendingUploadRefresh,
    isStartingUpload,
    showToast,
    refreshLibrary,
    setActiveModal,
    setUploadError,
    setIsUploadDragActive,
    setPreparingUploadItems,
    setIsPreparingUpload,
    setUploadBatch,
    setUploadStates,
    setIsStartingUpload,
    setHasPendingUploadRefresh,
  } = params

  const lastUploadOutcomeRef = useRef<{ completed: number; failed: number } | null>(null)

  const uploadSummary: UploadSummary = getUploadBatchSummary(uploadBatch?.items ?? [], uploadStates)

  const prepareUploadSelections = useCallback(
    async (selections: UploadSelection[]) => {
      if (isDemoMode) {
        return
      }

      if (selections.length === 0) {
        return
      }

      setPreparingUploadItems(
        selections.map((selection, index) => ({
          id: `${selection.kind}:${selection.path}:${index}`,
          displayName: getUploadSelectionDisplayName(selection.path),
        })),
      )
      setIsPreparingUpload(true)
      setUploadError('')

      try {
        const nextBatch = await invoke<PreparedUploadBatch>('prepare_upload_batch', { input: { selections } })

        setUploadBatch((current) => {
          if (!current) {
            return nextBatch
          }

          const seen = new Set(current.items.map((item) => item.itemId))
          const mergedItems = [...current.items]

          for (const item of nextBatch.items) {
            if (!seen.has(item.itemId)) {
              mergedItems.push(item)
              seen.add(item.itemId)
            }
          }

          return {
            uploadId: current.uploadId,
            items: mergedItems,
            notices: [...current.notices, ...nextBatch.notices].filter(
              (notice, index, notices) => notices.indexOf(notice) === index,
            ),
          }
        })
        setActiveModal('upload')
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : String(error))
        setActiveModal('upload')
      } finally {
        setIsPreparingUpload(false)
        setPreparingUploadItems([])
      }
    },
    [
      isDemoMode,
      setActiveModal,
      setIsPreparingUpload,
      setPreparingUploadItems,
      setUploadBatch,
      setUploadError,
    ],
  )

  const handleChooseUploadFiles = useCallback(async () => {
    if (isDemoMode) {
      return
    }

    try {
      const selected = await openDialog({
        multiple: true,
        directory: false,
        title: 'Choose files to upload',
      })

      const paths = normalizeDialogSelection(selected)
      await prepareUploadSelections(toUploadSelections(paths, 'file'))
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    }
  }, [isDemoMode, prepareUploadSelections, setUploadError])

  const handleChooseUploadFolder = useCallback(async () => {
    if (isDemoMode) {
      return
    }

    try {
      const selected = await openDialog({
        multiple: false,
        directory: true,
        title: 'Choose a folder to upload',
      })

      const paths = normalizeDialogSelection(selected)
      await prepareUploadSelections(toUploadSelections(paths, 'directory'))
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    }
  }, [isDemoMode, prepareUploadSelections, setUploadError])

  const handleStartUpload = useCallback(async () => {
    if (isDemoMode) {
      return
    }

    if (!uploadBatch || uploadBatch.items.length === 0) {
      setUploadError('Add files or folders before starting the upload.')
      return
    }

    setIsStartingUpload(true)
    setUploadError('')
    setHasPendingUploadRefresh(true)
    lastUploadOutcomeRef.current = null

    showToast({
      kind: 'info',
      message: `Uploading ${uploadBatch.items.length} file${uploadBatch.items.length === 1 ? '' : 's'}...`,
      source: 'upload',
      actionLabel: 'Open upload',
      action: { type: 'open-upload' },
    })

    const queuedStates = Object.fromEntries(
      uploadBatch.items.map((item) => [
        item.itemId,
        {
          ...IDLE_UPLOAD_STATE,
          status: 'queued' as const,
          completedCount: 0,
          totalCount: uploadBatch.items.length,
          errorMessage: null,
        },
      ]),
    )

    setUploadStates((current) => ({
      ...current,
      ...queuedStates,
    }))

    try {
      await invoke<UploadAcceptedResult>('start_upload_batch', {
        input: { uploadId: uploadBatch.uploadId, items: uploadBatch.items },
      })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
      setHasPendingUploadRefresh(false)
    } finally {
      setIsStartingUpload(false)
    }
  }, [
    isDemoMode,
    setHasPendingUploadRefresh,
    setIsStartingUpload,
    setUploadError,
    setUploadStates,
    showToast,
    uploadBatch,
  ])

  const resetUploadBatch = useCallback(() => {
    setUploadBatch(null)
    setPreparingUploadItems([])
    setUploadStates({})
    setUploadError('')
    setIsPreparingUpload(false)
    setIsStartingUpload(false)
    setIsUploadDragActive(false)
    setHasPendingUploadRefresh(false)
  }, [
    setHasPendingUploadRefresh,
    setIsPreparingUpload,
    setIsStartingUpload,
    setIsUploadDragActive,
    setPreparingUploadItems,
    setUploadBatch,
    setUploadError,
    setUploadStates,
  ])

  useEffect(() => {
    if (isDemoMode) {
      return
    }

    if (activeModal !== 'upload') {
      setIsUploadDragActive(false)
      return
    }

    let isSubscribed = true

    const unlistenPromise = getCurrentWindow().onDragDropEvent((event) => {
      if (!isSubscribed) {
        return
      }

      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setIsUploadDragActive(true)
        return
      }

      if (event.payload.type === 'leave') {
        setIsUploadDragActive(false)
        return
      }

      if (event.payload.type === 'drop') {
        setIsUploadDragActive(false)
        void prepareUploadSelections(toUploadSelections(event.payload.paths))
      }
    })

    return () => {
      isSubscribed = false
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [activeModal, isDemoMode, prepareUploadSelections, setIsUploadDragActive])

  useEffect(() => {
    if (!hasPendingUploadRefresh) {
      return
    }

    if (uploadSummary.active > 0 || isStartingUpload) {
      return
    }

    if (uploadSummary.completed === 0 && uploadSummary.failed === 0) {
      setHasPendingUploadRefresh(false)
      lastUploadOutcomeRef.current = null
      return
    }

    const previousOutcome = lastUploadOutcomeRef.current
    const nextOutcome = {
      completed: uploadSummary.completed,
      failed: uploadSummary.failed,
    }

    if (
      !previousOutcome ||
      previousOutcome.completed !== nextOutcome.completed ||
      previousOutcome.failed !== nextOutcome.failed
    ) {
      if (uploadSummary.failed > 0 && uploadSummary.completed > 0) {
        showToast({
          kind: 'warning',
          message: `${uploadSummary.completed} uploaded, ${uploadSummary.failed} failed`,
          source: 'upload',
          actionLabel: 'Open upload',
          action: { type: 'open-upload' },
        })
      } else if (uploadSummary.failed > 0) {
        showToast({
          kind: 'error',
          message: `${uploadSummary.failed} file${uploadSummary.failed === 1 ? '' : 's'} failed`,
          source: 'upload',
          actionLabel: 'Open upload',
          action: { type: 'open-upload' },
        })
      } else {
        showToast({
          kind: 'success',
          message: `${uploadSummary.completed} file${uploadSummary.completed === 1 ? '' : 's'} uploaded`,
          source: 'upload',
          actionLabel: 'Open upload',
          action: { type: 'open-upload' },
        })
      }
    }

    lastUploadOutcomeRef.current = nextOutcome
    setHasPendingUploadRefresh(false)
    void refreshLibrary({ silent: true })
  }, [
    hasPendingUploadRefresh,
    isStartingUpload,
    refreshLibrary,
    setHasPendingUploadRefresh,
    showToast,
    uploadSummary.active,
    uploadSummary.completed,
    uploadSummary.failed,
  ])

  return {
    prepareUploadSelections,
    handleChooseUploadFiles,
    handleChooseUploadFolder,
    handleStartUpload,
    resetUploadBatch,
  }
}
