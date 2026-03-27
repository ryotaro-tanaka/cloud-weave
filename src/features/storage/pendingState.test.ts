import { describe, expect, it } from 'vitest'
import {
  AUTH_CALLBACK_UNAVAILABLE_CODE,
  inferStageFromStatus,
  isCallbackStartupFailure,
  materializePendingSession,
  overlayPendingRemote,
  resolvePendingPhase,
  resolvePendingSession,
  type AuthSessionRecord,
  type PendingResolutionPhase,
  type PendingSession,
  type RemoteSummary,
} from './pendingState'

const basePending: PendingSession = {
  remoteName: 'onedrive-main',
  provider: 'onedrive',
  mode: 'create',
  status: 'pending',
  stage: 'pending_auth',
  nextStep: 'open_browser',
  message: 'Complete authentication in your browser.',
  operationStartedAtMs: 1_000,
  lastUpdatedAtMs: 1_000,
}

describe('resolvePendingPhase', () => {
  it('prefers a connected remote over a stale pending session', () => {
    const remotes: RemoteSummary[] = [{ name: 'onedrive-main', provider: 'onedrive', status: 'connected' }]
    const session: AuthSessionRecord = {
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'pending',
      stage: 'pending_auth',
      nextStep: 'open_browser',
      message: 'Authentication is still in progress in your browser.',
      updatedAtMs: 1_100,
    }

    expect(resolvePendingPhase(basePending, remotes, session)).toEqual({
      status: 'connected',
      stage: 'connected',
      nextStep: 'done',
      message: 'Your storage is connected and ready to use.',
      driveCandidates: undefined,
    })
  })

  it('prefers a connected session over a transient remote error', () => {
    const remotes: RemoteSummary[] = [
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'error',
        message: 'This OneDrive connection is incomplete. Reconnect it or remove it and connect again.',
      },
    ]
    const session: AuthSessionRecord = {
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'connected',
      stage: 'connected',
      nextStep: 'done',
      message: 'Your storage is connected and ready to use.',
      updatedAtMs: 1_100,
    }

    expect(resolvePendingPhase(basePending, remotes, session)).toEqual({
      status: 'connected',
      stage: 'connected',
      nextStep: 'done',
      message: 'Your storage is connected and ready to use.',
      driveCandidates: undefined,
    })
  })

  it('prefers drive selection over the remote error placeholder', () => {
    const remotes: RemoteSummary[] = [
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'error',
        message: 'This OneDrive connection is incomplete. Reconnect it or remove it and connect again.',
      },
    ]
    const session: AuthSessionRecord = {
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'requires_drive_selection',
      stage: 'requires_drive_selection',
      nextStep: 'select_drive',
      message: 'Choose a drive.',
      updatedAtMs: 1_100,
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

    expect(resolvePendingPhase(basePending, remotes, session)).toEqual({
      status: 'requires_drive_selection',
      stage: 'requires_drive_selection',
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

  it('prefers the latest session error over the remote error placeholder', () => {
    const remotes: RemoteSummary[] = [
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'error',
        message: 'This OneDrive connection is incomplete. Reconnect it or remove it and connect again.',
      },
    ]
    const session: AuthSessionRecord = {
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'error',
      stage: 'failed',
      nextStep: 'retry',
      message: 'failed to query Microsoft Graph drives: HTTP 403',
      errorCode: 'graph_query_failed',
      updatedAtMs: 1_100,
    }

    expect(resolvePendingPhase(basePending, remotes, session)).toEqual({
      status: 'error',
      stage: 'failed',
      nextStep: 'retry',
      message: 'failed to query Microsoft Graph drives: HTTP 403',
      driveCandidates: undefined,
    })
  })

  it('keeps waiting when a remote error appears during the failure barrier window', () => {
    const remotes: RemoteSummary[] = [
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'error',
        message: 'This OneDrive connection is incomplete. Reconnect it or remove it and connect again.',
      },
    ]

    expect(resolvePendingPhase(basePending, remotes, null, 2_500)).toEqual({
      status: 'pending',
      stage: 'pending_auth',
      nextStep: 'open_browser',
      message: 'Complete authentication in your browser.',
      driveCandidates: undefined,
    })
  })

  it('fails after the barrier window when only remote error remains', () => {
    const remotes: RemoteSummary[] = [
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'error',
        message: 'This OneDrive connection is incomplete. Reconnect it or remove it and connect again.',
      },
    ]

    expect(resolvePendingPhase(basePending, remotes, null, 3_500)).toEqual({
      status: 'error',
      stage: 'failed',
      nextStep: 'retry',
      message: 'This OneDrive connection is incomplete. Reconnect it or remove it and connect again.',
      driveCandidates: undefined,
    })
  })
})

describe('materializePendingSession', () => {
  it('preserves metadata while applying a connected phase', () => {
    const session: AuthSessionRecord = {
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'connected',
      stage: 'connected',
      nextStep: 'done',
      message: 'Your storage is connected and ready to use.',
      updatedAtMs: 1_100,
    }
    const phase: PendingResolutionPhase = {
      status: 'connected',
      stage: 'connected',
      nextStep: 'done',
      message: 'Your storage is connected and ready to use.',
      driveCandidates: undefined,
    }

    expect(materializePendingSession(basePending, phase, session)).toEqual({
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'create',
      status: 'connected',
      stage: 'connected',
      nextStep: 'done',
      message: 'Your storage is connected and ready to use.',
      operationStartedAtMs: 1_000,
      lastUpdatedAtMs: 1_100,
      driveCandidates: undefined,
    })
  })

  it('uses the current pending metadata when no session exists', () => {
    const phase: PendingResolutionPhase = {
      status: 'error',
      stage: 'failed',
      nextStep: 'retry',
      message: 'This OneDrive connection is incomplete. Reconnect it or remove it and connect again.',
      driveCandidates: undefined,
    }

    expect(materializePendingSession(basePending, phase, null)).toEqual({
      ...basePending,
      status: 'error',
      stage: 'failed',
      nextStep: 'retry',
      message: 'This OneDrive connection is incomplete. Reconnect it or remove it and connect again.',
      driveCandidates: undefined,
    })
  })
})

describe('resolvePendingSession', () => {
  it('combines phase resolution with metadata materialization', () => {
    const session: AuthSessionRecord = {
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'reconnect',
      status: 'error',
      stage: 'failed',
      nextStep: 'retry',
      message: 'Authentication was not completed.',
      errorCode: AUTH_CALLBACK_UNAVAILABLE_CODE,
      updatedAtMs: 1_100,
    }

    expect(resolvePendingSession(basePending, [], session)).toEqual({
      remoteName: 'onedrive-main',
      provider: 'onedrive',
      mode: 'reconnect',
      status: 'error',
      stage: 'failed',
      nextStep: 'retry',
      message: 'Authentication was not completed.',
      errorCode: AUTH_CALLBACK_UNAVAILABLE_CODE,
      operationStartedAtMs: 1_000,
      lastUpdatedAtMs: 1_100,
      driveCandidates: undefined,
    })
  })
})

describe('overlayPendingRemote', () => {
  it('does not overlay a pending_auth session', () => {
    const remotes: RemoteSummary[] = [
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'error',
        message: 'This OneDrive connection is incomplete. Reconnect it or remove it and connect again.',
      },
    ]

    expect(overlayPendingRemote(remotes, basePending)).toEqual(remotes)
  })

  it('overlays a finalizing session on top of an errored remote row', () => {
    const remotes: RemoteSummary[] = [
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'error',
        message: 'This OneDrive connection is incomplete. Reconnect it or remove it and connect again.',
      },
    ]
    const finalizingPending: PendingSession = {
      ...basePending,
      stage: 'finalizing',
      message: 'Cloud Weave is finalizing this OneDrive connection.',
    }

    expect(overlayPendingRemote(remotes, finalizingPending)).toEqual([
      {
        name: 'onedrive-main',
        provider: 'onedrive',
        status: 'connected',
        message: 'Cloud Weave is finalizing this OneDrive connection.',
      },
    ])
  })
})

describe('inferStageFromStatus', () => {
  it('maps fallback stages from session status', () => {
    expect(inferStageFromStatus('pending')).toBe('pending_auth')
    expect(inferStageFromStatus('connected')).toBe('connected')
    expect(inferStageFromStatus('requires_drive_selection')).toBe('requires_drive_selection')
    expect(inferStageFromStatus('error')).toBe('failed')
  })
})

describe('isCallbackStartupFailure', () => {
  it('detects the dedicated callback bind failure code', () => {
    expect(isCallbackStartupFailure(AUTH_CALLBACK_UNAVAILABLE_CODE)).toBe(true)
    expect(isCallbackStartupFailure('graph_query_failed')).toBe(false)
    expect(isCallbackStartupFailure(undefined)).toBe(false)
  })
})
