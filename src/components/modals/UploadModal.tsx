import type { PreparedUploadBatch, UploadState } from '../../features/storage/uploads'
import type { PreparingUploadItem } from '../../state/transfers/TransfersContext'
import { PreparingUploadListItem, UploadListItem } from '../library'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/InlineError'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalOverlay } from '../ui/ModalOverlay'
import { ModalSurface } from '../ui/ModalSurface'

type UploadListRow = {
  item: PreparedUploadBatch['items'][number]
  state: UploadState
}

type UploadModalProps = {
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
  onClose: () => void
  onChooseFiles: () => void
  onChooseFolder: () => void
  onResetUploadBatch: () => void
  onStartUpload: () => void
}

export function UploadModal({
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
  onClose,
  onChooseFiles,
  onChooseFolder,
  onResetUploadBatch,
  onStartUpload,
}: UploadModalProps) {
  return (
    <ModalOverlay onRequestClose={onClose}>
      <ModalSurface surfaceClassName="full-modal upload-modal" labelledBy="upload-title">
        <ModalHeader
          eyebrow="Upload"
          titleId="upload-title"
          title="Send files to Cloud Weave"
          onClose={onClose}
          closeAriaLabel="Close upload modal"
        />

        <div className="upload-body">
          <div className={`upload-dropzone ${isUploadDragActive ? 'active' : ''}`}>
            <p className="upload-dropzone-title">Drop files or folders here</p>
            <p className="upload-dropzone-copy">Browse from disk or drop files here to add them to the upload list.</p>
            <div className="upload-picker-actions">
              <Button family="primary" type="button" onClick={onChooseFiles} disabled={isPreparingUpload || isStartingUpload}>
                {isPreparingUpload ? 'Preparing...' : 'Browse files'}
              </Button>
              <Button family="secondary" type="button" onClick={onChooseFolder} disabled={isPreparingUpload || isStartingUpload}>
                {isPreparingUpload ? 'Preparing...' : 'Browse folder'}
              </Button>
            </div>
          </div>

          {uploadBatch?.notices.map((notice) => (
            <p key={notice} className="pending-help">
              {notice}
            </p>
          ))}
          {uploadError ? <InlineError>{uploadError}</InlineError> : null}

          {shouldShowPreparingUploadList ? (
            <p className="upload-preparing-summary" role="status" aria-live="polite">
              {preparingUploadItems.length} file{preparingUploadItems.length === 1 ? '' : 's'} selected
            </p>
          ) : null}

          {hasUploadItems || shouldShowPreparingUploadList ? (
            <>
              <div className="upload-list-header" aria-hidden="true">
                <span>Name</span>
                <span>Status</span>
                <span>Path</span>
                <span>Storage</span>
              </div>
              <div className="upload-queue" role="list" aria-label="Upload list">
                {uploadListItems.map(({ item, state }) => (
                  <UploadListItem key={item.itemId} item={item} state={state} />
                ))}
                {preparingUploadItems.map((item) => (
                  <PreparingUploadListItem key={item.id} item={item} />
                ))}
              </div>
            </>
          ) : null}
        </div>

        {hasUploadItems ? (
          <div className="modal-actions">
            <Button family="secondary" type="button" onClick={onResetUploadBatch} disabled={!hasUploadItems || isPreparingUpload}>
              Clear
            </Button>
            <Button family="primary" type="button" onClick={onStartUpload} disabled={!canStartUpload}>
              {isPreparingUpload ? 'Preparing...' : isStartingUpload ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        ) : null}
      </ModalSurface>
    </ModalOverlay>
  )
}

