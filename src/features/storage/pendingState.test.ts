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
      driveCandidates: undefined,
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
      driveCandidates: undefined,
    })
  })

  it('treats a discovered but incomplete remote as an error', () => {
    const remotes: RemoteSummary[] = [
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'error',
        message: 'Cloud Weave could not finish setting up this OneDrive connection.',
      },
    ]

    expect(resolvePendingSession(basePending, remotes, null)).toEqual({
      ...basePending,
      status: 'error',
      nextStep: 'retry',
      message: 'Cloud Weave could not finish setting up this OneDrive connection.',
      driveCandidates: undefined,
    })
  })

  it('treats a reconnect-required remote as an error that can be retried', () => {
    const remotes: RemoteSummary[] = [
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'reconnect_required',
        message: 'Authentication expired for this storage. Reconnect it to keep browsing and uploading.',
      },
    ]

    expect(resolvePendingSession(basePending, remotes, null)).toEqual({
      ...basePending,
      status: 'error',
      nextStep: 'retry',
      message: 'Authentication expired for this storage. Reconnect it to keep browsing and uploading.',
      driveCandidates: undefined,
    })
  })

  it('preserves drive candidates when the auth session requires drive selection', () => {
    const session: AuthSessionRecord = {
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'requires_drive_selection',
      nextStep: 'select_drive',
      message: 'Choose a drive.',
      driveCandidates: [
        {
          id: 'drive-1',
          label: 'OneDrive',
          driveType: 'personal',
          isReachable: true,
          isSystemLike: false,
          isSuggested: true,
        },
      ],
    }

    expect(resolvePendingSession(basePending, [], session)).toEqual({
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'requires_drive_selection',
      nextStep: 'select_drive',
      message: 'Choose a drive.',
      driveCandidates: [
        {
          id: 'drive-1',
          label: 'OneDrive',
          driveType: 'personal',
          isReachable: true,
          isSystemLike: false,
          isSuggested: true,
        },
      ],
    })
  })

  it('prefers drive selection over the remote error placeholder', () => {
    const remotes: RemoteSummary[] = [
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'error',
        message: 'Cloud Weave could not finish setting up this OneDrive connection.',
      },
    ]
    const session: AuthSessionRecord = {
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'requires_drive_selection',
      nextStep: 'select_drive',
      message: 'Choose a drive.',
      driveCandidates: [
        {
          id: 'drive-1',
          label: 'OneDrive',
          driveType: 'personal',
          isReachable: true,
          isSystemLike: false,
          isSuggested: true,
        },
      ],
    }

    expect(resolvePendingSession(basePending, remotes, session)).toEqual({
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'requires_drive_selection',
      nextStep: 'select_drive',
      message: 'Choose a drive.',
      driveCandidates: [
        {
          id: 'drive-1',
          label: 'OneDrive',
          driveType: 'personal',
          isReachable: true,
          isSystemLike: false,
          isSuggested: true,
        },
      ],
    })
  })

  it('keeps the current pending state when nothing new is available', () => {
    expect(resolvePendingSession(basePending, null, null)).toEqual(basePending)
  })
})
