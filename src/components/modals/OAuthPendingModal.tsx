import type { OneDriveDriveCandidate, PendingSession } from '../../features/storage/pendingState'
import { Button } from '../ui/Button'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalOverlay } from '../ui/ModalOverlay'
import { ModalSurface } from '../ui/ModalSurface'
import { Spinner } from '../ui/Spinner'

type OAuthPendingModalProps = {
  pendingSession: PendingSession
  pendingHasCallbackStartupFailure: boolean
  pendingIsFinalizing: boolean
  selectedDriveId: string
  isFinalizingDrive: boolean
  onSelectDrive: (driveId: string) => void
  onClose: () => void
  onRemoveAndReconnect: () => void
  onFinalizeDriveSelection: () => void
  onDone: () => void
  emptyPendingMessage: string
}

function getDriveHelp(candidate: OneDriveDriveCandidate): string {
  if (!candidate.isReachable) {
    return candidate.message ?? 'This library could not be opened.'
  }
  return candidate.isSystemLike
    ? 'This looks like a system-style library. Choose it only if it is the one you expect.'
    : 'This library is reachable and ready to use.'
}

export function OAuthPendingModal({
  pendingSession,
  pendingHasCallbackStartupFailure,
  pendingIsFinalizing,
  selectedDriveId,
  isFinalizingDrive,
  onSelectDrive,
  onClose,
  onRemoveAndReconnect,
  onFinalizeDriveSelection,
  onDone,
  emptyPendingMessage,
}: OAuthPendingModalProps) {
  return (
    <ModalOverlay onRequestClose={onClose}>
      <ModalSurface surfaceClassName="full-modal pending-modal" labelledBy="pending-title">
        <ModalHeader
          eyebrow={pendingSession.provider}
          titleId="pending-title"
          title={
            pendingSession.status === 'connected'
              ? 'Storage connected'
              : pendingSession.status === 'requires_drive_selection'
                ? 'Choose your OneDrive'
                : pendingSession.status === 'error'
                  ? pendingHasCallbackStartupFailure
                    ? 'Sign-in could not start'
                    : 'Reconnect failed'
                  : pendingIsFinalizing
                    ? 'Finishing your OneDrive connection'
                    : 'Complete authentication in your browser'
          }
          onClose={onClose}
          closeAriaLabel="Close modal"
        />

        <div className="pending-body">
          <p className="pending-remote">{pendingSession.remoteName}</p>
          <p>{pendingSession.message || emptyPendingMessage}</p>

          {pendingSession.status === 'pending' ? (
            <div className="pending-indicator">
              <Spinner />
              <p>{pendingIsFinalizing ? 'Finishing setup...' : 'Checking for completion...'}</p>
            </div>
          ) : null}

          {pendingSession.status === 'pending' ? (
            <p className="pending-help">
              {pendingIsFinalizing
                ? 'Cloud Weave already has your sign-in token and is finishing the OneDrive setup. You do not need to return to the browser.'
                : 'Finish the Microsoft sign-in flow in your browser, then return here.'}
            </p>
          ) : null}

          {pendingSession.status === 'requires_drive_selection' ? (
            <div className="drive-picker">
              <p className="pending-help">
                Cloud Weave found more than one OneDrive library for this account. Choose the one you want to browse.
              </p>

              <div className="drive-candidate-list" role="list" aria-label="OneDrive libraries">
                {pendingSession.driveCandidates?.map((candidate) => {
                  const isSelected = candidate.id === selectedDriveId
                  return (
                    <label
                      key={`${candidate.id}-${candidate.label}`}
                      className={`drive-candidate ${isSelected ? 'selected' : ''} ${candidate.isReachable ? '' : 'disabled'}`}
                    >
                      <input
                        type="radio"
                        name="drive-candidate"
                        value={candidate.id}
                        checked={isSelected}
                        disabled={!candidate.isReachable}
                        onChange={() => onSelectDrive(candidate.id)}
                      />
                      <div className="drive-candidate-copy">
                        <div className="drive-candidate-title">
                          <span>{candidate.label}</span>
                          <div className="drive-candidate-badges">
                            <span className="source-badge">{candidate.driveType}</span>
                            {candidate.isSuggested ? <span className="source-badge suggested-badge">Recommended</span> : null}
                          </div>
                        </div>
                        <p className="drive-candidate-id">{candidate.id}</p>
                        <p className="drive-candidate-help">{getDriveHelp(candidate)}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          ) : null}

          {pendingSession.status === 'error' ? (
            <p className="pending-help">
              {pendingHasCallbackStartupFailure
                ? 'Cloud Weave could not open its local sign-in callback. Another stalled sign-in may still be running. Close this message and try again.'
                : 'This storage could not be reconnected. Remove it and connect again to keep using it.'}
            </p>
          ) : null}

          {pendingSession.status === 'connected' ? (
            <p className="pending-help">This storage now appears in the connected list and unified library.</p>
          ) : null}
        </div>

        <div className="modal-actions">
          {pendingSession.status === 'error' ? (
            !pendingHasCallbackStartupFailure ? (
              <Button family="primary" type="button" onClick={onRemoveAndReconnect}>
                Remove and connect again
              </Button>
            ) : null
          ) : pendingSession.status === 'requires_drive_selection' ? (
            <>
              <Button family="secondary" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button family="secondary" type="button" onClick={onRemoveAndReconnect}>
                Remove and start over
              </Button>
              <Button family="primary" type="button" onClick={onFinalizeDriveSelection} disabled={!selectedDriveId || isFinalizingDrive}>
                {isFinalizingDrive ? 'Connecting...' : 'Use this drive'}
              </Button>
            </>
          ) : pendingSession.status === 'connected' ? (
            <Button family="primary" type="button" onClick={onDone}>
              Done
            </Button>
          ) : null}
        </div>
      </ModalSurface>
    </ModalOverlay>
  )
}

