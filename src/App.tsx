import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  isCallbackStartupFailure,
  selectPreferredDriveId,
  type AuthSessionRecord,
  type RemoteSummary,
} from './features/storage/pendingState'
import { getDemoLibraryState, type DemoLibraryState } from './features/storage/demoLibrary'
import {
  applyDownloadProgressEvent,
  type DownloadProgressEvent,
} from './features/storage/downloads'
import {
  applyUploadProgressEvent,
  type UploadProgressEvent,
} from './features/storage/uploads'
import { LibraryAreaContainer } from './components/workspace/LibraryAreaContainer'
import { SidebarContainer } from './components/workspace/SidebarContainer'
import { StartupSplashOverlay, WorkspaceToastDock } from './components/workspace/WorkspaceChrome'
import { WorkspaceShell } from './components/workspace/WorkspaceShell'
import { WorkspaceModalsContainer } from './components/modals/WorkspaceModalsContainer'
import { useStartupSplash } from './features/storage/hooks/useStartupSplash'
import { usePendingSessionPolling } from './features/storage/hooks/usePendingSessionPolling'
import { useTransferProgressListeners } from './features/storage/hooks/useTransferProgressListeners'
import { useRemoteAuthFlow } from './features/storage/hooks/useRemoteAuthFlow'
import { useWorkspaceIssueActions } from './features/storage/hooks/useWorkspaceIssueActions'
import { useWorkspaceLibrarySync } from './features/storage/hooks/useWorkspaceLibrarySync'
import { useWorkspaceAppBindings } from './features/storage/hooks/useWorkspaceAppBindings'
import { useFileTransferActions } from './features/storage/hooks/useFileTransferActions'
import {
  CONNECT_SUCCESS_MESSAGE,
  EMPTY_PENDING_MESSAGE,
  STARTUP_SPLASH_FADE_MS,
  STARTUP_SPLASH_VISIBLE_MS,
} from './features/storage/workspaceAppConstants'
import { isScreenshotDemoEnabled } from './features/storage/demoEnv'
import { formatIssueTimestamp } from './features/storage/issuePresentation'
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
    dataActions,
    dataDispatch,
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

  const isStartupSplashVisible = ui.isStartupSplashVisible
  const isStartupSplashExiting = ui.isStartupSplashExiting
  const activeModal = ui.activeModal

  const remotes = data.remotes
  const toastNotices = data.toastNotices
  const pendingSession = data.pendingSession
  const selectedDriveId = data.selectedDriveId
  const removeTarget = data.removeTarget

  const pendingHasCallbackStartupFailure = pendingSession ? isCallbackStartupFailure(pendingSession.errorCode) : false
  const pendingIsFinalizing = pendingSession?.stage === 'finalizing'
  const visibleToasts = toastNotices

  const { recordIssueMessages, recordIssueError } = dataActions

  // issue/toast logic lives in WorkspaceDataContext

  const { openIssuesModal } = useWorkspaceIssueActions({
    remotes,
    markIssuesRead: dataActions.markIssuesRead,
    recordIssueMessages,
    setFocusedIssueId,
    setIsIssuesModalOpen,
  })

  useStartupSplash({
    visibleMs: STARTUP_SPLASH_VISIBLE_MS,
    fadeMs: STARTUP_SPLASH_FADE_MS,
    onStartExit: () => setIsStartupSplashExiting(true),
    onHide: () => setIsStartupSplashVisible(false),
  })

  const { fetchRemotes, refreshLibrary, synchronizeConnectedRemote } = useWorkspaceLibrarySync({
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
    setSelectedDriveId(selectPreferredDriveId(pendingSession))
  }, [pendingSession, setSelectedDriveId])

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

  return (
    <>
      <StartupSplashOverlay
        visible={isStartupSplashVisible}
        exiting={isStartupSplashExiting}
        lockupSrc={splashLockup}
      />

      <WorkspaceShell>
        <SidebarContainer
          onAddStorage={openAddModal}
          onReconnect={handleReconnect}
          onRemove={openRemoveModal}
        />
        <LibraryAreaContainer onOpenUpload={openUploadModal} onOpenAddStorage={openAddModal} onOpen={handleOpen} onDownload={handleDownload} />

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
