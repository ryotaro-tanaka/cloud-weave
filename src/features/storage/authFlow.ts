import type { AuthSessionStage, PendingMode, PendingSession } from './pendingState'

type PendingResultLike = {
  remoteName: string
  provider: PendingSession['provider']
  status: PendingSession['status']
  stage?: AuthSessionStage | null
  nextStep: PendingSession['nextStep']
  message: string
  errorCode?: string | null
  driveCandidates?: PendingSession['driveCandidates']
}

export function toPendingSession(result: PendingResultLike, mode: PendingMode, nowMs: number): PendingSession {
  return {
    remoteName: result.remoteName,
    provider: result.provider,
    mode,
    status: result.status,
    stage:
      result.stage ??
      (result.status === 'connected'
        ? 'connected'
        : result.status === 'requires_drive_selection'
          ? 'requires_drive_selection'
          : result.status === 'error'
            ? 'failed'
            : 'pending_auth'),
    nextStep: result.nextStep,
    message: result.message,
    errorCode: result.errorCode ?? undefined,
    operationStartedAtMs: nowMs,
    lastUpdatedAtMs: nowMs,
    driveCandidates: result.driveCandidates ?? undefined,
  }
}

