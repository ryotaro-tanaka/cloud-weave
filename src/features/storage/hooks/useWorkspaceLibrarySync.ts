import { useCallback } from 'react'
import type { DemoLibraryState } from '../demoLibrary'
import type { RemoteSummary } from '../pendingState'
import type { UnifiedItem } from '../unifiedItems'
import type { WorkspaceDataAction } from '../../../state/workspaceData/WorkspaceDataContext'
import { useLibraryBootstrap } from './useLibraryBootstrap'
import { useRemoteConnectSync } from './useRemoteConnectSync'

type DataDispatch = (action: WorkspaceDataAction) => void
type DataActions = {
  fetchRemotes: (options?: { silent?: boolean; demoRemotes?: RemoteSummary[] }) => Promise<RemoteSummary[] | null>
  fetchUnifiedItems: (
    options?: { silent?: boolean; demoItems?: UnifiedItem[]; remotesOverride?: RemoteSummary[] | null },
  ) => Promise<UnifiedItem[] | null>
}

type SetRemotes = (next: RemoteSummary[] | ((current: RemoteSummary[]) => RemoteSummary[])) => void
type SetUnifiedItems = (next: UnifiedItem[] | ((current: UnifiedItem[]) => UnifiedItem[])) => void

/**
 * App-level library synchronization orchestration.
 * Keeps fetch/refresh/connect-sync wiring out of App composer.
 */
export function useWorkspaceLibrarySync(params: {
  isDemoMode: boolean
  demoState: DemoLibraryState | null
  dataActions: DataActions
  dataDispatch: DataDispatch
  recordIssueMessages: (messages: string[], source: string) => void
  recordIssueError: (error: unknown, source: string) => void
  setRemotes: SetRemotes
  setUnifiedItems: SetUnifiedItems
  setListError: (error: string) => void
  setItemsError: (error: string) => void
  setIsLoadingRemotes: (loading: boolean) => void
  setIsLoadingItems: (loading: boolean) => void
  setIsLibraryStreaming: (streaming: boolean) => void
  setIsRefreshingItems: (refreshing: boolean) => void
}) {
  const {
    isDemoMode,
    demoState,
    dataActions,
    dataDispatch,
    recordIssueMessages,
    recordIssueError,
    setRemotes,
    setUnifiedItems,
    setListError,
    setItemsError,
    setIsLoadingRemotes,
    setIsLoadingItems,
    setIsLibraryStreaming,
    setIsRefreshingItems,
  } = params

  const fetchRemotes = useCallback(
    (options?: { silent?: boolean }) =>
      dataActions.fetchRemotes({ silent: options?.silent, demoRemotes: isDemoMode && demoState ? demoState.remotes : undefined }),
    [dataActions, demoState, isDemoMode],
  )

  const fetchUnifiedItems = useCallback(
    (nextRemotes?: RemoteSummary[] | null, options?: { silent?: boolean }) =>
      dataActions.fetchUnifiedItems({
        silent: options?.silent,
        demoItems: isDemoMode && demoState ? demoState.items : undefined,
        remotesOverride: nextRemotes === undefined ? undefined : nextRemotes,
      }),
    [dataActions, demoState, isDemoMode],
  )

  const refreshLibrary = useCallback(
    async (options?: { silent?: boolean }) => {
      const nextRemotes = await fetchRemotes(options)
      await fetchUnifiedItems(nextRemotes, options)
    },
    [fetchRemotes, fetchUnifiedItems],
  )

  const { synchronizeConnectedRemote } = useRemoteConnectSync({
    setRemotes,
    fetchRemotes,
    fetchUnifiedItems,
    refreshLibrary,
  })

  useLibraryBootstrap({
    isDemoMode,
    demoState,
    fetchRemotes,
    dataDispatch,
    recordIssueMessages,
    recordIssueError,
    setRemotes,
    setUnifiedItems,
    setListError,
    setItemsError,
    setIsLoadingRemotes,
    setIsLoadingItems,
    setIsLibraryStreaming,
    setIsRefreshingItems,
  })

  return {
    fetchRemotes,
    refreshLibrary,
    synchronizeConnectedRemote,
  }
}
