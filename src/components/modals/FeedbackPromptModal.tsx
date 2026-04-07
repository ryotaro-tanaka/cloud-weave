import { Button } from '../ui/Button'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalOverlay } from '../ui/ModalOverlay'
import { ModalSurface } from '../ui/ModalSurface'

type FeedbackPromptModalProps = {
  isExportingDiagnostics: boolean
  isOpeningFeedbackForm: boolean
  onClose: () => void
  onContinue: () => void
}

export function FeedbackPromptModal({
  isExportingDiagnostics,
  isOpeningFeedbackForm,
  onClose,
  onContinue,
}: FeedbackPromptModalProps) {
  const isContinuing = isExportingDiagnostics || isOpeningFeedbackForm
  const continueLabel = isExportingDiagnostics
    ? 'Preparing diagnostics...'
    : isOpeningFeedbackForm
      ? 'Opening form...'
      : 'Continue'

  return (
    <ModalOverlay onRequestClose={onClose}>
      <ModalSurface surfaceClassName="confirm-modal feedback-prompt-modal" labelledBy="feedback-prompt-title">
        <ModalHeader
          eyebrow="Feedback"
          titleId="feedback-prompt-title"
          title="Send feedback"
          onClose={onClose}
          closeAriaLabel="Close feedback prompt"
        />

        <div className="feedback-prompt-copy">
          <p>Cloud Weave will save a diagnostics ZIP to your Downloads folder.</p>
          <p>You will attach that ZIP in the feedback form next.</p>
          <p>The feedback form will open in your browser after the ZIP is prepared.</p>
          <p>Do not include personal or sensitive information.</p>
        </div>

        <div className="modal-actions">
          <Button family="quiet" type="button" onClick={onClose} disabled={isContinuing}>
            Cancel
          </Button>
          <Button family="primary" type="button" onClick={onContinue} disabled={isContinuing}>
            {continueLabel}
          </Button>
        </div>
      </ModalSurface>
    </ModalOverlay>
  )
}

