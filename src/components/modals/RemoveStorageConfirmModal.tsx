import type { RemoteSummary } from '../../features/storage/pendingState'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/InlineError'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalOverlay } from '../ui/ModalOverlay'
import { ModalSurface } from '../ui/ModalSurface'

type RemoveStorageConfirmModalProps = {
  removeTarget: RemoteSummary
  removeError: string
  isRemoving: boolean
  getProviderLabel: (provider: string) => string
  onClose: () => void
  onConfirm: () => void
}

export function RemoveStorageConfirmModal({
  removeTarget,
  removeError,
  isRemoving,
  getProviderLabel,
  onClose,
  onConfirm,
}: RemoveStorageConfirmModalProps) {
  return (
    <ModalOverlay onRequestClose={onClose}>
      <ModalSurface surfaceClassName="confirm-modal" labelledBy="remove-title">
        <ModalHeader
          eyebrow="Remove Storage"
          titleId="remove-title"
          title={`Remove ${removeTarget.name}?`}
          onClose={onClose}
          closeAriaLabel="Close modal"
        />

        <div className="confirm-copy">
          <p>This removes the saved connection from Cloud Weave.</p>
          <p className="confirm-provider">{getProviderLabel(removeTarget.provider)}</p>
          {removeError ? <InlineError>{removeError}</InlineError> : null}
        </div>

        <div className="modal-actions">
          <Button family="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button family="primary" tone="danger" type="button" onClick={onConfirm} disabled={isRemoving}>
            {isRemoving ? 'Removing...' : 'Remove'}
          </Button>
        </div>
      </ModalSurface>
    </ModalOverlay>
  )
}

