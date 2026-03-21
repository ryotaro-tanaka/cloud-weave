import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

type StorageProvider = 'onedrive' | 'gdrive' | 'dropbox' | 'icloud'
type AuthType = 'oauth' | 'form'
type ModalName = 'none' | 'add-storage' | 'oauth-pending' | 'remove-confirm'
type AddFlowStep = 'providers' | 'form'
type PendingMode = 'create' | 'reconnect'

type RemoteSummary = {
  name: string
  provider: string
  status: string
}

type CreateOneDriveRemoteInput = {
  remoteName: string
  clientId?: string
  clientSecret?: string
}

type CreateRemoteResult = {
  remoteName: string
  provider: string
  status: 'connected' | 'pending' | 'error'
  nextStep: 'done' | 'open_browser' | 'retry' | 'rename'
  message: string
}

type AuthSessionRecord = {
  remoteName: string
  provider: string
  mode: PendingMode
  status: 'connected' | 'pending' | 'error'
  nextStep: 'done' | 'open_browser' | 'retry' | 'rename'
  message: string
}

type ActionResult = {
  status: 'success' | 'error'
  message: string
}

type ProviderDefinition = {
  id: StorageProvider
  label: string
  authType: AuthType
  enabled: boolean
  description: string
}

type PendingSession = {
  remoteName: string
  provider: string
  mode: PendingMode
  status: 'connected' | 'pending' | 'error'
  nextStep: string
  message: string
}

const STORAGE_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'onedrive',
    label: 'OneDrive',
    authType: 'oauth',
    enabled: true,
    description: 'Connect with Microsoft in your browser',
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    authType: 'oauth',
    enabled: false,
    description: 'Coming next',
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    authType: 'oauth',
    enabled: false,
    description: 'Planned after Google Drive',
  },
  {
    id: 'icloud',
    label: 'iCloud Drive',
    authType: 'form',
    enabled: false,
    description: 'Needs separate support work',
  },
]

const EMPTY_PENDING_MESSAGE = 'Complete authentication in your browser.'

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeModal, setActiveModal] = useState<ModalName>('none')
  const [addFlowStep, setAddFlowStep] = useState<AddFlowStep>('providers')
  const [selectedProvider, setSelectedProvider] = useState<StorageProvider>('onedrive')
  const [remotes, setRemotes] = useState<RemoteSummary[]>([])
  const [hoveredRemote, setHoveredRemote] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<RemoteSummary | null>(null)
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null)
  const [isLoadingRemotes, setIsLoadingRemotes] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingPending, setIsCheckingPending] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [remoteName, setRemoteName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [listError, setListError] = useState('')
  const [addError, setAddError] = useState('')
  const [removeError, setRemoveError] = useState('')

  const selectedProviderConfig = useMemo(
    () => STORAGE_PROVIDERS.find((provider) => provider.id === selectedProvider) ?? STORAGE_PROVIDERS[0],
    [selectedProvider],
  )

  const fetchRemotes = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false

    if (!silent) {
      setIsLoadingRemotes(true)
    }

    try {
      const result = await invoke<RemoteSummary[]>('list_storage_remotes')
      setRemotes(result)
      setListError('')
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setListError(message)
      return null
    } finally {
      if (!silent) {
        setIsLoadingRemotes(false)
      }
    }
  }

  useEffect(() => {
    void fetchRemotes()
  }, [])

  useEffect(() => {
    if (activeModal !== 'oauth-pending' || !pendingSession || pendingSession.status !== 'pending') {
      return
    }

    const intervalId = window.setInterval(() => {
      void checkPendingSession(true)
    }, 1500)

    return () => window.clearInterval(intervalId)
  }, [activeModal, pendingSession?.remoteName, pendingSession?.status])

  const resetAddFlow = () => {
    setAddFlowStep('providers')
    setSelectedProvider('onedrive')
    setRemoteName('')
    setClientId('')
    setClientSecret('')
    setAddError('')
  }

  const openAddModal = () => {
    resetAddFlow()
    setActiveModal('add-storage')
  }

  const closeAddModal = () => {
    setActiveModal('none')
    resetAddFlow()
  }

  const openProviderForm = (providerId: StorageProvider) => {
    setSelectedProvider(providerId)
    setAddFlowStep('form')
    setAddError('')
  }

  const fetchAuthSession = async (name: string) => {
    return invoke<AuthSessionRecord | null>('get_auth_session_status', { name })
  }

  const checkPendingSession = async (silent = false) => {
    if (!pendingSession) {
      return null
    }

    if (!silent) {
      setIsCheckingPending(true)
    }

    try {
      const [latestRemotes, session] = await Promise.all([
        fetchRemotes({ silent: true }),
        fetchAuthSession(pendingSession.remoteName),
      ])

      const remoteAppeared = latestRemotes?.some((remote) => remote.name === pendingSession.remoteName) ?? false
      let nextPending = pendingSession

      if (remoteAppeared) {
        nextPending = {
          ...pendingSession,
          status: 'connected',
          nextStep: 'done',
          message: 'Your storage is connected and ready to use.',
        }
      } else if (session) {
        nextPending = {
          remoteName: session.remoteName,
          provider: session.provider,
          mode: session.mode,
          status: session.status,
          nextStep: session.nextStep,
          message: session.message,
        }
      }

      setPendingSession(nextPending)
      return nextPending
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedPending = {
        ...pendingSession,
        status: 'error' as const,
        nextStep: 'retry',
        message,
      }
      setPendingSession(failedPending)
      return failedPending
    } finally {
      if (!silent) {
        setIsCheckingPending(false)
      }
    }
  }

  const moveToPendingModal = (result: CreateRemoteResult, mode: PendingMode) => {
    setPendingSession({
      remoteName: result.remoteName,
      provider: result.provider,
      mode,
      status: result.status,
      nextStep: result.nextStep,
      message: result.message || EMPTY_PENDING_MESSAGE,
    })
    setActiveModal('oauth-pending')
  }

  const handleCreateRemote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!remoteName.trim()) {
      setAddError('Remote name is required.')
      return
    }

    setIsSubmitting(true)
    setAddError('')

    try {
      const result = await invoke<CreateRemoteResult>('create_onedrive_remote', {
        input: {
          remoteName: remoteName.trim(),
          clientId: clientId.trim() || undefined,
          clientSecret: clientSecret.trim() || undefined,
        } satisfies CreateOneDriveRemoteInput,
      })

      if (result.status === 'error' && result.nextStep !== 'retry') {
        setAddError(result.message)
        return
      }

      moveToPendingModal(result, 'create')
      await fetchRemotes({ silent: true })
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReconnect = async (remote: RemoteSummary) => {
    try {
      const result = await invoke<CreateRemoteResult>('reconnect_remote', { name: remote.name })
      moveToPendingModal(result, 'reconnect')
      await fetchRemotes({ silent: true })
    } catch (error) {
      setPendingSession({
        remoteName: remote.name,
        provider: remote.provider,
        mode: 'reconnect',
        status: 'error',
        nextStep: 'retry',
        message: error instanceof Error ? error.message : String(error),
      })
      setActiveModal('oauth-pending')
    }
  }

  const handleDeleteRemote = async () => {
    if (!removeTarget) {
      return
    }

    setIsRemoving(true)
    setRemoveError('')

    try {
      const result = await invoke<ActionResult>('delete_remote', { name: removeTarget.name })

      if (result.status === 'error') {
        setRemoveError(result.message)
        return
      }

      setActiveModal('none')
      setRemoveTarget(null)
      await fetchRemotes({ silent: true })
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRemoving(false)
    }
  }

  const handlePendingDone = async () => {
    const latest = await checkPendingSession()

    if (latest?.status === 'connected') {
      setActiveModal('none')
      setPendingSession(null)
      resetAddFlow()
    }
  }

  const handleRetryPending = () => {
    if (!pendingSession) {
      return
    }

    setSelectedProvider((pendingSession.provider as StorageProvider) || 'onedrive')
    setAddFlowStep('form')
    setRemoteName(pendingSession.remoteName)
    setClientId('')
    setClientSecret('')
    setAddError('')
    setActiveModal('add-storage')
  }

  const openRemoveModal = (remote: RemoteSummary) => {
    setRemoveTarget(remote)
    setRemoveError('')
    setActiveModal('remove-confirm')
  }

  const closePendingModal = () => {
    setActiveModal('none')
  }

  return (
    <main className="workspace-shell">
      <aside className={`storage-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-rail">
          <button
            className="icon-button sidebar-toggle"
            onClick={() => setSidebarOpen((open) => !open)}
            type="button"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <svg className="hamburger-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 7.25h14" />
              <path d="M5 12h14" />
              <path d="M5 16.75h14" />
            </svg>
          </button>
        </div>

        {sidebarOpen ? (
          <div className="sidebar-panel">
            <div className="sidebar-topbar">
              <h2>Storage</h2>
              <button className="add-storage-button" type="button" onClick={openAddModal} aria-label="Add storage">
                +
              </button>
            </div>

            <div className="sidebar-list">
              {isLoadingRemotes ? <p className="empty-state">Loading storage...</p> : null}
              {!isLoadingRemotes && listError ? <p className="error-text">{listError}</p> : null}
              {!isLoadingRemotes && !listError && remotes.length === 0 ? (
                <p className="empty-state">No storage connected yet.</p>
              ) : null}

              {!isLoadingRemotes && !listError && remotes.length > 0 ? (
                <ul className="remote-list">
                  {remotes.map((remote) => {
                    const isHovered = hoveredRemote === remote.name

                    return (
                      <li
                        key={remote.name}
                        className={`remote-item ${isHovered ? 'hovered' : ''}`}
                        onMouseEnter={() => setHoveredRemote(remote.name)}
                        onMouseLeave={() => setHoveredRemote((current) => (current === remote.name ? null : current))}
                      >
                        <div className="remote-summary">
                          <p className="remote-name">{remote.name}</p>
                        </div>

                        <div className={`remote-actions ${isHovered ? 'visible' : ''}`}>
                          <span className="status-badge">{remote.status}</span>
                          <button className="row-action" type="button" onClick={() => void handleReconnect(remote)}>
                            Reconnect
                          </button>
                          <button className="row-action danger" type="button" onClick={() => openRemoveModal(remote)}>
                            Remove
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </aside>

      <section className="workspace-main">
        <div className="workspace-placeholder">
          <p className="eyebrow">Cloud Weave</p>
          <h1>Connected storage, without the clutter.</h1>
          <p>
            Add a provider from the sidebar, complete authentication in your browser, and come back when you are done.
          </p>
        </div>
      </section>

      {activeModal === 'add-storage' ? (
        <div className="modal-overlay" role="presentation">
          <div className="full-modal" role="dialog" aria-modal="true" aria-labelledby="add-storage-title">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Add Storage</p>
                <h2 id="add-storage-title">
                  {addFlowStep === 'providers' ? 'Choose a provider' : `Connect ${selectedProviderConfig.label}`}
                </h2>
              </div>

              <button className="icon-button modal-close" type="button" onClick={closeAddModal} aria-label="Close modal">
                ×
              </button>
            </div>

            {addFlowStep === 'providers' ? (
              <div className="provider-grid">
                {STORAGE_PROVIDERS.map((provider) => (
                  <button
                    key={provider.id}
                    className={`provider-option ${provider.enabled ? '' : 'disabled'}`}
                    type="button"
                    disabled={!provider.enabled}
                    onClick={() => openProviderForm(provider.id)}
                  >
                    <span>{provider.label}</span>
                    <small>{provider.description}</small>
                  </button>
                ))}
              </div>
            ) : (
              <form className="connect-form" onSubmit={handleCreateRemote}>
                <div className="form-copy">
                  <p>Authentication opens in your default browser. When you finish there, this app will keep checking for completion.</p>
                </div>

                <label className="field">
                  <span>Remote name</span>
                  <input
                    value={remoteName}
                    onChange={(event) => setRemoteName(event.target.value)}
                    placeholder="onedrive-main"
                    autoComplete="off"
                  />
                </label>

                <details className="advanced-options">
                  <summary>Advanced options</summary>

                  <label className="field">
                    <span>Client ID</span>
                    <input value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" />
                  </label>

                  <label className="field">
                    <span>Client Secret</span>
                    <input
                      value={clientSecret}
                      onChange={(event) => setClientSecret(event.target.value)}
                      autoComplete="off"
                      type="password"
                    />
                  </label>
                </details>

                {addError ? <p className="error-text">{addError}</p> : null}

                <div className="modal-actions">
                  <button className="ghost-button" type="button" onClick={() => setAddFlowStep('providers')}>
                    Back
                  </button>
                  <button className="primary-button" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Starting...' : `Connect ${selectedProviderConfig.label}`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {activeModal === 'oauth-pending' && pendingSession ? (
        <div className="modal-overlay" role="presentation">
          <div className="full-modal pending-modal" role="dialog" aria-modal="true" aria-labelledby="pending-title">
            <div className="modal-header">
              <div>
                <p className="eyebrow">{pendingSession.provider}</p>
                <h2 id="pending-title">
                  {pendingSession.status === 'connected'
                    ? 'Storage connected'
                    : pendingSession.status === 'error'
                      ? 'Authentication was not completed'
                      : 'Complete authentication in your browser'}
                </h2>
              </div>

              <button className="icon-button modal-close" type="button" onClick={closePendingModal} aria-label="Close modal">
                ×
              </button>
            </div>

            <div className="pending-body">
              <p className="pending-remote">{pendingSession.remoteName}</p>
              <p>{pendingSession.message || EMPTY_PENDING_MESSAGE}</p>

              {pendingSession.status === 'pending' ? (
                <div className="pending-indicator">
                  <span className="spinner" aria-hidden="true" />
                  <p>Checking for completion...</p>
                </div>
              ) : null}

              {pendingSession.status === 'error' ? (
                <p className="pending-help">You can close this window or try again.</p>
              ) : null}

              {pendingSession.status === 'connected' ? (
                <p className="pending-help">This storage will now appear in the connected list.</p>
              ) : null}
            </div>

            <div className="modal-actions">
              {pendingSession.status === 'error' ? (
                <>
                  <button className="ghost-button" type="button" onClick={closePendingModal}>
                    Close
                  </button>
                  <button className="primary-button" type="button" onClick={handleRetryPending}>
                    Try again
                  </button>
                </>
              ) : pendingSession.status === 'connected' ? (
                <button className="primary-button" type="button" onClick={handlePendingDone}>
                  Done
                </button>
              ) : (
                <>
                  <button className="ghost-button" type="button" onClick={closePendingModal}>
                    Close
                  </button>
                  <button className="primary-button" type="button" onClick={() => void handlePendingDone()} disabled={isCheckingPending}>
                    {isCheckingPending ? 'Checking...' : 'Done'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === 'remove-confirm' && removeTarget ? (
        <div className="modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-title">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Remove Storage</p>
                <h2 id="remove-title">Remove {removeTarget.name}?</h2>
              </div>

              <button
                className="icon-button modal-close"
                type="button"
                onClick={() => setActiveModal('none')}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>

            <div className="confirm-copy">
              <p>This removes the saved connection from Cloud Weave.</p>
              <p className="confirm-provider">{removeTarget.provider}</p>
              {removeError ? <p className="error-text">{removeError}</p> : null}
            </div>

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setActiveModal('none')}>
                Cancel
              </button>
              <button className="primary-button destructive" type="button" onClick={() => void handleDeleteRemote()} disabled={isRemoving}>
                {isRemoving ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
