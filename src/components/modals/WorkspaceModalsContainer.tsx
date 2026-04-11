import { useMemo } from 'react'
import { useDiagnosticsFeedbackFlow } from '../../features/storage/hooks/useDiagnosticsFeedbackFlow'
import { useFileTransferActions } from '../../features/storage/hooks/useFileTransferActions'
import { useUploadWorkspaceFlow } from '../../features/storage/hooks/useUploadWorkspaceFlow'
import { EMPTY_PENDING_MESSAGE, STORAGE_PROVIDERS } from '../../features/storage/workspaceAppConstants'
import { describeIssueLocation, describeIssueSource, formatIssueTimestamp } from '../../features/storage/issuePresentation'
import { getProviderLabel } from '../../features/storage/providerLabels'
import { getUploadBatchSummary, IDLE_UPLOAD_STATE } from '../../features/storage/uploads'
import { useWorkspaceAppBindings } from '../../features/storage/hooks/useWorkspaceAppBindings'
import { WorkspaceModals } from './WorkspaceModals'
import type { CreateRemoteInput } from './AddStorageModal'

type Props = {
  isDemoMode: boolean
  refreshLibrary: (options?: { silent?: boolean }) => Promise<void>
  onCreateRemote: (input: CreateRemoteInput) => Promise<void>
  onPendingRemoveAndReconnect: () => void
  onFinalizeDriveSelection: () => void
  onPendingDone: () => void
  pendingHasCallbackStartupFailure: boolean
  pendingIsFinalizing: boolean
}

/**
 * Feature container for the modal area (Feature Container layer).
 * Keeps `App.tsx` as composer by moving modal-only derived state and wiring here.
 */
export function WorkspaceModalsContainer({
  isDemoMode,
  refreshLibrary,
  onCreateRemote,
  onPendingRemoveAndReconnect,
  onFinalizeDriveSelection,
  onPendingDone,
  pendingHasCallbackStartupFailure,
  pendingIsFinalizing,
}: Props) {
  const {
    ui,
    data,
    transfers,
    dataActions,
    setActiveModal,
    setPreviewPayload,
    setIsIssuesModalOpen,
    setIsFeedbackPromptOpen,
    setSelectedDriveId,
    setUploadError,
    setIsUploadDragActive,
    setPreparingUploadItems,
    setIsPreparingUpload,
    setUploadBatch,
    setUploadStates,
    setIsStartingUpload,
    setHasPendingUploadRefresh,
    setDownloadStates,
    setOpenStates,
    setRemoveTarget,
    setRemoveError,
    setIsRemoving,
  } = useWorkspaceAppBindings()

  const { showToast } = dataActions

  const activeView = ui.activeView
  const activeModal = ui.activeModal
  const previewPayload = ui.previewPayload
  const isIssuesModalOpen = ui.isIssuesModalOpen
  const focusedIssueId = ui.focusedIssueId
  const isFeedbackPromptOpen = ui.isFeedbackPromptOpen

  const pendingSession = data.pendingSession
  const selectedDriveId = data.selectedDriveId
  const isFinalizingDrive = data.isFinalizingDrive
  const removeTarget = data.removeTarget
  const removeError = data.removeError
  const isRemoving = data.isRemoving
  const workspaceIssues = data.workspaceIssues

  const uploadStates = transfers.uploadStates
  const uploadBatch = transfers.uploadBatch
  const preparingUploadItems = transfers.preparingUploadItems
  const uploadError = transfers.uploadError
  const isPreparingUpload = transfers.isPreparingUpload
  const isStartingUpload = transfers.isStartingUpload
  const isUploadDragActive = transfers.isUploadDragActive
  const hasPendingUploadRefresh = transfers.hasPendingUploadRefresh

  const focusedIssue = useMemo(
    () => (focusedIssueId ? workspaceIssues.find((issue) => issue.id === focusedIssueId) ?? null : null),
    [focusedIssueId, workspaceIssues],
  )

  const { startFeedbackFlow, isExportingDiagnostics, isOpeningFeedbackForm } = useDiagnosticsFeedbackFlow({
    activeView,
    workspaceIssues,
    focusedIssue,
    showToast,
    setIsFeedbackPromptOpen,
  })

  const { handleDeleteRemote } = useFileTransferActions({
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

  const uploadSummary = useMemo(() => getUploadBatchSummary(uploadBatch?.items ?? [], uploadStates), [uploadBatch, uploadStates])
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

  const closeUploadModal = () => {
    setActiveModal('none')
    setIsUploadDragActive(false)
    if (!isPreparingUpload) {
      setPreparingUploadItems([])
    }
  }

  const { handleChooseUploadFiles, handleChooseUploadFolder, handleStartUpload, resetUploadBatch } = useUploadWorkspaceFlow({
    isDemoMode,
    activeModal,
    uploadBatch,
    uploadStates,
    hasPendingUploadRefresh,
    isStartingUpload,
    showToast,
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

  return (
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
      onCloseAddStorage={() => setActiveModal('none')}
      onCreateRemote={onCreateRemote}
      pendingSession={pendingSession}
      pendingHasCallbackStartupFailure={pendingHasCallbackStartupFailure}
      pendingIsFinalizing={pendingIsFinalizing}
      selectedDriveId={selectedDriveId}
      isFinalizingDrive={isFinalizingDrive}
      onSelectDrive={setSelectedDriveId}
      onClosePending={closePendingModal}
      onPendingRemoveAndReconnect={onPendingRemoveAndReconnect}
      onFinalizeDriveSelection={onFinalizeDriveSelection}
      onPendingDone={onPendingDone}
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
  )
}

