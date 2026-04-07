import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { open as openPath } from '@tauri-apps/plugin-shell'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  isCallbackStartupFailure,
  overlayPendingRemote,
  type AuthSessionRecord,
  type PendingSession,
  type RemoteSummary,
} from './features/storage/pendingState'
import {
  filterItemsByView,
  getCategoryLabel,
  groupRecentItems,
  searchUnifiedItems,
  sortUnifiedItems,
  type LogicalView,
  type UnifiedItemSortKey,
  type UnifiedItem,
} from './features/storage/unifiedItems'
import { getDemoLibraryState, type DemoLibraryState } from './features/storage/demoLibrary'
import {
  applyDownloadProgressEvent,
  IDLE_DOWNLOAD_STATE,
  type DownloadAcceptedResult,
  type DownloadProgressEvent,
  type DownloadRequest,
} from './features/storage/downloads'
import {
  canOpenInDefaultApp,
  canPreviewItem,
  IDLE_OPEN_STATE,
  toFailedOpenState,
  toPreparingOpenState,
  toPreviewPayload,
  toReadyOpenState,
  type OpenRequest,
  type OpenResult,
  type PreviewPayload,
} from './features/storage/openFiles'
import {
  type StartUnifiedLibraryLoadResult,
  type UnifiedLibraryLoadEvent,
} from './features/storage/libraryLoad'
import {
  applyUploadProgressEvent,
  getUploadBatchSummary,
  IDLE_UPLOAD_STATE,
  type PreparedUploadBatch,
  type UploadAcceptedResult,
  type UploadProgressEvent,
  type UploadSelection,
} from './features/storage/uploads'
import { Button } from './components/ui/Button'
import { ToastNoticeRow } from './components/ui/ToastNoticeRow'
import { ToastStack } from './components/ui/ToastStack'
import { useDismissOnOutsideOrEscape } from './components/ui/useDismissOnOutsideOrEscape'
import { LibraryMain } from './components/workspace/LibraryMain'
import { LibraryShell } from './components/workspace/LibraryShell'
import { LibraryTopbar } from './components/workspace/LibraryTopbar'
import { StorageSidebar } from './components/workspace/StorageSidebar'
import { WorkspaceShell } from './components/workspace/WorkspaceShell'
import type { ProviderDefinition } from './components/modals/AddStorageModal'
import { WorkspaceModals } from './components/modals/WorkspaceModals'
import { useWorkspaceUI } from './state/workspaceUI/WorkspaceUIContext'
import { useWorkspaceData, type IssueLevel, type WorkspaceIssue } from './state/workspaceData/WorkspaceDataContext'
import { useTransfers } from './state/transfers/TransfersContext'
import { useStartupSplash } from './features/storage/hooks/useStartupSplash'
import { usePendingSessionPolling } from './features/storage/hooks/usePendingSessionPolling'
import { useTransferProgressListeners } from './features/storage/hooks/useTransferProgressListeners'
import { useLibraryProgressListener } from './features/storage/hooks/useLibraryProgressListener'
import { useRemoteAuthFlow } from './features/storage/hooks/useRemoteAuthFlow'
import splashLockup from '../assets/brand/cloud-weave-lockup.png'
import './App.css'
import './components/ui/toast.css'
import './components/workspace/styles/shell.css'
import './components/workspace/styles/sidebar.css'
import './components/workspace/styles/topbar.css'
import './components/workspace/styles/library-main.css'
import './components/modals/styles/modals.css'
import './components/workspace/styles/responsive.css'

type ActionResult = {
  status: 'success' | 'error'
  message: string
}

type ExportDiagnosticsResult = {
  status: 'success'
  diagnosticsDir: string
  summaryPath: string
  zipPath: string
  message: string
}

type DiagnosticsIssueSummary = {
  level: IssueLevel
  source: string
  timestamp: number
  message: string
}

type ExportDiagnosticsInput = {
  currentLogicalView: LogicalView
  recentIssuesSummary: DiagnosticsIssueSummary[]
}

type LibraryLoadProgress = {
  requestId: string | null
  loadedRemoteCount: number
  totalRemoteCount: number
}

const STORAGE_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'onedrive',
    label: 'OneDrive',
    authType: 'oauth',
    enabled: true,
    description: 'Connect with Microsoft in your browser',
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    authType: 'oauth',
    enabled: false,
    description: 'Coming next',
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    authType: 'oauth',
    enabled: false,
    description: 'Planned after Google Drive',
  },
  {
    id: 'icloud',
    label: 'iCloud Drive',
    authType: 'form',
    enabled: false,
    description: 'Needs separate support work',
  },
]

const PRIMARY_NAV_ITEMS: Array<{ id: LogicalView; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'documents', label: 'Documents' },
  { id: 'photos', label: 'Photos' },
  { id: 'videos', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'other', label: 'Other' },
]
const EMPTY_PENDING_MESSAGE = 'Complete authentication in your browser.'
const CONNECT_SUCCESS_MESSAGE = 'Your storage is connected and ready to use.'
const CONNECT_SYNC_ATTEMPTS = 8
const CONNECT_SYNC_DELAY_MS = 500
const STARTUP_SPLASH_VISIBLE_MS = 3000
const STARTUP_SPLASH_FADE_MS = 260
const BASIN_FEEDBACK_URL = 'https://usebasin.com/form/37c12519bb6c/hosted/46b7f138fca3'
const SORT_OPTIONS: Array<{ value: UnifiedItemSortKey; label: string }> = [
  { value: 'updated-desc', label: 'Newest' },
  { value: 'updated-asc', label: 'Oldest' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
  { value: 'size-desc', label: 'Size ↓' },
  { value: 'size-asc', label: 'Size ↑' },
]

function isScreenshotDemoEnabled(): boolean {
  return import.meta.env.VITE_SCREENSHOT_DEMO === '1'
}

function getDefaultSortKey(view: LogicalView): UnifiedItemSortKey {
  return view === 'recent' ? 'updated-desc' : 'name-asc'
}

function getSortLabel(sortKey: UnifiedItemSortKey): string {
  return SORT_OPTIONS.find((option) => option.value === sortKey)?.label ?? 'Newest'
}

// issue severity/id logic moved to WorkspaceDataContext

function formatIssueTimestamp(timestamp: number): string {
  const parsed = new Date(timestamp)

  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown date'
  }

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  const hour = String(parsed.getHours()).padStart(2, '0')
  const minute = String(parsed.getMinutes()).padStart(2, '0')

  return `${year}/${month}/${day} ${hour}:${minute}`
}

function getParentDirectory(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))

  if (lastSeparatorIndex <= 0) {
    return path
  }

  return normalized.slice(0, lastSeparatorIndex)
}

function getFileName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))

  if (lastSeparatorIndex < 0) {
    return normalized
  }

  return normalized.slice(lastSeparatorIndex + 1)
}

function describeIssueSource(source: string): string {
  if (source.startsWith('storage:')) {
    return source.replace('storage:', '')
  }

  if (source === 'library-stream') {
    return 'Unified library'
  }

  return 'Workspace'
}

function inferFeedbackTypeFromIssue(issue: WorkspaceIssue | null): string | null {
  if (!issue) {
    return null
  }

  return issue.level === 'error' || issue.level === 'warning' ? 'Bug' : 'Other'
}

function buildDiagnosticsInput(activeView: LogicalView, workspaceIssues: WorkspaceIssue[]): ExportDiagnosticsInput {
  return {
    currentLogicalView: activeView,
    recentIssuesSummary: workspaceIssues.slice(0, 10).map((issue) => ({
      level: issue.level,
      source: issue.source,
      timestamp: issue.timestamp,
      message: issue.message,
    })),
  }
}

function describeIssueLocation(source: string): string {
  if (source.startsWith('storage:')) {
    return 'Relevant place: Storages'
  }

  return 'Relevant place: Issues'
}

function App() {
  const [demoState] = useState<DemoLibraryState | null>(() => (isScreenshotDemoEnabled() ? getDemoLibraryState() : null))
  const isDemoMode = demoState !== null
  const { state: ui, dispatch: uiDispatch } = useWorkspaceUI()
  const { state: data, dispatch: dataDispatch, actions: dataActions } = useWorkspaceData()
  const { state: transfers, dispatch: transfersDispatch } = useTransfers()

  const activeView = ui.activeView
  const searchQuery = ui.searchQuery
  const sortKey = ui.sortKey
  const isSortMenuOpen = ui.isSortMenuOpen
  const openRowMenuItemId = ui.openRowMenuItemId
  const isStartupSplashVisible = ui.isStartupSplashVisible
  const isStartupSplashExiting = ui.isStartupSplashExiting
  const activeModal = ui.activeModal
  const previewPayload = ui.previewPayload
  const isIssuesModalOpen = ui.isIssuesModalOpen
  const focusedIssueId = ui.focusedIssueId
  const isFeedbackPromptOpen = ui.isFeedbackPromptOpen

  const remotes = data.remotes
  const unifiedItems = data.unifiedItems
  const workspaceIssues = data.workspaceIssues
  const toastNotices = data.toastNotices
  const listError = data.listError
  const itemsError = data.itemsError
  const isLoadingRemotes = data.isLoadingRemotes
  const isLoadingItems = data.isLoadingItems
  const isLibraryStreaming = data.isLibraryStreaming
  const isRefreshingItems = data.isRefreshingItems
  const pendingSession = data.pendingSession
  const selectedDriveId = data.selectedDriveId
  const isFinalizingDrive = data.isFinalizingDrive
  const removeTarget = data.removeTarget
  const removeError = data.removeError
  const isRemoving = data.isRemoving

  const downloadStates = transfers.downloadStates
  const openStates = transfers.openStates
  const uploadStates = transfers.uploadStates
  const uploadBatch = transfers.uploadBatch
  const preparingUploadItems = transfers.preparingUploadItems
  const uploadError = transfers.uploadError
  const isPreparingUpload = transfers.isPreparingUpload
  const isStartingUpload = transfers.isStartingUpload
  const isUploadDragActive = transfers.isUploadDragActive
  const hasPendingUploadRefresh = transfers.hasPendingUploadRefresh

  const setSortKey = (nextSortKey: UnifiedItemSortKey) => uiDispatch({ type: 'ui/setSortKey', sortKey: nextSortKey })
  const setIsSortMenuOpen = (open: boolean) => uiDispatch({ type: 'ui/setSortMenuOpen', open })
  const setOpenRowMenuItemId = (itemId: string | null) => uiDispatch({ type: 'ui/setOpenRowMenuItemId', itemId })
  const setIsStartupSplashVisible = (visible: boolean) =>
    uiDispatch({ type: 'ui/setStartupSplash', visible, exiting: ui.isStartupSplashExiting })
  const setIsStartupSplashExiting = (exiting: boolean) =>
    uiDispatch({ type: 'ui/setStartupSplash', visible: ui.isStartupSplashVisible, exiting })
  const setActiveModal = (modal: 'none' | 'add-storage' | 'oauth-pending' | 'remove-confirm' | 'upload') =>
    uiDispatch({ type: 'ui/setActiveModal', modal })
  const setPreviewPayload = (payload: PreviewPayload | null) => uiDispatch({ type: 'ui/setPreviewPayload', payload })
  const setIsIssuesModalOpen = (open: boolean) => uiDispatch({ type: 'ui/setIssuesModal', open })
  const setFocusedIssueId = (issueId: string | null) => uiDispatch({ type: 'ui/setIssuesModal', open: true, focusedIssueId: issueId })
  const setIsFeedbackPromptOpen = (open: boolean) => uiDispatch({ type: 'ui/setFeedbackPromptOpen', open })

  const setRemotes = (next: RemoteSummary[] | ((current: RemoteSummary[]) => RemoteSummary[])) => {
    const resolved = typeof next === 'function' ? next(remotes) : next
    dataDispatch({ type: 'data/setRemotes', remotes: resolved })
  }
  const setUnifiedItems = (next: UnifiedItem[] | ((current: UnifiedItem[]) => UnifiedItem[])) => {
    const resolved = typeof next === 'function' ? next(unifiedItems) : next
    dataDispatch({ type: 'data/setUnifiedItems', items: resolved })
  }
  // issues/toasts are managed via WorkspaceDataContext actions
  const setListError = (error: string) => dataDispatch({ type: 'data/setListError', error })
  const setItemsError = (error: string) => dataDispatch({ type: 'data/setItemsError', error })
  const setIsLoadingRemotes = (loading: boolean) => dataDispatch({ type: 'data/setLoadingRemotes', loading })
  const setIsLoadingItems = (loading: boolean) => dataDispatch({ type: 'data/setLoadingItems', loading })
  const setIsLibraryStreaming = (streaming: boolean) => dataDispatch({ type: 'data/setLibraryStreaming', streaming })
  const setIsRefreshingItems = (refreshing: boolean) => dataDispatch({ type: 'data/setRefreshingItems', refreshing })
  const setPendingSession = (pending: PendingSession | null) => dataDispatch({ type: 'data/setPendingSession', pending })
  const setSelectedDriveId = (driveId: string) => dataDispatch({ type: 'data/setSelectedDriveId', driveId })
  const setIsFinalizingDrive = (finalizing: boolean) => dataDispatch({ type: 'data/setFinalizingDrive', finalizing })
  const setRemoveTarget = (target: RemoteSummary | null) => dataDispatch({ type: 'data/setRemoveTarget', target })
  const setRemoveError = (error: string) => dataDispatch({ type: 'data/setRemoveError', error })
  const setIsRemoving = (removing: boolean) => dataDispatch({ type: 'data/setRemoving', removing })

  const setDownloadStates = (next: typeof downloadStates | ((current: typeof downloadStates) => typeof downloadStates)) => {
    const resolved = typeof next === 'function' ? next(downloadStates) : next
    transfersDispatch({ type: 'transfers/setDownloadStates', states: resolved })
  }
  const setOpenStates = (next: typeof openStates | ((current: typeof openStates) => typeof openStates)) => {
    const resolved = typeof next === 'function' ? next(openStates) : next
    transfersDispatch({ type: 'transfers/setOpenStates', states: resolved })
  }
  const setUploadStates = (next: typeof uploadStates | ((current: typeof uploadStates) => typeof uploadStates)) => {
    const resolved = typeof next === 'function' ? next(uploadStates) : next
    transfersDispatch({ type: 'transfers/setUploadStates', states: resolved })
  }
  const setUploadBatch = (next: PreparedUploadBatch | null | ((current: PreparedUploadBatch | null) => PreparedUploadBatch | null)) => {
    const resolved = typeof next === 'function' ? next(uploadBatch) : next
    transfersDispatch({ type: 'transfers/setUploadBatch', batch: resolved })
  }
  const setPreparingUploadItems = (items: Array<{ id: string; displayName: string }>) =>
    transfersDispatch({ type: 'transfers/setPreparingUploadItems', items })
  const setUploadError = (error: string) => transfersDispatch({ type: 'transfers/setUploadError', error })
  const setIsPreparingUpload = (preparing: boolean) => transfersDispatch({ type: 'transfers/setPreparingUpload', preparing })
  const setIsStartingUpload = (starting: boolean) => transfersDispatch({ type: 'transfers/setStartingUpload', starting })
  const setIsUploadDragActive = (active: boolean) => transfersDispatch({ type: 'transfers/setUploadDragActive', active })
  const setHasPendingUploadRefresh = (pending: boolean) => transfersDispatch({ type: 'transfers/setHasPendingUploadRefresh', pending })

  // Kept in App for now; will be moved to data context in effects-placement.
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false)
  const [isOpeningFeedbackForm, setIsOpeningFeedbackForm] = useState(false)
  const [, setLibraryLoadProgress] = useState<LibraryLoadProgress>({
    requestId: null,
    loadedRemoteCount: 0,
    totalRemoteCount: 0,
  })
  const activeLibraryRequestIdRef = useRef<string | null>(null)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)
  const lastUploadOutcomeRef = useRef<{ completed: number; failed: number } | null>(null)

  const displayedItems = useMemo(() => {
    const viewItems = filterItemsByView(unifiedItems, activeView)
    const searchResults = searchUnifiedItems(viewItems, searchQuery)
    return sortUnifiedItems(searchResults, sortKey)
  }, [activeView, searchQuery, sortKey, unifiedItems])

  const displayedRemotes = useMemo(() => overlayPendingRemote(remotes, pendingSession), [pendingSession, remotes])
  const pendingHasCallbackStartupFailure = pendingSession ? isCallbackStartupFailure(pendingSession.errorCode) : false
  const pendingIsFinalizing = pendingSession?.stage === 'finalizing'
  const reconnectRequiredRemotes = useMemo(
    () => remotes.filter((remote) => remote.status === 'reconnect_required'),
    [remotes],
  )
  const visibleToasts = toastNotices
  const focusedIssue = useMemo(
    () => (focusedIssueId ? workspaceIssues.find((issue) => issue.id === focusedIssueId) ?? null : null),
    [focusedIssueId, workspaceIssues],
  )

  const groupedRecentItems = useMemo(() => {
    if (activeView !== 'recent' || sortKey !== 'updated-desc') {
      return []
    }

    return groupRecentItems(displayedItems)
  }, [activeView, displayedItems, sortKey])

  const uploadSummary = useMemo(
    () => getUploadBatchSummary(uploadBatch?.items ?? [], uploadStates),
    [uploadBatch, uploadStates],
  )
  const uploadListItems = useMemo(() => {
    if (!uploadBatch) {
      return []
    }

    return uploadBatch.items.map((item) => ({
      item,
      state: uploadStates[item.itemId] ?? IDLE_UPLOAD_STATE,
    }))
  }, [uploadBatch, uploadStates])
  const hasUploadItems = uploadListItems.length > 0
  const hasReadyUploads = uploadListItems.some(({ state }) => state.status === 'idle')
  const shouldShowPreparingUploadList = isPreparingUpload && preparingUploadItems.length > 0
  const currentViewLabel = getCategoryLabel(activeView)

  const { showToast, markIssuesRead, recordIssueMessages, recordIssueError } = dataActions

  const openIssuesModal = (issueId?: string) => {
    setFocusedIssueId(issueId ?? null)
    setIsIssuesModalOpen(true)
    markIssuesRead(issueId ? [issueId] : undefined)
  }

  const exportDiagnostics = async () => {
    if (isExportingDiagnostics) {
      return null
    }

    setIsExportingDiagnostics(true)

    try {
      return await invoke<ExportDiagnosticsResult>('export_diagnostics', {
        input: buildDiagnosticsInput(activeView, workspaceIssues),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export diagnostics right now.'
      showToast({
        kind: 'error',
        message,
        source: 'feedback',
      })
      return null
    } finally {
      setIsExportingDiagnostics(false)
    }
  }

  const startFeedbackFlow = async () => {
    if (isExportingDiagnostics || isOpeningFeedbackForm) {
      return
    }

    const diagnosticsResult = await exportDiagnostics()
    if (!diagnosticsResult) {
      return
    }

    setIsOpeningFeedbackForm(true)

    try {
      const feedbackUrl = new URL(BASIN_FEEDBACK_URL)
      const appVersion = '0.3.1'
      const feedbackType = inferFeedbackTypeFromIssue(focusedIssue)

      feedbackUrl.searchParams.set('app_version', appVersion)
      if (feedbackType) {
        feedbackUrl.searchParams.set('feedback_type', feedbackType)
      }

      await openPath(feedbackUrl.toString())
      setIsFeedbackPromptOpen(false)
      const zipFileName = getFileName(diagnosticsResult.zipPath)
      showToast({
        kind: 'success',
        message: `Feedback form opened. Attach ${zipFileName} from Downloads.`,
        source: 'feedback',
        actionLabel: 'Open Downloads',
        action: { type: 'open-path', path: getParentDirectory(diagnosticsResult.zipPath) },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open the feedback form.'
      showToast({
        kind: 'error',
        message,
        source: 'feedback',
      })
    } finally {
      setIsOpeningFeedbackForm(false)
    }
  }

  // issue/toast logic lives in WorkspaceDataContext

  useEffect(() => {
    setSortKey(getDefaultSortKey(activeView))
  }, [activeView])

  const isInsideSortMenu = useCallback((target: Node) => sortMenuRef.current?.contains(target) ?? false, [])

  useDismissOnOutsideOrEscape(isSortMenuOpen, () => setIsSortMenuOpen(false), isInsideSortMenu)

  useStartupSplash({
    visibleMs: STARTUP_SPLASH_VISIBLE_MS,
    fadeMs: STARTUP_SPLASH_FADE_MS,
    onStartExit: () => setIsStartupSplashExiting(true),
    onHide: () => setIsStartupSplashVisible(false),
  })

  const isInsideRowMenu = useCallback((target: Node) => {
    const element = target instanceof Element ? target : target.parentElement
    return Boolean(element?.closest('[data-row-menu-container="true"]'))
  }, [])

  useDismissOnOutsideOrEscape(openRowMenuItemId !== null, () => setOpenRowMenuItemId(null), isInsideRowMenu)

  useEffect(() => {
    for (const remote of reconnectRequiredRemotes) {
      recordIssueMessages([remote.message || `${remote.name} needs reconnect.`], `storage:${remote.name}`)
    }
  }, [reconnectRequiredRemotes])

  const fetchRemotes = (options?: { silent?: boolean }) =>
    dataActions.fetchRemotes({ silent: options?.silent, demoRemotes: isDemoMode && demoState ? demoState.remotes : undefined })

  const fetchUnifiedItems = (nextRemotes?: RemoteSummary[] | null, options?: { silent?: boolean }) =>
    dataActions.fetchUnifiedItems({
      silent: options?.silent,
      demoItems: isDemoMode && demoState ? demoState.items : undefined,
      remotesOverride: nextRemotes === undefined ? undefined : nextRemotes,
    })

  const refreshLibrary = async (options?: { silent?: boolean }) => {
    const nextRemotes = await fetchRemotes(options)
    await fetchUnifiedItems(nextRemotes, options)
  }

  useEffect(() => {
    if (isDemoMode) {
      return
    }

    void initializeLibrary()
  }, [isDemoMode])

  const handleDownloadProgress = useCallback(
    (payload: DownloadProgressEvent) => {
      setDownloadStates((current) => applyDownloadProgressEvent(current, payload))
    },
    [],
  )

  const handleUploadProgress = useCallback(
    (payload: UploadProgressEvent) => {
      setUploadStates((current) => applyUploadProgressEvent(current, payload))
      if (payload.status === 'failed' && payload.remoteName) {
        void fetchRemotes({ silent: true })
      }
    },
    [fetchRemotes],
  )

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
    [dataDispatch, fetchRemotes, recordIssueMessages],
  )

  useTransferProgressListeners({
    isDemoMode,
    onDownloadProgress: handleDownloadProgress,
    onUploadProgress: handleUploadProgress,
  })

  useLibraryProgressListener({
    isDemoMode,
    getActiveRequestId: () => activeLibraryRequestIdRef.current,
    onProgress: handleLibraryProgress,
  })

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
  }, [activeModal, isDemoMode])

  const initializeLibrary = async () => {
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
  }

  useEffect(() => {
    if (pendingSession?.status !== 'requires_drive_selection') {
      setSelectedDriveId('')
      return
    }

    const preferred =
      pendingSession.driveCandidates?.find((candidate) => candidate.isSuggested && candidate.isReachable) ??
      pendingSession.driveCandidates?.find((candidate) => candidate.isReachable) ??
      pendingSession.driveCandidates?.[0]

    setSelectedDriveId(preferred?.id ?? '')
  }, [pendingSession])

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
  }, [hasPendingUploadRefresh, isStartingUpload, refreshLibrary, showToast, uploadSummary.active, uploadSummary.completed, uploadSummary.failed])

  const openAddModal = () => {
    setActiveModal('add-storage')
  }

  const openUploadModal = () => {
    setUploadError('')
    setActiveModal('upload')
  }

  const closeUploadModal = () => {
    setActiveModal('none')
    setIsUploadDragActive(false)
    if (!isPreparingUpload) {
      setPreparingUploadItems([])
    }
  }

  const closeAddModal = () => {
    setActiveModal('none')
  }

  const fetchAuthSession = async (name: string) => {
    if (isDemoMode) {
      return null
    }

    return invoke<AuthSessionRecord | null>('get_auth_session_status', { name })
  }

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const upsertOptimisticConnectedRemote = (remoteName: string, provider: string) => {
    setRemotes((current) => {
      const nextRemote: RemoteSummary = {
        name: remoteName,
        provider,
        status: 'connected',
        message: undefined,
      }

      const existingIndex = current.findIndex((entry) => entry.name === remoteName)

      if (existingIndex === -1) {
        return [...current, nextRemote].sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()))
      }

      const next = [...current]
      next[existingIndex] = nextRemote
      return next
    })
  }

  const synchronizeConnectedRemote = async (remoteName: string, provider: string) => {
    upsertOptimisticConnectedRemote(remoteName, provider)

    for (let attempt = 1; attempt <= CONNECT_SYNC_ATTEMPTS; attempt += 1) {
      const latestRemotes = await fetchRemotes({ silent: true })
      const matchedRemote = latestRemotes?.find((entry) => entry.name === remoteName) ?? null

      console.info('[connect-sync]', {
        remoteName,
        provider,
        attempt,
        matchedRemoteStatus: matchedRemote?.status ?? null,
      })

      if (matchedRemote?.status === 'connected') {
        await fetchUnifiedItems(latestRemotes, { silent: true })
        return
      }

      if (attempt < CONNECT_SYNC_ATTEMPTS) {
        await sleep(CONNECT_SYNC_DELAY_MS)
      }
    }

    await refreshLibrary({ silent: true })
  }

  const {
    createRemote,
    handleReconnect,
    checkPendingSession,
    handlePendingDone,
    handleFinalizeDriveSelection,
    handlePendingRemoveAndReconnect,
  } = useRemoteAuthFlow({
    isDemoMode,
    pendingSession,
    selectedDriveId,
    setPendingSession,
    setActiveModal,
    setSelectedDriveId,
    setIsFinalizingDrive,
    fetchRemotes,
    fetchAuthSession,
    refreshLibrary,
    synchronizeConnectedRemote,
    emptyPendingMessage: EMPTY_PENDING_MESSAGE,
    connectSuccessMessage: CONNECT_SUCCESS_MESSAGE,
  })

  usePendingSessionPolling({
    activeModal,
    pendingSession,
    onTick: checkPendingSession,
  })

  const handleDeleteRemote = async () => {
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
  }


  const openRemoveModal = (remote: RemoteSummary) => {
    setRemoveTarget(remote)
    setRemoveError('')
    setActiveModal('remove-confirm')
  }

  const handleDownload = async (item: UnifiedItem) => {
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
  }

  const resetUploadBatch = () => {
    setUploadBatch(null)
    setPreparingUploadItems([])
    setUploadStates({})
    setUploadError('')
    setIsPreparingUpload(false)
    setIsStartingUpload(false)
    setIsUploadDragActive(false)
    setHasPendingUploadRefresh(false)
  }

  const prepareUploadSelections = async (selections: UploadSelection[]) => {
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
  }

  const handleChooseUploadFiles = async () => {
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
  }

  const handleChooseUploadFolder = async () => {
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
  }

  const handleStartUpload = async () => {
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
  }

  const canStartUpload =
    !!uploadBatch &&
    uploadBatch.items.length > 0 &&
    hasReadyUploads &&
    uploadSummary.active === 0 &&
    !isPreparingUpload &&
    !isStartingUpload

  const handleOpen = async (item: UnifiedItem) => {
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
  }

  const closePendingModal = () => {
    setActiveModal('none')
    setSelectedDriveId('')
  }

  const hasConnectedStorage = displayedRemotes.length > 0
  const shouldShowNoStorageState = !isLoadingRemotes && !listError && !hasConnectedStorage
  const shouldShowCategoryEmptyState =
    hasConnectedStorage && !isLoadingItems && !isLibraryStreaming && !itemsError && displayedItems.length === 0
  const shouldShowLoadingList =
    hasConnectedStorage &&
    !itemsError &&
    unifiedItems.length === 0 &&
    (isLoadingItems || isLibraryStreaming || isRefreshingItems)
  const shouldShowStreamingTail = (isLibraryStreaming || isRefreshingItems) && unifiedItems.length > 0 && !itemsError
  const emptyListTitle = searchQuery ? `No files match "${searchQuery.trim()}".` : `No files in ${currentViewLabel} yet.`
  const emptyListDescription = searchQuery
    ? 'Try a different search or switch to another view.'
    : 'Files added to this view will appear here.'

  return (
    <>
      {isStartupSplashVisible ? (
        <div
          className={`startup-splash ${isStartupSplashExiting ? 'exiting' : 'visible'}`}
          aria-hidden="true"
        >
          <div className="startup-splash-brand">
            <img className="startup-splash-lockup" src={splashLockup} alt="" />
          </div>
        </div>
      ) : null}

      <WorkspaceShell>
        <StorageSidebar
          navItems={PRIMARY_NAV_ITEMS}
          onAddStorage={openAddModal}
          displayedRemotes={displayedRemotes}
          getProviderLabel={getProviderLabel}
          onReconnect={handleReconnect}
          onRemove={openRemoveModal}
        />

        <LibraryShell
          topbar={
            <LibraryTopbar
              sortMenuRef={sortMenuRef}
              sortOptions={SORT_OPTIONS}
              sortLabel={getSortLabel(sortKey)}
              onSelectSortKey={(key) => {
                setSortKey(key)
                setIsSortMenuOpen(false)
              }}
              onOpenIssues={() => openIssuesModal()}
              onOpenUpload={openUploadModal}
              hasConnectedStorage={hasConnectedStorage}
            />
          }
        >
          <LibraryMain
            activeView={activeView}
            itemsError={itemsError}
            shouldShowNoStorageState={shouldShowNoStorageState}
            shouldShowLoadingList={shouldShowLoadingList}
            shouldShowCategoryEmptyState={shouldShowCategoryEmptyState}
            shouldShowStreamingTail={shouldShowStreamingTail}
            emptyListTitle={emptyListTitle}
            emptyListDescription={emptyListDescription}
            hasConnectedStorage={hasConnectedStorage}
            displayedItems={displayedItems}
            groupedRecentItems={groupedRecentItems}
            getDownloadState={(itemId) => downloadStates[itemId] ?? IDLE_DOWNLOAD_STATE}
            getOpenState={(itemId) => openStates[itemId] ?? IDLE_OPEN_STATE}
            onOpen={handleOpen}
            onDownload={handleDownload}
            onOpenAddStorage={openAddModal}
            onOpenUpload={openUploadModal}
          />
        </LibraryShell>

      {visibleToasts.length > 0 ? (
        <ToastStack>
          {visibleToasts.map((toast) => (
            <ToastNoticeRow
              key={toast.id}
              kind={toast.kind}
              message={toast.message}
              timestampLabel={formatIssueTimestamp(toast.timestamp)}
              action={
                toast.action ? (
                  <Button
                    family="secondary"
                    size="sm"
                    className="toast-action"
                    type="button"
                    onClick={() => {
                      const action = toast.action

                      if (!action) {
                        return
                      }

                      if (action.type === 'open-upload') {
                        openUploadModal()
                        return
                      }

                      if (action.type === 'open-path') {
                        void openPath(action.path)
                        return
                      }

                      openIssuesModal(action.issueId)
                    }}
                  >
                    {toast.actionLabel}
                  </Button>
                ) : null
              }
            />
          ))}
        </ToastStack>
      ) : null}

      <WorkspaceModals
        previewPayload={previewPayload}
        onClosePreview={() => setPreviewPayload(null)}
        isIssuesModalOpen={isIssuesModalOpen}
        workspaceIssues={workspaceIssues}
        focusedIssueId={focusedIssueId}
        onReportIssue={() => setIsFeedbackPromptOpen(true)}
        onCloseIssues={() => {
          setIsIssuesModalOpen(false)
          setFocusedIssueId(null)
        }}
        formatIssueTimestamp={formatIssueTimestamp}
        describeIssueSource={describeIssueSource}
        describeIssueLocation={describeIssueLocation}
        isFeedbackPromptOpen={isFeedbackPromptOpen}
        isExportingDiagnostics={isExportingDiagnostics}
        isOpeningFeedbackForm={isOpeningFeedbackForm}
        onCloseFeedback={() => setIsFeedbackPromptOpen(false)}
        onContinueFeedback={() => {
          void startFeedbackFlow()
        }}
        activeModal={activeModal}
        providers={STORAGE_PROVIDERS}
        onCloseAddStorage={closeAddModal}
        onCreateRemote={createRemote}
        pendingSession={pendingSession}
        pendingHasCallbackStartupFailure={pendingHasCallbackStartupFailure}
        pendingIsFinalizing={pendingIsFinalizing}
        selectedDriveId={selectedDriveId}
        isFinalizingDrive={isFinalizingDrive}
        onSelectDrive={setSelectedDriveId}
        onClosePending={closePendingModal}
        onPendingRemoveAndReconnect={() => void handlePendingRemoveAndReconnect()}
        onFinalizeDriveSelection={() => void handleFinalizeDriveSelection()}
        onPendingDone={handlePendingDone}
        emptyPendingMessage={EMPTY_PENDING_MESSAGE}
        removeTarget={removeTarget}
        removeError={removeError}
        isRemoving={isRemoving}
        getProviderLabel={getProviderLabel}
        onCloseRemoveConfirm={() => setActiveModal('none')}
        onDeleteRemote={() => void handleDeleteRemote()}
        isUploadDragActive={isUploadDragActive}
        isPreparingUpload={isPreparingUpload}
        isStartingUpload={isStartingUpload}
        uploadBatch={uploadBatch}
        uploadError={uploadError}
        shouldShowPreparingUploadList={shouldShowPreparingUploadList}
        preparingUploadItems={preparingUploadItems}
        uploadListItems={uploadListItems}
        hasUploadItems={hasUploadItems}
        canStartUpload={canStartUpload}
        onCloseUpload={closeUploadModal}
        onChooseUploadFiles={() => void handleChooseUploadFiles()}
        onChooseUploadFolder={() => void handleChooseUploadFolder()}
        onResetUploadBatch={resetUploadBatch}
        onStartUpload={() => void handleStartUpload()}
      />
      </WorkspaceShell>
    </>
  )
}

function getProviderLabel(provider: string): string {
  switch (provider) {
    case 'onedrive':
      return 'OneDrive'
    case 'gdrive':
      return 'Google Drive'
    case 'dropbox':
      return 'Dropbox'
    case 'icloud':
      return 'iCloud Drive'
    default:
      return provider
  }
}

function normalizeDialogSelection(selection: string | string[] | null): string[] {
  if (!selection) {
    return []
  }

  return Array.isArray(selection) ? selection : [selection]
}

function toUploadSelections(paths: string[], kind: UploadSelection['kind'] = 'file'): UploadSelection[] {
  return paths.map((path) => ({ path, kind }))
}

function getUploadSelectionDisplayName(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/, '')

  if (!normalizedPath) {
    return path
  }

  const segments = normalizedPath.split('/')
  return segments[segments.length - 1] || normalizedPath
}

export default App
