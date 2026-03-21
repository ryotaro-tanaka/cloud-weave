export type PendingMode = 'create' | 'reconnect'

export type RemoteSummary = {
  name: string
  provider: string
  status: string
}

export type AuthSessionRecord = {
  remoteName: string
  provider: string
  mode: PendingMode
  status: 'connected' | 'pending' | 'error'
  nextStep: 'done' | 'open_browser' | 'retry' | 'rename'
  message: string
}

export type PendingSession = {
  remoteName: string
  provider: string
  mode: PendingMode
  status: 'connected' | 'pending' | 'error'
  nextStep: string
  message: string
}

export function resolvePendingSession(
  currentPending: PendingSession,
  latestRemotes: RemoteSummary[] | null,
  session: AuthSessionRecord | null,
): PendingSession {
  const remoteAppeared = latestRemotes?.some((remote) => remote.name === currentPending.remoteName) ?? false

  if (remoteAppeared) {
    return {
      ...currentPending,
      status: 'connected',
      nextStep: 'done',
      message: 'Your storage is connected and ready to use.',
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
    }
  }

  return currentPending
}
