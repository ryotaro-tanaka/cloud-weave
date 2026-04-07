import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toPendingSession } from '../authFlow'
import { resolvePendingSession, type AuthSessionRecord, type AuthSessionStage, type OneDriveDriveCandidate, type PendingMode, type PendingSession, type RemoteSummary } from '../pendingState'
import type { CreateRemoteInput } from '../../../components/modals/AddStorageModal'

type CreateRemoteResult = {
  remoteName: string
  provider: string
  status: 'connected' | 'pending' | 'requires_drive_selection' | 'error'
  stage?: AuthSessionStage | null
  nextStep: 'done' | 'open_browser' | 'retry' | 'rename' | 'select_drive'
  message: string
  errorCode?: string | null
  driveCandidates?: OneDriveDriveCandidate[] | null
}

type ActionResult = { status: 'success' | 'error'; message: string }

type UseRemoteAuthFlowInput = {
  isDemoMode: boolean
  pendingSession: PendingSession | null
  selectedDriveId: string
  setPendingSession: (pending: PendingSession | null) => void
  setActiveModal: (modal: 'none' | 'add-storage' | 'oauth-pending' | 'remove-confirm' | 'upload') => void
  setSelectedDriveId: (driveId: string) => void
  setIsFinalizingDrive: (finalizing: boolean) => void
  fetchRemotes: (options?: { silent?: boolean }) => Promise<RemoteSummary[] | null>
  fetchAuthSession: (remoteName: string) => Promise<AuthSessionRecord | null>
  refreshLibrary: (options?: { silent?: boolean }) => Promise<void>
  synchronizeConnectedRemote: (remoteName: string, provider: string) => Promise<void>
  emptyPendingMessage: string
  connectSuccessMessage: string
}

export function useRemoteAuthFlow(input: UseRemoteAuthFlowInput) {
  const {
    isDemoMode,
    pendingSession,
    selectedDriveId,
    setPendingSession,
    setActiveModal,
    setSelectedDriveId,
    setIsFinalizingDrive,
    fetchRemotes,
    fetchAuthSession,
    refreshLibrary,
    synchronizeConnectedRemote,
    emptyPendingMessage,
    connectSuccessMessage,
  } = input

  const handlePendingConnected = useCallback(
    async (session: PendingSession) => {
      setPendingSession({
        ...session,
        status: 'connected',
        nextStep: 'done',
        message: session.message || connectSuccessMessage,
        errorCode: undefined,
        driveCandidates: undefined,
      })
      await synchronizeConnectedRemote(session.remoteName, session.provider)
    },
    [connectSuccessMessage, setPendingSession, synchronizeConnectedRemote],
  )

  const checkPendingSession = useCallback(async () => {
    if (!pendingSession) {
      return null
    }
    try {
      const [latestRemotes, session] = await Promise.all([
        fetchRemotes({ silent: true }),
        fetchAuthSession(pendingSession.remoteName),
      ])
      const nextPending = resolvePendingSession(pendingSession, latestRemotes, session, Date.now())
      setPendingSession(nextPending)
      if (nextPending.status === 'connected') {
        await handlePendingConnected(nextPending)
      }
      return nextPending
    } catch (error) {
      const failedPending = {
        ...pendingSession,
        status: 'error' as const,
        stage: 'failed' as AuthSessionStage,
        nextStep: 'retry',
        message: error instanceof Error ? error.message : String(error),
        errorCode: undefined,
        lastUpdatedAtMs: Date.now(),
      }
      setPendingSession(failedPending)
      return failedPending
    }
  }, [fetchAuthSession, fetchRemotes, handlePendingConnected, pendingSession, setPendingSession])

  const moveToPendingModal = useCallback(
    (result: CreateRemoteResult, mode: PendingMode) => {
      const nowMs = Date.now()
      setPendingSession(toPendingSession({ ...result, message: result.message || emptyPendingMessage }, mode, nowMs))
      setActiveModal('oauth-pending')
    },
    [emptyPendingMessage, setActiveModal, setPendingSession],
  )

  const createRemote = useCallback(async (inputValue: CreateRemoteInput) => {
    if (isDemoMode) return
    if (inputValue.provider !== 'onedrive') {
      throw new Error('Only OneDrive is supported right now.')
    }
    const result = await invoke<CreateRemoteResult>('create_onedrive_remote', { input: inputValue })
    if (result.status === 'error' && result.nextStep !== 'retry') {
      throw new Error(result.message)
    }
    if (result.status === 'connected') {
      await handlePendingConnected({
        remoteName: result.remoteName,
        provider: result.provider,
        mode: 'create',
        status: result.status,
        stage: 'connected',
        nextStep: result.nextStep,
        message: result.message || connectSuccessMessage,
        errorCode: result.errorCode ?? undefined,
        operationStartedAtMs: Date.now(),
        lastUpdatedAtMs: Date.now(),
        driveCandidates: result.driveCandidates ?? undefined,
      })
      setActiveModal('none')
      return
    }
    moveToPendingModal(result, 'create')
    await fetchRemotes({ silent: true })
  }, [connectSuccessMessage, fetchRemotes, handlePendingConnected, isDemoMode, moveToPendingModal, setActiveModal])

  const handleReconnect = useCallback(async (remote: RemoteSummary) => {
    if (isDemoMode) return
    try {
      const result = await invoke<CreateRemoteResult>('reconnect_remote', { name: remote.name })
      if (result.status === 'connected') {
        await handlePendingConnected({
          remoteName: result.remoteName,
          provider: result.provider,
          mode: 'reconnect',
          status: result.status,
          stage: 'connected',
          nextStep: result.nextStep,
          message: result.message || connectSuccessMessage,
          errorCode: result.errorCode ?? undefined,
          operationStartedAtMs: Date.now(),
          lastUpdatedAtMs: Date.now(),
          driveCandidates: result.driveCandidates ?? undefined,
        })
        return
      }
      moveToPendingModal(result, 'reconnect')
      await fetchRemotes({ silent: true })
    } catch (error) {
      setPendingSession({
        remoteName: remote.name,
        provider: remote.provider,
        mode: 'reconnect',
        status: 'error',
        stage: 'failed',
        nextStep: 'retry',
        message: error instanceof Error ? error.message : String(error),
        errorCode: undefined,
        operationStartedAtMs: Date.now(),
        lastUpdatedAtMs: Date.now(),
      })
      setActiveModal('oauth-pending')
    }
  }, [connectSuccessMessage, fetchRemotes, handlePendingConnected, isDemoMode, moveToPendingModal, setActiveModal, setPendingSession])

  const handlePendingDone = useCallback(() => {
    setActiveModal('none')
    setPendingSession(null)
    setSelectedDriveId('')
  }, [setActiveModal, setPendingSession, setSelectedDriveId])

  const handleFinalizeDriveSelection = useCallback(async () => {
    if (isDemoMode || !pendingSession || pendingSession.status !== 'requires_drive_selection' || !selectedDriveId) return
    setIsFinalizingDrive(true)
    try {
      const result = await invoke<CreateRemoteResult>('finalize_onedrive_remote', {
        name: pendingSession.remoteName,
        driveId: selectedDriveId,
      })
      setPendingSession({
        remoteName: result.remoteName,
        provider: result.provider,
        mode: pendingSession.mode,
        status: result.status,
        stage:
          result.stage ??
          (result.status === 'connected'
            ? 'connected'
            : result.status === 'requires_drive_selection'
              ? 'requires_drive_selection'
              : result.status === 'error'
                ? 'failed'
                : 'finalizing'),
        nextStep: result.nextStep,
        message: result.message,
        errorCode: result.errorCode ?? undefined,
        operationStartedAtMs: pendingSession.operationStartedAtMs,
        lastUpdatedAtMs: Date.now(),
        driveCandidates: result.driveCandidates ?? undefined,
      })
      if (result.status === 'connected') {
        await refreshLibrary({ silent: true })
      }
    } catch (error) {
      setPendingSession({
        ...pendingSession,
        status: 'error',
        stage: 'failed',
        nextStep: 'retry',
        message: error instanceof Error ? error.message : String(error),
        errorCode: undefined,
        lastUpdatedAtMs: Date.now(),
      })
    } finally {
      setIsFinalizingDrive(false)
    }
  }, [isDemoMode, pendingSession, refreshLibrary, selectedDriveId, setIsFinalizingDrive, setPendingSession])

  const handlePendingRemoveAndReconnect = useCallback(async () => {
    if (isDemoMode || !pendingSession) return
    try {
      await invoke<ActionResult>('delete_remote', { name: pendingSession.remoteName })
    } catch {
      // Ignore delete failures here and still guide the user back into reconnect flow.
    }
    setActiveModal('add-storage')
    await refreshLibrary({ silent: true })
  }, [isDemoMode, pendingSession, refreshLibrary, setActiveModal])

  return {
    createRemote,
    handleReconnect,
    checkPendingSession,
    handlePendingDone,
    handleFinalizeDriveSelection,
    handlePendingRemoveAndReconnect,
  }
}

