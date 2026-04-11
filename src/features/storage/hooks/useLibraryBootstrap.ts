import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { DemoLibraryState } from '../demoLibrary'
import type { StartUnifiedLibraryLoadResult, UnifiedLibraryLoadEvent } from '../libraryLoad'
import type { RemoteSummary } from '../pendingState'
import type { UnifiedItem } from '../unifiedItems'
import type { WorkspaceDataAction } from '../../../state/workspaceData/WorkspaceDataContext'
import { useLibraryProgressListener } from './useLibraryProgressListener'

type LibraryLoadProgress = {
  requestId: string | null
  loadedRemoteCount: number
  totalRemoteCount: number
}

type DataDispatch = (action: WorkspaceDataAction) => void

/**
 * Unified library cold start + streaming merge events. Does not handle download/upload Tauri listeners
 * (those stay in App via useTransferProgressListeners).
 */
export function useLibraryBootstrap(params: {
  isDemoMode: boolean
  demoState: DemoLibraryState | null
  fetchRemotes: (options?: { silent?: boolean }) => Promise<RemoteSummary[] | null>
  dataDispatch: DataDispatch
  recordIssueMessages: (messages: string[], source: string) => void
  recordIssueError: (error: unknown, source: string) => void
  setRemotes: (next: RemoteSummary[] | ((current: RemoteSummary[]) => RemoteSummary[])) => void
  setUnifiedItems: (next: UnifiedItem[] | ((current: UnifiedItem[]) => UnifiedItem[])) => void
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
  } = params

  const [, setLibraryLoadProgress] = useState<LibraryLoadProgress>({
    requestId: null,
    loadedRemoteCount: 0,
    totalRemoteCount: 0,
  })
  const activeLibraryRequestIdRef = useRef<string | null>(null)

  const handleLibraryProgress = useCallback(
    (payload: UnifiedLibraryLoadEvent) => {
      setLibraryLoadProgress({
        requestId: payload.requestId,
        loadedRemoteCount: payload.loadedRemoteCount,
        totalRemoteCount: payload.totalRemoteCount,
      })

      if (payload.status === 'remote_loaded') {
        dataDispatch({ type: 'data/mergeUnifiedItems', items: payload.items ?? [] })
        recordIssueMessages(payload.notices ?? [], payload.remoteName ? `storage:${payload.remoteName}` : 'library')
        setIsLoadingItems(false)
        return
      }

      if (payload.status === 'remote_failed') {
        recordIssueMessages(
          payload.message ? [payload.message, ...(payload.notices ?? [])] : (payload.notices ?? []),
          payload.remoteName ? `storage:${payload.remoteName}` : 'library-stream',
        )
        void fetchRemotes({ silent: true })
        setIsLoadingItems(false)
        return
      }

      if (payload.status === 'completed') {
        setIsLibraryStreaming(false)
        setIsLoadingItems(false)
        activeLibraryRequestIdRef.current = null
      }
    },
    [dataDispatch, fetchRemotes, recordIssueMessages, setIsLibraryStreaming, setIsLoadingItems],
  )

  const initializeLibrary = useCallback(async () => {
    if (isDemoMode && demoState) {
      setRemotes(demoState.remotes)
      setUnifiedItems(demoState.items)
      setListError('')
      setItemsError('')
      setIsLoadingRemotes(false)
      setIsLoadingItems(false)
      setIsLibraryStreaming(false)
      setIsRefreshingItems(false)
      setLibraryLoadProgress({
        requestId: null,
        loadedRemoteCount: 0,
        totalRemoteCount: 0,
      })
      activeLibraryRequestIdRef.current = null
      return
    }

    setIsLoadingItems(true)
    setIsLibraryStreaming(false)
    setIsRefreshingItems(false)
    setUnifiedItems([])
    setItemsError('')
    setLibraryLoadProgress({
      requestId: null,
      loadedRemoteCount: 0,
      totalRemoteCount: 0,
    })
    activeLibraryRequestIdRef.current = null

    const nextRemotes = await fetchRemotes()

    if (!nextRemotes || nextRemotes.length === 0) {
      setIsLoadingItems(false)
      return
    }

    try {
      const result = await invoke<StartUnifiedLibraryLoadResult>('start_unified_library_load')
      activeLibraryRequestIdRef.current = result.requestId

      setLibraryLoadProgress({
        requestId: result.requestId,
        loadedRemoteCount: 0,
        totalRemoteCount: result.totalRemotes,
      })
      setIsLibraryStreaming(result.totalRemotes > 0)

      if (result.totalRemotes === 0) {
        setIsLoadingItems(false)
        setIsLibraryStreaming(false)
        setIsRefreshingItems(false)
        activeLibraryRequestIdRef.current = null
      }
    } catch (error) {
      setItemsError(error instanceof Error ? error.message : String(error))
      recordIssueError(error, 'library')
      setIsLoadingItems(false)
      setIsLibraryStreaming(false)
      setIsRefreshingItems(false)
      activeLibraryRequestIdRef.current = null
    }
  }, [
    demoState,
    fetchRemotes,
    isDemoMode,
    recordIssueError,
    setIsLibraryStreaming,
    setIsLoadingItems,
    setIsLoadingRemotes,
    setIsRefreshingItems,
    setItemsError,
    setListError,
    setRemotes,
    setUnifiedItems,
  ])

  // Only re-run cold start when demo mode toggles. Do not list `initializeLibrary` in deps:
  // it changes every render when callers pass unstable `fetchRemotes` / setters, which would loop
  // (setIsLoadingItems → re-render → new initializeLibrary → effect → …).
  const initializeLibraryRef = useRef(initializeLibrary)
  initializeLibraryRef.current = initializeLibrary

  useEffect(() => {
    if (isDemoMode) {
      return
    }

    void initializeLibraryRef.current()
  }, [isDemoMode])

  useLibraryProgressListener({
    isDemoMode,
    getActiveRequestId: () => activeLibraryRequestIdRef.current,
    onProgress: handleLibraryProgress,
  })
}
