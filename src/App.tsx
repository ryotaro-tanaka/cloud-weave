import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  resolvePendingSession,
  type AuthSessionRecord,
  type OneDriveDriveCandidate,
  type PendingMode,
  type PendingSession,
  type RemoteSummary,
} from './features/storage/pendingState'
import {
  filterItemsByView,
  formatFileSize,
  formatModifiedTime,
  getCategoryLabel,
  getCategoryMonogram,
  groupRecentItems,
  searchUnifiedItems,
  type LogicalView,
  type UnifiedItem,
} from './features/storage/unifiedItems'
import './App.css'

type StorageProvider = 'onedrive' | 'gdrive' | 'dropbox' | 'icloud'
type AuthType = 'oauth' | 'form'
type ModalName = 'none' | 'add-storage' | 'oauth-pending' | 'remove-confirm'
type AddFlowStep = 'providers' | 'form'

type CreateOneDriveRemoteInput = {
  remoteName: string
  clientId?: string
  clientSecret?: string
}

type CreateRemoteResult = {
  remoteName: string
  provider: string
  status: 'connected' | 'pending' | 'requires_drive_selection' | 'error'
  nextStep: 'done' | 'open_browser' | 'retry' | 'rename' | 'select_drive'
  message: string
  driveCandidates?: OneDriveDriveCandidate[] | null
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

const LOGICAL_VIEWS: LogicalView[] = ['recent', 'documents', 'photos', 'videos', 'audio', 'other']
const EMPTY_PENDING_MESSAGE = 'Complete authentication in your browser.'

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeModal, setActiveModal] = useState<ModalName>('none')
  const [addFlowStep, setAddFlowStep] = useState<AddFlowStep>('providers')
  const [selectedProvider, setSelectedProvider] = useState<StorageProvider>('onedrive')
  const [activeView, setActiveView] = useState<LogicalView>('recent')
  const [searchQuery, setSearchQuery] = useState('')
  const [remotes, setRemotes] = useState<RemoteSummary[]>([])
  const [unifiedItems, setUnifiedItems] = useState<UnifiedItem[]>([])
  const [hoveredRemote, setHoveredRemote] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<RemoteSummary | null>(null)
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null)
  const [selectedDriveId, setSelectedDriveId] = useState('')
  const [showManualSetupHelp, setShowManualSetupHelp] = useState(false)
  const [isLoadingRemotes, setIsLoadingRemotes] = useState(true)
  const [isLoadingItems, setIsLoadingItems] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingPending, setIsCheckingPending] = useState(false)
  const [isFinalizingDrive, setIsFinalizingDrive] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [remoteName, setRemoteName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [listError, setListError] = useState('')
  const [itemsError, setItemsError] = useState('')
  const [addError, setAddError] = useState('')
  const [removeError, setRemoveError] = useState('')

  const selectedProviderConfig = useMemo(
    () => STORAGE_PROVIDERS.find((provider) => provider.id === selectedProvider) ?? STORAGE_PROVIDERS[0],
    [selectedProvider],
  )

  const displayedItems = useMemo(() => {
    const viewItems = filterItemsByView(unifiedItems, activeView)
    return searchUnifiedItems(viewItems, searchQuery)
  }, [activeView, searchQuery, unifiedItems])

  const groupedRecentItems = useMemo(() => {
    if (activeView !== 'recent') {
      return []
    }

    return groupRecentItems(displayedItems)
  }, [activeView, displayedItems])

  const isVisualGrid = activeView === 'photos' || activeView === 'videos'
  const showsPersonalVaultNotice = remotes.some((remote) => remote.provider === 'onedrive')

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
      setRemotes([])
      return null
    } finally {
      if (!silent) {
        setIsLoadingRemotes(false)
      }
    }
  }

  const fetchUnifiedItems = async (nextRemotes?: RemoteSummary[] | null, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    const resolvedRemotes = nextRemotes === undefined ? remotes : nextRemotes

    if (!silent) {
      setIsLoadingItems(true)
    }

    if (!resolvedRemotes || resolvedRemotes.length === 0) {
      setUnifiedItems([])
      setItemsError('')
      if (!silent) {
        setIsLoadingItems(false)
      }
      return []
    }

    try {
      const result = await invoke<UnifiedItem[]>('list_unified_items')
      setUnifiedItems(result)
      setItemsError('')
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setItemsError(message)
      setUnifiedItems([])
      return null
    } finally {
      if (!silent) {
        setIsLoadingItems(false)
      }
    }
  }

  const refreshLibrary = async (options?: { silent?: boolean }) => {
    const nextRemotes = await fetchRemotes(options)
    await fetchUnifiedItems(nextRemotes, options)
  }

  useEffect(() => {
    void refreshLibrary()
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

  useEffect(() => {
    if (pendingSession?.status !== 'requires_drive_selection') {
      setSelectedDriveId('')
      return
    }

    const preferred =
      pendingSession.driveCandidates?.find((candidate) => candidate.isSuggested && candidate.isReachable) ??
      pendingSession.driveCandidates?.find((candidate) => candidate.isReachable) ??
      pendingSession.driveCandidates?.[0]

    setSelectedDriveId(preferred?.id ?? '')
  }, [pendingSession])

  const resetAddFlow = () => {
    setAddFlowStep('providers')
    setSelectedProvider('onedrive')
    setRemoteName('')
    setClientId('')
    setClientSecret('')
    setAddError('')
    setShowManualSetupHelp(false)
    setSelectedDriveId('')
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

      const nextPending = resolvePendingSession(pendingSession, latestRemotes, session)

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
    setShowManualSetupHelp(false)
    setPendingSession({
      remoteName: result.remoteName,
      provider: result.provider,
      mode,
      status: result.status,
      nextStep: result.nextStep,
      message: result.message || EMPTY_PENDING_MESSAGE,
      driveCandidates: result.driveCandidates ?? undefined,
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
      await refreshLibrary({ silent: true })
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRemoving(false)
    }
  }

  const handlePendingDone = async () => {
    const latest = await checkPendingSession()

    if (latest?.status === 'connected') {
      await refreshLibrary({ silent: true })
      setActiveModal('none')
      setPendingSession(null)
      resetAddFlow()
    }
  }

  const handleFinalizeDriveSelection = async () => {
    if (!pendingSession || pendingSession.status !== 'requires_drive_selection' || !selectedDriveId) {
      return
    }

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
        nextStep: result.nextStep,
        message: result.message,
        driveCandidates: result.driveCandidates ?? undefined,
      })

      if (result.status === 'connected') {
        await refreshLibrary({ silent: true })
      }
    } catch (error) {
      setPendingSession({
        ...pendingSession,
        status: 'error',
        nextStep: 'retry',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsFinalizingDrive(false)
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
    setShowManualSetupHelp(false)
    setActiveModal('add-storage')
  }

  const handlePendingRemoveAndReconnect = async () => {
    if (!pendingSession) {
      return
    }

    try {
      await invoke<ActionResult>('delete_remote', { name: pendingSession.remoteName })
    } catch {
      // Ignore delete failures here and still guide the user back into reconnect flow.
    }

    setSelectedProvider((pendingSession.provider as StorageProvider) || 'onedrive')
    setAddFlowStep('form')
    setRemoteName(pendingSession.remoteName)
    setClientId('')
    setClientSecret('')
    setAddError('')
    setShowManualSetupHelp(false)
    setActiveModal('add-storage')
    await refreshLibrary({ silent: true })
  }

  const openRemoveModal = (remote: RemoteSummary) => {
    setRemoveTarget(remote)
    setRemoveError('')
    setActiveModal('remove-confirm')
  }

  const closePendingModal = () => {
    setActiveModal('none')
    setSelectedDriveId('')
  }

  const hasConnectedStorage = remotes.length > 0
  const shouldShowNoStorageState = !isLoadingRemotes && !listError && !hasConnectedStorage
  const shouldShowCategoryEmptyState =
    hasConnectedStorage && !isLoadingItems && !itemsError && displayedItems.length === 0

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
              {shouldShowNoStorageState ? <p className="empty-state">No storage connected yet.</p> : null}

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
                          <div>
                            <p className="remote-name">{remote.name}</p>
                            <p className="remote-provider">{getProviderLabel(remote.provider)}</p>
                            {remote.message ? <p className="remote-message">{remote.message}</p> : null}
                          </div>
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
        <div className="library-shell">
          <header className="library-topbar">
            <label className="search-field" aria-label="Search files">
              <span className="search-icon" aria-hidden="true">
                /
              </span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search files, paths, or storage names"
              />
            </label>

            <nav className="view-tabs" aria-label="Logical views">
              {LOGICAL_VIEWS.map((view) => (
                <button
                  key={view}
                  className={`view-tab ${activeView === view ? 'active' : ''}`}
                  type="button"
                  onClick={() => setActiveView(view)}
                >
                  {getCategoryLabel(view)}
                </button>
              ))}
            </nav>
          </header>

          <div className="library-content">
            {showsPersonalVaultNotice ? (
              <div className="info-banner" role="note">
                <p>OneDrive Personal Vault is excluded from unified browsing.</p>
              </div>
            ) : null}

            {isLoadingItems && hasConnectedStorage ? <p className="empty-state">Loading your unified library...</p> : null}
            {!isLoadingItems && itemsError ? <p className="error-text">{itemsError}</p> : null}

            {shouldShowNoStorageState ? (
              <div className="main-empty-state">
                <p className="eyebrow">Unified Library</p>
                <h1>Your files will appear here.</h1>
                <p>Connect a storage from the sidebar to start browsing everything in one place.</p>
                <button className="primary-button" type="button" onClick={openAddModal}>
                  Connect storage
                </button>
              </div>
            ) : null}

            {shouldShowCategoryEmptyState ? (
              <div className="main-empty-state compact">
                <p className="eyebrow">{getCategoryLabel(activeView)}</p>
                <h2>No matching files.</h2>
                <p>
                  {searchQuery
                    ? 'Try a different search or switch to another view.'
                    : `There are no files in ${getCategoryLabel(activeView).toLowerCase()} right now.`}
                </p>
              </div>
            ) : null}

            {!isLoadingItems && !itemsError && displayedItems.length > 0 ? (
              activeView === 'recent' ? (
                <div className="recent-groups">
                  {groupedRecentItems.map((group) => (
                    <section key={group.label} className="recent-group">
                      <div className="section-heading">
                        <h3>{group.label}</h3>
                        <span>{group.items.length}</span>
                      </div>

                      <div className="item-list">
                        {group.items.map((item) => (
                          <UnifiedListItem key={item.id} item={item} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : isVisualGrid ? (
                <div className="item-grid">
                  {displayedItems.map((item) => (
                    <UnifiedGridItem key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <div className="item-list">
                  {displayedItems.map((item) => (
                    <UnifiedListItem key={item.id} item={item} />
                  ))}
                </div>
              )
            ) : null}
          </div>
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
                    : pendingSession.status === 'requires_drive_selection'
                      ? 'Choose your OneDrive'
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

              {pendingSession.status === 'requires_drive_selection' ? (
                <div className="drive-picker">
                  <p className="pending-help">
                    Cloud Weave found more than one OneDrive library for this account. Choose the one you want to
                    browse.
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
                            onChange={() => setSelectedDriveId(candidate.id)}
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
                            <p className="drive-candidate-help">
                              {candidate.isReachable
                                ? candidate.isSystemLike
                                  ? 'This looks like a system-style library. Choose it only if it is the one you expect.'
                                  : 'This library is reachable and ready to use.'
                                : candidate.message ?? 'This library could not be opened.'}
                            </p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {pendingSession.status === 'error' ? (
                <>
                  <p className="pending-help">
                    Cloud Weave finished browser authentication, but this OneDrive connection could not be finalized for browsing.
                  </p>
                  {showManualSetupHelp ? (
                    <div className="manual-help">
                      <p>Manual debug steps</p>
                      <code>
                        rclone config show --config "%APPDATA%\com.ryotaro.cloudweave\rclone.conf"
                      </code>
                      <code>
                        rclone lsd {pendingSession.remoteName}: --config "%APPDATA%\com.ryotaro.cloudweave\rclone.conf" -vv
                      </code>
                      <p>Use interactive <code>rclone config</code> if the remote still lacks drive information.</p>
                    </div>
                  ) : null}
                </>
              ) : null}

              {pendingSession.status === 'connected' ? (
                <p className="pending-help">This storage now appears in the connected list and unified library.</p>
              ) : null}
            </div>

            <div className="modal-actions">
              {pendingSession.status === 'error' ? (
                <>
                  <button className="ghost-button" type="button" onClick={closePendingModal}>
                    Close
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setShowManualSetupHelp((current) => !current)}>
                    {showManualSetupHelp ? 'Hide manual setup instructions' : 'Open manual setup instructions'}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void handlePendingRemoveAndReconnect()}>
                    Remove and connect again
                  </button>
                  <button className="primary-button" type="button" onClick={handleRetryPending}>
                    Try again
                  </button>
                </>
              ) : pendingSession.status === 'requires_drive_selection' ? (
                <>
                  <button className="ghost-button" type="button" onClick={closePendingModal}>
                    Cancel
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void handlePendingRemoveAndReconnect()}>
                    Remove and start over
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void handleFinalizeDriveSelection()}
                    disabled={!selectedDriveId || isFinalizingDrive}
                  >
                    {isFinalizingDrive ? 'Connecting...' : 'Use this drive'}
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
              <p className="confirm-provider">{getProviderLabel(removeTarget.provider)}</p>
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

function UnifiedListItem({ item }: { item: UnifiedItem }) {
  return (
    <article className="unified-item list-item">
      <div className="item-leading">
        <span className={`item-monogram ${item.category}`} aria-hidden="true">
          {getCategoryMonogram(item.category)}
        </span>
      </div>

      <div className="item-copy">
        <div className="item-title-row">
          <p className="item-name">{item.name}</p>
          <span className="source-badge">{item.sourceRemote}</span>
        </div>

        <div className="item-meta">
          <span>{getProviderLabel(item.sourceProvider)}</span>
          <span>{item.sourcePath}</span>
        </div>
      </div>

      <div className="item-trailing">
        <span>{formatFileSize(item.size)}</span>
        <span>{formatModifiedTime(item.modTime)}</span>
      </div>
    </article>
  )
}

function UnifiedGridItem({ item }: { item: UnifiedItem }) {
  return (
    <article className="unified-item grid-item">
      <div className={`grid-preview ${item.category}`}>
        <span className="source-badge">{item.sourceRemote}</span>
      </div>

      <div className="grid-copy">
        <p className="item-name">{item.name}</p>
        <div className="item-meta">
          <span>{getProviderLabel(item.sourceProvider)}</span>
          <span>{formatFileSize(item.size)}</span>
        </div>
        <p className="grid-path">{item.sourcePath}</p>
        <p className="grid-date">{formatModifiedTime(item.modTime)}</p>
      </div>
    </article>
  )
}

function getProviderLabel(provider: string): string {
  switch (provider) {
    case 'onedrive':
      return 'OneDrive'
    case 'gdrive':
      return 'Google Drive'
    case 'dropbox':
      return 'Dropbox'
    case 'icloud':
      return 'iCloud Drive'
    default:
      return provider
  }
}

export default App
