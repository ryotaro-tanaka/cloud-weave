import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isCallbackStartupFailure,
  overlayPendingRemote,
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
  getUploadBatchSummary,
  IDLE_UPLOAD_STATE,
  type UploadProgressEvent,
} from './features/storage/uploads'
import { useDismissOnOutsideOrEscape } from './components/ui/useDismissOnOutsideOrEscape'
import { LibraryMain } from './components/workspace/LibraryMain'
import { LibraryShell } from './components/workspace/LibraryShell'
import { LibraryTopbar } from './components/workspace/LibraryTopbar'
import { StorageSidebar } from './components/workspace/StorageSidebar'
import { StartupSplashOverlay, WorkspaceToastDock } from './components/workspace/WorkspaceChrome'
import { WorkspaceShell } from './components/workspace/WorkspaceShell'
import { WorkspaceModals } from './components/modals/WorkspaceModals'
import { useStartupSplash } from './features/storage/hooks/useStartupSplash'
import { usePendingSessionPolling } from './features/storage/hooks/usePendingSessionPolling'
import { useTransferProgressListeners } from './features/storage/hooks/useTransferProgressListeners'
import { useRemoteAuthFlow } from './features/storage/hooks/useRemoteAuthFlow'
import { useWorkspaceAppBindings } from './features/storage/hooks/useWorkspaceAppBindings'
import { useDiagnosticsFeedbackFlow } from './features/storage/hooks/useDiagnosticsFeedbackFlow'
import { useRemoteConnectSync } from './features/storage/hooks/useRemoteConnectSync'
import { useLibraryBootstrap } from './features/storage/hooks/useLibraryBootstrap'
import { useUploadWorkspaceFlow } from './features/storage/hooks/useUploadWorkspaceFlow'
import { useFileTransferActions } from './features/storage/hooks/useFileTransferActions'
import {
  CONNECT_SUCCESS_MESSAGE,
  EMPTY_PENDING_MESSAGE,
  PRIMARY_NAV_ITEMS,
  SORT_OPTIONS,
  STARTUP_SPLASH_FADE_MS,
  STARTUP_SPLASH_VISIBLE_MS,
  STORAGE_PROVIDERS,
} from './features/storage/workspaceAppConstants'
import { getDefaultSortKey, isScreenshotDemoEnabled } from './features/storage/demoEnv'
import { getSortLabel } from './features/storage/sortLabels'
import { describeIssueLocation, describeIssueSource, formatIssueTimestamp } from './features/storage/issuePresentation'
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
    setIsFeedbackPromptOpen,
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
    setUploadBatch,
    setPreparingUploadItems,
    setUploadError,
    setIsPreparingUpload,
    setIsStartingUpload,
    setIsUploadDragActive,
    setHasPendingUploadRefresh,
  } = useWorkspaceAppBindings()

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
  const focusedIssue = useMemo(
    () => (focusedIssueId ? workspaceIssues.find((issue) => issue.id === focusedIssueId) ?? null : null),
    [focusedIssueId, workspaceIssues],
  )

  const { showToast, markIssuesRead, recordIssueMessages, recordIssueError } = dataActions

  const { startFeedbackFlow, isExportingDiagnostics, isOpeningFeedbackForm } = useDiagnosticsFeedbackFlow({
    activeView,
    workspaceIssues,
    focusedIssue,
    showToast,
    setIsFeedbackPromptOpen,
  })

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

  const { handleChooseUploadFiles, handleChooseUploadFolder, handleStartUpload, resetUploadBatch } = useUploadWorkspaceFlow({
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
  })

  const { handleDownload, handleOpen, handleDeleteRemote } = useFileTransferActions({
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

  const canStartUpload =
    !!uploadBatch &&
    uploadBatch.items.length > 0 &&
    hasReadyUploads &&
    uploadSummary.active === 0 &&
    !isPreparingUpload &&
    !isStartingUpload

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

      <WorkspaceModals
        previewPayload={previewPayload}
        onClosePreview={() => setPreviewPayload(null)}
        isIssuesModalOpen={isIssuesModalOpen}
        workspaceIssues={workspaceIssues}
        focusedIssueId={focusedIssueId}
        onReportIssue={() => setIsFeedbackPromptOpen(true)}
        onCloseIssues={() => setIsIssuesModalOpen(false)}
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

export default App
