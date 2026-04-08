import { useMemo, useRef } from 'react'
import type { PreviewPayload } from '../openFiles'
import type { PendingSession, RemoteSummary } from '../pendingState'
import type { UnifiedItem, UnifiedItemSortKey } from '../unifiedItems'
import type { PreparedUploadBatch } from '../uploads'
import {
  useTransfers,
  type DownloadStateMap,
  type OpenStateMap,
  type PreparingUploadItem,
  type UploadStateMap,
} from '../../../state/transfers/TransfersContext'
import { useWorkspaceData } from '../../../state/workspaceData/WorkspaceDataContext'
import type { ModalName } from '../../../state/workspaceUI/WorkspaceUIContext'
import { useWorkspaceUI } from '../../../state/workspaceUI/WorkspaceUIContext'

/**
 * Single subscription to workspace UI, data, and transfers with memoized dispatch helpers.
 * See docs/development/react-responsibility-separation.md (App composer, explicit state transitions).
 */
export function useWorkspaceAppBindings() {
  const { state: ui, dispatch: uiDispatch } = useWorkspaceUI()
  const { state: data, dispatch: dataDispatch, actions: dataActions } = useWorkspaceData()
  const { state: transfers, dispatch: transfersDispatch } = useTransfers()

  const uiRef = useRef(ui)
  uiRef.current = ui
  const dataRef = useRef(data)
  dataRef.current = data
  const transfersRef = useRef(transfers)
  transfersRef.current = transfers

  // Dispatch helpers must stay referentially stable: they are listed in dependency arrays of hooks
  // (library progress, splash timers, etc.). Closing over `ui`/`data`/`transfers` would recreate them
  // on every state change and retrigger those effects in a loop.
  const setters = useMemo(
    () => ({
      setSortKey: (nextSortKey: UnifiedItemSortKey) => uiDispatch({ type: 'ui/setSortKey', sortKey: nextSortKey }),
      setIsSortMenuOpen: (open: boolean) => uiDispatch({ type: 'ui/setSortMenuOpen', open }),
      setOpenRowMenuItemId: (itemId: string | null) => uiDispatch({ type: 'ui/setOpenRowMenuItemId', itemId }),
      setIsStartupSplashVisible: (visible: boolean) =>
        uiDispatch({
          type: 'ui/setStartupSplash',
          visible,
          exiting: uiRef.current.isStartupSplashExiting,
        }),
      setIsStartupSplashExiting: (exiting: boolean) =>
        uiDispatch({
          type: 'ui/setStartupSplash',
          visible: uiRef.current.isStartupSplashVisible,
          exiting,
        }),
      setActiveModal: (modal: ModalName) => uiDispatch({ type: 'ui/setActiveModal', modal }),
      setPreviewPayload: (payload: PreviewPayload | null) => uiDispatch({ type: 'ui/setPreviewPayload', payload }),
      setIsIssuesModalOpen: (open: boolean) => uiDispatch({ type: 'ui/setIssuesModal', open }),
      setFocusedIssueId: (issueId: string | null) =>
        uiDispatch({ type: 'ui/setIssuesModal', open: true, focusedIssueId: issueId }),
      setIsFeedbackPromptOpen: (open: boolean) => uiDispatch({ type: 'ui/setFeedbackPromptOpen', open }),

      setRemotes: (next: RemoteSummary[] | ((current: RemoteSummary[]) => RemoteSummary[])) => {
        const resolved = typeof next === 'function' ? next(dataRef.current.remotes) : next
        dataDispatch({ type: 'data/setRemotes', remotes: resolved })
      },
      setUnifiedItems: (next: UnifiedItem[] | ((current: UnifiedItem[]) => UnifiedItem[])) => {
        const resolved = typeof next === 'function' ? next(dataRef.current.unifiedItems) : next
        dataDispatch({ type: 'data/setUnifiedItems', items: resolved })
      },
      setListError: (error: string) => dataDispatch({ type: 'data/setListError', error }),
      setItemsError: (error: string) => dataDispatch({ type: 'data/setItemsError', error }),
      setIsLoadingRemotes: (loading: boolean) => dataDispatch({ type: 'data/setLoadingRemotes', loading }),
      setIsLoadingItems: (loading: boolean) => dataDispatch({ type: 'data/setLoadingItems', loading }),
      setIsLibraryStreaming: (streaming: boolean) => dataDispatch({ type: 'data/setLibraryStreaming', streaming }),
      setIsRefreshingItems: (refreshing: boolean) => dataDispatch({ type: 'data/setRefreshingItems', refreshing }),
      setPendingSession: (pending: PendingSession | null) => dataDispatch({ type: 'data/setPendingSession', pending }),
      setSelectedDriveId: (driveId: string) => dataDispatch({ type: 'data/setSelectedDriveId', driveId }),
      setIsFinalizingDrive: (finalizing: boolean) => dataDispatch({ type: 'data/setFinalizingDrive', finalizing }),
      setRemoveTarget: (target: RemoteSummary | null) => dataDispatch({ type: 'data/setRemoveTarget', target }),
      setRemoveError: (error: string) => dataDispatch({ type: 'data/setRemoveError', error }),
      setIsRemoving: (removing: boolean) => dataDispatch({ type: 'data/setRemoving', removing }),

      setDownloadStates: (next: DownloadStateMap | ((current: DownloadStateMap) => DownloadStateMap)) => {
        const resolved = typeof next === 'function' ? next(transfersRef.current.downloadStates) : next
        transfersDispatch({ type: 'transfers/setDownloadStates', states: resolved })
      },
      setOpenStates: (next: OpenStateMap | ((current: OpenStateMap) => OpenStateMap)) => {
        const resolved = typeof next === 'function' ? next(transfersRef.current.openStates) : next
        transfersDispatch({ type: 'transfers/setOpenStates', states: resolved })
      },
      setUploadStates: (next: UploadStateMap | ((current: UploadStateMap) => UploadStateMap)) => {
        const resolved = typeof next === 'function' ? next(transfersRef.current.uploadStates) : next
        transfersDispatch({ type: 'transfers/setUploadStates', states: resolved })
      },
      setUploadBatch: (
        next: PreparedUploadBatch | null | ((current: PreparedUploadBatch | null) => PreparedUploadBatch | null),
      ) => {
        const resolved = typeof next === 'function' ? next(transfersRef.current.uploadBatch) : next
        transfersDispatch({ type: 'transfers/setUploadBatch', batch: resolved })
      },
      setPreparingUploadItems: (items: PreparingUploadItem[]) =>
        transfersDispatch({ type: 'transfers/setPreparingUploadItems', items }),
      setUploadError: (error: string) => transfersDispatch({ type: 'transfers/setUploadError', error }),
      setIsPreparingUpload: (preparing: boolean) => transfersDispatch({ type: 'transfers/setPreparingUpload', preparing }),
      setIsStartingUpload: (starting: boolean) => transfersDispatch({ type: 'transfers/setStartingUpload', starting }),
      setIsUploadDragActive: (active: boolean) => transfersDispatch({ type: 'transfers/setUploadDragActive', active }),
      setHasPendingUploadRefresh: (pending: boolean) =>
        transfersDispatch({ type: 'transfers/setHasPendingUploadRefresh', pending }),
    }),
    [uiDispatch, dataDispatch, transfersDispatch],
  )

  return useMemo(
    () => ({
      ui,
      data,
      transfers,
      dataActions,
      dataDispatch,
      ...setters,
    }),
    [ui, data, transfers, dataActions, dataDispatch, setters],
  )
}

export type WorkspaceAppBindings = ReturnType<typeof useWorkspaceAppBindings>
