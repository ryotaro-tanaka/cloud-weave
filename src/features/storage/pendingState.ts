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

export type AuthSessionRecord = {
  remoteName: string
  provider: string
  mode: PendingMode
  status: 'connected' | 'pending' | 'requires_drive_selection' | 'error'
  nextStep: 'done' | 'open_browser' | 'retry' | 'rename' | 'select_drive'
  message: string
  driveCandidates?: OneDriveDriveCandidate[] | null
}

export type PendingSession = {
  remoteName: string
  provider: string
  mode: PendingMode
  status: 'connected' | 'pending' | 'requires_drive_selection' | 'error'
  nextStep: string
  message: string
  driveCandidates?: OneDriveDriveCandidate[] | null
}

export function resolvePendingSession(
  currentPending: PendingSession,
  latestRemotes: RemoteSummary[] | null,
  session: AuthSessionRecord | null,
): PendingSession {
  const remote = latestRemotes?.find((entry) => entry.name === currentPending.remoteName) ?? null

  if (remote?.status === 'connected') {
    return {
      ...currentPending,
      status: 'connected',
      nextStep: 'done',
      message: 'Your storage is connected and ready to use.',
      driveCandidates: undefined,
    }
  }

  if (session?.status === 'requires_drive_selection') {
    return {
      remoteName: session.remoteName,
      provider: session.provider,
      mode: session.mode,
      status: session.status,
      nextStep: session.nextStep,
      message: session.message,
      driveCandidates: session.driveCandidates ?? undefined,
    }
  }

  if (session?.status === 'error') {
    return {
      remoteName: session.remoteName,
      provider: session.provider,
      mode: session.mode,
      status: session.status,
      nextStep: session.nextStep,
      message: session.message,
      driveCandidates: session.driveCandidates ?? undefined,
    }
  }

  if (remote?.status === 'error') {
    return {
      ...currentPending,
      status: 'error',
      nextStep: 'retry',
      message: remote.message ?? 'This storage connection is incomplete. Try again.',
      driveCandidates: undefined,
    }
  }

  if (session) {
    return {
      remoteName: session.remoteName,
      provider: session.provider,
      mode: session.mode,
      status: session.status,
      nextStep: session.nextStep,
      message: session.message,
      driveCandidates: session.driveCandidates ?? undefined,
    }
  }

  return currentPending
}
