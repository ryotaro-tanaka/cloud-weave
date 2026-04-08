import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  isCallbackStartupFailure,
  overlayPendingRemote,
  type AuthSessionRecord,
  type RemoteSummary,
} from './features/storage/pendingState'
import {
  filterItemsByView,
  getCategoryLabel,
  groupRecentItems,
  searchUnifiedItems,
  sortUnifiedItems,
} from './features/storage/unifiedItems'
import { getDemoLibraryState, type DemoLibraryState } from './features/storage/demoLibrary'
import {
  applyDownloadProgressEvent,
  IDLE_DOWNLOAD_STATE,
  type DownloadProgressEvent,
} from './features/storage/downloads'
import { IDLE_OPEN_STATE } from './features/storage/openFiles'
import {
  applyUploadProgressEvent,
  type UploadProgressEvent,
} from './features/storage/uploads'
import { useDismissOnOutsideOrEscape } from './components/ui/useDismissOnOutsideOrEscape'
import { LibraryMain } from './components/workspace/LibraryMain'
import { LibraryShell } from './components/workspace/LibraryShell'
import { LibraryTopbar } from './components/workspace/LibraryTopbar'
import { StorageSidebar } from './components/workspace/StorageSidebar'
import { StartupSplashOverlay, WorkspaceToastDock } from './components/workspace/WorkspaceChrome'
import { WorkspaceShell } from './components/workspace/WorkspaceShell'
import { WorkspaceModalsContainer } from './components/modals/WorkspaceModalsContainer'
import { useStartupSplash } from './features/storage/hooks/useStartupSplash'
import { usePendingSessionPolling } from './features/storage/hooks/usePendingSessionPolling'
import { useTransferProgressListeners } from './features/storage/hooks/useTransferProgressListeners'
import { useRemoteAuthFlow } from './features/storage/hooks/useRemoteAuthFlow'
import { useWorkspaceAppBindings } from './features/storage/hooks/useWorkspaceAppBindings'
import { useRemoteConnectSync } from './features/storage/hooks/useRemoteConnectSync'
import { useLibraryBootstrap } from './features/storage/hooks/useLibraryBootstrap'
import { useFileTransferActions } from './features/storage/hooks/useFileTransferActions'
import {
  CONNECT_SUCCESS_MESSAGE,
  EMPTY_PENDING_MESSAGE,
  PRIMARY_NAV_ITEMS,
  SORT_OPTIONS,
  STARTUP_SPLASH_FADE_MS,
  STARTUP_SPLASH_VISIBLE_MS,
} from './features/storage/workspaceAppConstants'
import { getDefaultSortKey, isScreenshotDemoEnabled } from './features/storage/demoEnv'
import { getSortLabel } from './features/storage/sortLabels'
import { formatIssueTimestamp } from './features/storage/issuePresentation'
import { getProviderLabel } from './features/storage/providerLabels'
import splashLockup from '../assets/brand/cloud-weave-lockup.png'
import './App.css'
import './components/ui/toast.css'
import './components/workspace/styles/shell.css'
import './components/workspace/styles/sidebar.css'
import './components/workspace/styles/topbar.css'
import './components/workspace/styles/library-main.css'
import './components/modals/styles/modals.css'
import './components/workspace/styles/responsive.css'

function App() {
  const [demoState] = useState<DemoLibraryState | null>(() => (isScreenshotDemoEnabled() ? getDemoLibraryState() : null))
  const isDemoMode = demoState !== null
  const {
    ui,
    data,
    transfers,
    dataActions,
    dataDispatch,
    setSortKey,
    setIsSortMenuOpen,
    setOpenRowMenuItemId,
    setIsStartupSplashVisible,
    setIsStartupSplashExiting,
    setActiveModal,
    setPreviewPayload,
    setIsIssuesModalOpen,
    setFocusedIssueId,
    setRemotes,
    setUnifiedItems,
    setListError,
    setItemsError,
    setIsLoadingRemotes,
    setIsLoadingItems,
    setIsLibraryStreaming,
    setIsRefreshingItems,
    setPendingSession,
    setSelectedDriveId,
    setIsFinalizingDrive,
    setRemoveTarget,
    setRemoveError,
    setIsRemoving,
    setDownloadStates,
    setOpenStates,
    setUploadStates,
    setUploadError,
  } = useWorkspaceAppBindings()

  const activeView = ui.activeView
  const searchQuery = ui.searchQuery
  const sortKey = ui.sortKey
  const isSortMenuOpen = ui.isSortMenuOpen
  const openRowMenuItemId = ui.openRowMenuItemId
  const isStartupSplashVisible = ui.isStartupSplashVisible
  const isStartupSplashExiting = ui.isStartupSplashExiting
  const activeModal = ui.activeModal

  const remotes = data.remotes
  const unifiedItems = data.unifiedItems
  const toastNotices = data.toastNotices
  const listError = data.listError
  const itemsError = data.itemsError
  const isLoadingRemotes = data.isLoadingRemotes
  const isLoadingItems = data.isLoadingItems
  const isLibraryStreaming = data.isLibraryStreaming
  const isRefreshingItems = data.isRefreshingItems
  const pendingSession = data.pendingSession
  const selectedDriveId = data.selectedDriveId
  const removeTarget = data.removeTarget

  const downloadStates = transfers.downloadStates
  const openStates = transfers.openStates
  const sortMenuRef = useRef<HTMLDivElement | null>(null)

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

  const { markIssuesRead, recordIssueMessages, recordIssueError } = dataActions

  const groupedRecentItems = useMemo(() => {
    if (activeView !== 'recent' || sortKey !== 'updated-desc') {
      return []
    }

    return groupRecentItems(displayedItems)
  }, [activeView, displayedItems, sortKey])

  const currentViewLabel = getCategoryLabel(activeView)

  const openIssuesModal = (issueId?: string) => {
    setFocusedIssueId(issueId ?? null)
    setIsIssuesModalOpen(true)
    markIssuesRead(issueId ? [issueId] : undefined)
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

  useTransferProgressListeners({
    isDemoMode,
    onDownloadProgress: handleDownloadProgress,
    onUploadProgress: handleUploadProgress,
  })

  const { handleDownload, handleOpen } = useFileTransferActions({
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
  })

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

  const openAddModal = () => {
    setActiveModal('add-storage')
  }

  const openUploadModal = () => {
    setUploadError('')
    setActiveModal('upload')
  }

  const fetchAuthSession = async (name: string) => {
    if (isDemoMode) {
      return null
    }

    return invoke<AuthSessionRecord | null>('get_auth_session_status', { name })
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

  const openRemoveModal = (remote: RemoteSummary) => {
    setRemoveTarget(remote)
    setRemoveError('')
    setActiveModal('remove-confirm')
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
      <StartupSplashOverlay
        visible={isStartupSplashVisible}
        exiting={isStartupSplashExiting}
        lockupSrc={splashLockup}
      />

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

      <WorkspaceToastDock
        toasts={visibleToasts}
        formatIssueTimestamp={formatIssueTimestamp}
        onOpenUploadModal={openUploadModal}
        onOpenIssuesModal={(issueId) => openIssuesModal(issueId)}
      />

      <WorkspaceModalsContainer
        isDemoMode={isDemoMode}
        refreshLibrary={refreshLibrary}
        onCreateRemote={createRemote}
        onPendingRemoveAndReconnect={() => void handlePendingRemoveAndReconnect()}
        onFinalizeDriveSelection={() => void handleFinalizeDriveSelection()}
        onPendingDone={handlePendingDone}
        pendingHasCallbackStartupFailure={pendingHasCallbackStartupFailure}
        pendingIsFinalizing={pendingIsFinalizing}
      />
      </WorkspaceShell>
    </>
  )
}

export default App
