import { describe, expect, it } from 'vitest'
import { resolvePendingSession, type AuthSessionRecord, type PendingSession, type RemoteSummary } from './pendingState'

const basePending: PendingSession = {
  remoteName: 'onedrive-main',
  provider: 'onedrive',
  mode: 'create',
  status: 'pending',
  nextStep: 'open_browser',
  message: 'Complete authentication in your browser.',
}

describe('resolvePendingSession', () => {
  it('prefers a discovered remote over a stale pending session', () => {
    const remotes: RemoteSummary[] = [{ name: 'onedrive-main', provider: 'onedrive', status: 'connected' }]
    const session: AuthSessionRecord = {
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'pending',
      nextStep: 'open_browser',
      message: 'Authentication is still in progress in your browser.',
    }

    expect(resolvePendingSession(basePending, remotes, session)).toEqual({
      ...basePending,
      status: 'connected',
      nextStep: 'done',
      message: 'Your storage is connected and ready to use.',
    })
  })

  it('uses the latest auth session when the remote is not listed yet', () => {
    const session: AuthSessionRecord = {
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'reconnect',
      status: 'error',
      nextStep: 'retry',
      message: 'Authentication was not completed.',
    }

    expect(resolvePendingSession(basePending, [], session)).toEqual({
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'reconnect',
      status: 'error',
      nextStep: 'retry',
      message: 'Authentication was not completed.',
    })
  })

  it('keeps the current pending state when nothing new is available', () => {
    expect(resolvePendingSession(basePending, null, null)).toEqual(basePending)
  })
})
