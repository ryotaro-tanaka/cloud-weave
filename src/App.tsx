import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

type StorageProvider = 'onedrive' | 'gdrive' | 'dropbox' | 'icloud'
type AuthType = 'oauth' | 'form'

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
  status: string
  nextStep: string
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
    description: 'Microsoft browser authentication',
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    authType: 'oauth',
    enabled: false,
    description: 'Planned next',
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
    description: 'Requires separate feasibility work',
  },
]

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<StorageProvider>('onedrive')
  const [remotes, setRemotes] = useState<RemoteSummary[]>([])
  const [isLoadingRemotes, setIsLoadingRemotes] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState<string | null>(null)
  const [remoteName, setRemoteName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [statusMessage, setStatusMessage] = useState('Cloud Weave is ready to load your connected storage.')
  const [errorMessage, setErrorMessage] = useState('')

  const selectedProviderConfig = useMemo(
    () => STORAGE_PROVIDERS.find((provider) => provider.id === selectedProvider) ?? STORAGE_PROVIDERS[0],
    [selectedProvider],
  )

  const loadRemotes = async () => {
    setIsLoadingRemotes(true)

    try {
      const result = await invoke<RemoteSummary[]>('list_storage_remotes')
      setRemotes(result)
      setErrorMessage('')

      if (result.length === 0) {
        setStatusMessage('No storage is connected yet. Add OneDrive to start the browser authentication flow.')
      } else {
        setStatusMessage(`Loaded ${result.length} connected storage ${result.length === 1 ? 'provider' : 'providers'}.`)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatusMessage('Cloud Weave could not load the storage list.')
    } finally {
      setIsLoadingRemotes(false)
    }
  }

  useEffect(() => {
    void loadRemotes()
  }, [])

  const handleCreateRemote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!remoteName.trim()) {
      setErrorMessage('Remote name is required.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')
    setStatusMessage('Starting the OneDrive connection flow. Your browser may open for Microsoft sign-in.')

    try {
      const result = await invoke<CreateRemoteResult>('create_onedrive_remote', {
        input: {
          remoteName: remoteName.trim(),
          clientId: clientId.trim() || undefined,
          clientSecret: clientSecret.trim() || undefined,
        } satisfies CreateOneDriveRemoteInput,
      })

      if (result.status === 'error') {
        setErrorMessage(result.message)
      } else {
        setErrorMessage('')
      }

      setStatusMessage(result.message)

      if (result.status === 'connected') {
        setRemoteName('')
        setClientId('')
        setClientSecret('')
        setShowAddPanel(false)
      }

      await loadRemotes()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatusMessage('Cloud Weave could not create the OneDrive connection.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReconnect = async (name: string) => {
    setIsReconnecting(name)
    setErrorMessage('')
    setStatusMessage(`Starting browser re-authentication for ${name}.`)

    try {
      const result = await invoke<CreateRemoteResult>('reconnect_remote', { name })

      if (result.status === 'error') {
        setErrorMessage(result.message)
      } else {
        setErrorMessage('')
      }

      setStatusMessage(result.message)
      await loadRemotes()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatusMessage(`Cloud Weave could not reconnect ${name}.`)
    } finally {
      setIsReconnecting(null)
    }
  }

  return (
    <main className="workspace-shell">
      <aside className={`storage-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Connected Storage</p>
            <h2>Cloud Weave</h2>
          </div>

          <button
            className="icon-button"
            onClick={() => setSidebarOpen((open) => !open)}
            type="button"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? '←' : '→'}
          </button>
        </div>

        {sidebarOpen ? (
          <>
            <div className="sidebar-section">
              <div className="section-heading">
                <h3>Storage List</h3>
                <button className="ghost-button" type="button" onClick={() => void loadRemotes()} disabled={isLoadingRemotes}>
                  {isLoadingRemotes ? 'Loading...' : 'Refresh'}
                </button>
              </div>

              {isLoadingRemotes ? (
                <p className="empty-state">Loading connected storage...</p>
              ) : remotes.length === 0 ? (
                <p className="empty-state">No storage connected yet.</p>
              ) : (
                <ul className="remote-list">
                  {remotes.map((remote) => (
                    <li key={remote.name} className="remote-item">
                      <div>
                        <p className="remote-name">{remote.name}</p>
                        <p className="remote-meta">
                          {remote.provider} • {remote.status}
                        </p>
                      </div>

                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleReconnect(remote.name)}
                        disabled={isReconnecting === remote.name}
                      >
                        {isReconnecting === remote.name ? 'Opening...' : 'Reconnect'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="sidebar-section">
              <div className="section-heading">
                <h3>Add Storage</h3>
                <button className="primary-button" type="button" onClick={() => setShowAddPanel((open) => !open)}>
                  {showAddPanel ? 'Close' : 'Add'}
                </button>
              </div>

              <div className="provider-list">
                {STORAGE_PROVIDERS.map((provider) => (
                  <button
                    key={provider.id}
                    className={`provider-card ${selectedProvider === provider.id ? 'selected' : ''}`}
                    type="button"
                    onClick={() => {
                      setSelectedProvider(provider.id)
                      setShowAddPanel(true)
                    }}
                    disabled={!provider.enabled}
                  >
                    <span>{provider.label}</span>
                    <small>
                      {provider.authType} • {provider.description}
                    </small>
                  </button>
                ))}
              </div>

              {showAddPanel ? (
                <form className="create-panel" onSubmit={handleCreateRemote}>
                  <div className="panel-copy">
                    <p className="panel-title">{selectedProviderConfig.label} setup</p>
                    <p>
                      OAuth storage starts in your default browser. Cloud Weave saves the connection into its own rclone
                      config file.
                    </p>
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

                  <button className="primary-button" type="submit" disabled={isSubmitting || !selectedProviderConfig.enabled}>
                    {isSubmitting ? 'Connecting...' : `Connect ${selectedProviderConfig.label}`}
                  </button>
                </form>
              ) : null}
            </div>

            <div className="sidebar-section status-card">
              <h3>Status</h3>
              <p>{statusMessage}</p>
              {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
            </div>
          </>
        ) : (
          <div className="sidebar-collapsed-copy">
            <p>{remotes.length}</p>
            <small>storage</small>
          </div>
        )}
      </aside>

      <section className="workspace-main">
        <div className="hero-panel">
          <p className="eyebrow">Workspace Preview</p>
          <h1>Connect cloud storage from one sidebar.</h1>
          <p className="hero-copy">
            This first slice focuses on listing connected remotes and starting the OneDrive browser authentication flow.
            File browsing can build on top of the same rclone command layer next.
          </p>

          <div className="hero-grid">
            <article className="hero-metric">
              <span>{remotes.length}</span>
              <p>Connected remotes</p>
            </article>

            <article className="hero-metric">
              <span>1</span>
              <p>Enabled provider today</p>
            </article>

            <article className="hero-metric">
              <span>OAuth</span>
              <p>Browser-first OneDrive flow</p>
            </article>
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
