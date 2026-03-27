export type PendingMode = 'create' | 'reconnect'

export type OneDriveDriveCandidate = {
  id: string
  label: string
  driveType: string
  isReachable: boolean
  isSystemLike: boolean
  isSuggested: boolean
  message?: string | null
}

export type RemoteSummary = {
  name: string
  provider: string
  status: 'connected' | 'error'
  message?: string | null
}

export type AuthSessionStage = 'pending_auth' | 'finalizing' | 'connected' | 'requires_drive_selection' | 'failed'

export type AuthSessionRecord = {
  remoteName: string
  provider: string
  mode: PendingMode
  status: 'connected' | 'pending' | 'requires_drive_selection' | 'error'
  stage?: AuthSessionStage | null
  nextStep: 'done' | 'open_browser' | 'retry' | 'rename' | 'select_drive'
  message: string
  errorCode?: string | null
  updatedAtMs?: number | null
  driveCandidates?: OneDriveDriveCandidate[] | null
}

export type PendingSession = {
  remoteName: string
  provider: string
  mode: PendingMode
  status: 'connected' | 'pending' | 'requires_drive_selection' | 'error'
  stage: AuthSessionStage
  nextStep: string
  message: string
  errorCode?: string | null
  operationStartedAtMs: number
  lastUpdatedAtMs: number
  driveCandidates?: OneDriveDriveCandidate[] | null
}

export type PendingResolutionPhase = {
  status: PendingSession['status']
  stage: AuthSessionStage
  nextStep: PendingSession['nextStep']
  message: string
  errorCode?: string | null
  driveCandidates?: OneDriveDriveCandidate[] | null
}

const FAILURE_BARRIER_MS = 2000
const CONNECT_SUCCESS_MESSAGE = 'Your storage is connected and ready to use.'
const FINALIZING_MESSAGE = 'Cloud Weave is still finishing this storage connection.'
export const AUTH_CALLBACK_UNAVAILABLE_CODE = 'auth_callback_unavailable'

export function isCallbackStartupFailure(errorCode?: string | null): boolean {
  return errorCode === AUTH_CALLBACK_UNAVAILABLE_CODE
}

export function inferStageFromStatus(status: AuthSessionRecord['status']): AuthSessionStage {
  switch (status) {
    case 'connected':
      return 'connected'
    case 'requires_drive_selection':
      return 'requires_drive_selection'
    case 'error':
      return 'failed'
    default:
      return 'pending_auth'
  }
}

function sessionPhase(session: AuthSessionRecord): PendingResolutionPhase {
  return {
    status: session.status,
    stage: session.stage ?? inferStageFromStatus(session.status),
    nextStep: session.nextStep,
    message: session.message,
    ...(session.errorCode ? { errorCode: session.errorCode } : {}),
    driveCandidates: session.driveCandidates ?? undefined,
  }
}

export function resolvePendingPhase(
  currentPending: PendingSession,
  latestRemotes: RemoteSummary[] | null,
  session: AuthSessionRecord | null,
  nowMs = Date.now(),
): PendingResolutionPhase {
  const remote = latestRemotes?.find((entry) => entry.name === currentPending.remoteName) ?? null

  if (session?.status === 'connected') {
    return {
      ...sessionPhase(session),
      status: 'connected',
      stage: 'connected',
      nextStep: 'done',
      message: session.message || CONNECT_SUCCESS_MESSAGE,
      errorCode: undefined,
      driveCandidates: undefined,
    }
  }

  if (session?.status === 'pending' && (session.stage ?? inferStageFromStatus(session.status)) === 'finalizing') {
    return sessionPhase(session)
  }

  if (remote?.status === 'connected') {
    return {
      status: currentPending.stage === 'finalizing' ? 'pending' : 'connected',
      stage: currentPending.stage === 'finalizing' ? 'finalizing' : 'connected',
      nextStep: currentPending.stage === 'finalizing' ? currentPending.nextStep : 'done',
      message:
        currentPending.stage === 'finalizing'
          ? currentPending.message || FINALIZING_MESSAGE
          : CONNECT_SUCCESS_MESSAGE,
      errorCode: undefined,
      driveCandidates: undefined,
    }
  }

  if (session?.status === 'requires_drive_selection') {
    return sessionPhase(session)
  }

  if (session?.status === 'error') {
    return sessionPhase(session)
  }

  if (session?.status === 'pending') {
    return sessionPhase(session)
  }

  if (remote?.status === 'error') {
    if (nowMs - currentPending.operationStartedAtMs < FAILURE_BARRIER_MS) {
      return {
        status: 'pending',
        stage: currentPending.stage === 'connected' ? 'finalizing' : currentPending.stage,
        nextStep: currentPending.nextStep,
        message: currentPending.message || FINALIZING_MESSAGE,
        ...(currentPending.errorCode ? { errorCode: currentPending.errorCode } : {}),
        driveCandidates: currentPending.driveCandidates,
      }
    }

    return {
      status: 'error',
      stage: 'failed',
      nextStep: 'retry',
      message: remote.message ?? 'This storage connection is incomplete. Try again.',
      errorCode: undefined,
      driveCandidates: undefined,
    }
  }

  return {
    status: currentPending.status,
    stage: currentPending.stage,
    nextStep: currentPending.nextStep,
    message: currentPending.message,
    ...(currentPending.errorCode ? { errorCode: currentPending.errorCode } : {}),
    driveCandidates: currentPending.driveCandidates,
  }
}

export function materializePendingSession(
  currentPending: PendingSession,
  phase: PendingResolutionPhase,
  session: AuthSessionRecord | null,
): PendingSession {
  return {
    remoteName: session?.remoteName ?? currentPending.remoteName,
    provider: session?.provider ?? currentPending.provider,
    mode: session?.mode ?? currentPending.mode,
    status: phase.status,
    stage: phase.stage,
    nextStep: phase.nextStep,
    message: phase.message,
    ...(phase.errorCode ? { errorCode: phase.errorCode } : {}),
    operationStartedAtMs: currentPending.operationStartedAtMs,
    lastUpdatedAtMs: session?.updatedAtMs ?? currentPending.lastUpdatedAtMs,
    driveCandidates: phase.driveCandidates ?? undefined,
  }
}

export function resolvePendingSession(
  currentPending: PendingSession,
  latestRemotes: RemoteSummary[] | null,
  session: AuthSessionRecord | null,
  nowMs = Date.now(),
): PendingSession {
  const phase = resolvePendingPhase(currentPending, latestRemotes, session, nowMs)
  return materializePendingSession(currentPending, phase, session)
}

export function overlayPendingRemote(remotes: RemoteSummary[], pendingSession: PendingSession | null): RemoteSummary[] {
  if (!pendingSession || pendingSession.stage === 'failed' || pendingSession.stage === 'pending_auth') {
    return remotes
  }

  const overlay: RemoteSummary = {
    name: pendingSession.remoteName,
    provider: pendingSession.provider,
    status: 'connected',
    message: pendingSession.stage === 'connected' ? undefined : pendingSession.message || FINALIZING_MESSAGE,
  }

  const existingIndex = remotes.findIndex((entry) => entry.name === pendingSession.remoteName)

  if (existingIndex === -1) {
    return [...remotes, overlay].sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()))
  }

  const next = [...remotes]
  next[existingIndex] = {
    ...next[existingIndex],
    status: overlay.status,
    message: overlay.message,
  }
  return next
}
