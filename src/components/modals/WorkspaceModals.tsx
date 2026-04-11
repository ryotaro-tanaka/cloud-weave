import type { PreviewPayload } from '../../features/storage/openFiles'
import type { PendingSession, RemoteSummary } from '../../features/storage/pendingState'
import type { PreparedUploadBatch, UploadState } from '../../features/storage/uploads'
import type { CreateRemoteInput, ProviderDefinition } from './AddStorageModal'
import type { PreparingUploadItem } from '../../state/transfers/TransfersContext'
import type { WorkspaceIssue } from '../../state/workspaceData/WorkspaceDataContext'
import { AddStorageModal } from './AddStorageModal'
import { FeedbackPromptModal } from './FeedbackPromptModal'
import { IssuesModal } from './IssuesModal'
import { OAuthPendingModal } from './OAuthPendingModal'
import { PreviewModal } from './PreviewModal'
import { RemoveStorageConfirmModal } from './RemoveStorageConfirmModal'
import { UploadModal } from './UploadModal'

type UploadListRow = {
  item: PreparedUploadBatch['items'][number]
  state: UploadState
}

type WorkspaceModalsProps = {
  previewPayload: PreviewPayload | null
  onClosePreview: () => void

  isIssuesModalOpen: boolean
  workspaceIssues: WorkspaceIssue[]
  focusedIssueId: string | null
  onReportIssue: () => void
  onCloseIssues: () => void
  formatIssueTimestamp: (timestamp: number) => string
  describeIssueSource: (source: string) => string
  describeIssueLocation: (source: string) => string

  isFeedbackPromptOpen: boolean
  isExportingDiagnostics: boolean
  isOpeningFeedbackForm: boolean
  onCloseFeedback: () => void
  onContinueFeedback: () => void

  activeModal: 'none' | 'add-storage' | 'oauth-pending' | 'remove-confirm' | 'upload'
  providers: ProviderDefinition[]
  onCloseAddStorage: () => void
  onCreateRemote: (input: CreateRemoteInput) => Promise<void>

  pendingSession: PendingSession | null
  pendingHasCallbackStartupFailure: boolean
  pendingIsFinalizing: boolean
  selectedDriveId: string
  isFinalizingDrive: boolean
  onSelectDrive: (driveId: string) => void
  onClosePending: () => void
  onPendingRemoveAndReconnect: () => void
  onFinalizeDriveSelection: () => void
  onPendingDone: () => void
  emptyPendingMessage: string

  removeTarget: RemoteSummary | null
  removeError: string
  isRemoving: boolean
  getProviderLabel: (provider: string) => string
  onCloseRemoveConfirm: () => void
  onDeleteRemote: () => void

  isUploadDragActive: boolean
  isPreparingUpload: boolean
  isStartingUpload: boolean
  uploadBatch: PreparedUploadBatch | null
  uploadError: string
  shouldShowPreparingUploadList: boolean
  preparingUploadItems: PreparingUploadItem[]
  uploadListItems: UploadListRow[]
  hasUploadItems: boolean
  canStartUpload: boolean
  onCloseUpload: () => void
  onChooseUploadFiles: () => void
  onChooseUploadFolder: () => void
  onResetUploadBatch: () => void
  onStartUpload: () => void
}

export function WorkspaceModals({
  previewPayload,
  onClosePreview,
  isIssuesModalOpen,
  workspaceIssues,
  focusedIssueId,
  onReportIssue,
  onCloseIssues,
  formatIssueTimestamp,
  describeIssueSource,
  describeIssueLocation,
  isFeedbackPromptOpen,
  isExportingDiagnostics,
  isOpeningFeedbackForm,
  onCloseFeedback,
  onContinueFeedback,
  activeModal,
  providers,
  onCloseAddStorage,
  onCreateRemote,
  pendingSession,
  pendingHasCallbackStartupFailure,
  pendingIsFinalizing,
  selectedDriveId,
  isFinalizingDrive,
  onSelectDrive,
  onClosePending,
  onPendingRemoveAndReconnect,
  onFinalizeDriveSelection,
  onPendingDone,
  emptyPendingMessage,
  removeTarget,
  removeError,
  isRemoving,
  getProviderLabel,
  onCloseRemoveConfirm,
  onDeleteRemote,
  isUploadDragActive,
  isPreparingUpload,
  isStartingUpload,
  uploadBatch,
  uploadError,
  shouldShowPreparingUploadList,
  preparingUploadItems,
  uploadListItems,
  hasUploadItems,
  canStartUpload,
  onCloseUpload,
  onChooseUploadFiles,
  onChooseUploadFolder,
  onResetUploadBatch,
  onStartUpload,
}: WorkspaceModalsProps) {
  return (
    <>
      {previewPayload ? <PreviewModal payload={previewPayload} onClose={onClosePreview} /> : null}

      {isIssuesModalOpen ? (
        <IssuesModal
          issues={workspaceIssues}
          focusedIssueId={focusedIssueId}
          onReportIssue={onReportIssue}
          onClose={onCloseIssues}
          formatIssueTimestamp={formatIssueTimestamp}
          describeIssueSource={describeIssueSource}
          describeIssueLocation={describeIssueLocation}
        />
      ) : null}

      {isFeedbackPromptOpen ? (
        <FeedbackPromptModal
          isExportingDiagnostics={isExportingDiagnostics}
          isOpeningFeedbackForm={isOpeningFeedbackForm}
          onClose={onCloseFeedback}
          onContinue={onContinueFeedback}
        />
      ) : null}

      {activeModal === 'add-storage' ? (
        <AddStorageModal providers={providers} onClose={onCloseAddStorage} onCreateRemote={onCreateRemote} />
      ) : null}

      {activeModal === 'oauth-pending' && pendingSession ? (
        <OAuthPendingModal
          pendingSession={pendingSession}
          pendingHasCallbackStartupFailure={pendingHasCallbackStartupFailure}
          pendingIsFinalizing={pendingIsFinalizing}
          selectedDriveId={selectedDriveId}
          isFinalizingDrive={isFinalizingDrive}
          onSelectDrive={onSelectDrive}
          onClose={onClosePending}
          onRemoveAndReconnect={onPendingRemoveAndReconnect}
          onFinalizeDriveSelection={onFinalizeDriveSelection}
          onDone={onPendingDone}
          emptyPendingMessage={emptyPendingMessage}
        />
      ) : null}

      {activeModal === 'remove-confirm' && removeTarget ? (
        <RemoveStorageConfirmModal
          removeTarget={removeTarget}
          removeError={removeError}
          isRemoving={isRemoving}
          getProviderLabel={getProviderLabel}
          onClose={onCloseRemoveConfirm}
          onConfirm={onDeleteRemote}
        />
      ) : null}

      {activeModal === 'upload' ? (
        <UploadModal
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
          onClose={onCloseUpload}
          onChooseFiles={onChooseUploadFiles}
          onChooseFolder={onChooseUploadFolder}
          onResetUploadBatch={onResetUploadBatch}
          onStartUpload={onStartUpload}
        />
      ) : null}
    </>
  )
}

