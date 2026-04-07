import type { RemoteSummary } from '../../features/storage/pendingState'
import type { LogicalView } from '../../features/storage/unifiedItems'
import { Button } from '../ui/Button'
import { EmptyStateLine } from '../ui/EmptyStateLine'
import { InlineError } from '../ui/InlineError'
import { StatusBadge } from '../ui/StatusBadge'

export type StorageSidebarNavItem = { id: LogicalView; label: string }

type StorageSidebarProps = {
  navItems: StorageSidebarNavItem[]
  activeView: LogicalView
  onSelectView: (view: LogicalView) => void
  onAddStorage: () => void
  isLoadingRemotes: boolean
  listError: string
  shouldShowNoStorageState: boolean
  displayedRemotes: RemoteSummary[]
  getProviderLabel: (provider: string) => string
  onReconnect: (remote: RemoteSummary) => void
  onRemove: (remote: RemoteSummary) => void
}

export function StorageSidebar({
  navItems,
  activeView,
  onSelectView,
  onAddStorage,
  isLoadingRemotes,
  listError,
  shouldShowNoStorageState,
  displayedRemotes,
  getProviderLabel,
  onReconnect,
  onRemove,
}: StorageSidebarProps) {
  return (
    <aside className="storage-sidebar">
      <div className="sidebar-panel">
        <div className="sidebar-list">
          <nav className="sidebar-nav" aria-label="Workspace views">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`sidebar-nav-item ${activeView === item.id ? 'active' : ''}`}
                type="button"
                onClick={() => onSelectView(item.id)}
              >
                <span className="sidebar-nav-label">{item.label}</span>
              </button>
            ))}
          </nav>

          <section className="sidebar-section sidebar-section-storage">
            <div className="sidebar-section-heading">
              <p className="sidebar-section-label">Storages</p>
              <Button family="quiet" size="sm" type="button" onClick={onAddStorage}>
                + Add storage
              </Button>
            </div>

            {isLoadingRemotes ? <EmptyStateLine>Loading storage...</EmptyStateLine> : null}
            {!isLoadingRemotes && listError ? <InlineError>{listError}</InlineError> : null}
            {shouldShowNoStorageState ? <EmptyStateLine>No storage connected yet.</EmptyStateLine> : null}

            {!isLoadingRemotes && !listError && displayedRemotes.length > 0 ? (
              <ul className="storage-nav-list">
                {displayedRemotes.map((remote) => {
                  const needsReconnect = remote.status === 'reconnect_required'

                  return (
                    <li key={remote.name} className="storage-nav-item">
                      <div className="storage-nav-copy">
                        <p className="remote-name">{remote.name}</p>
                        <p className="remote-provider">{getProviderLabel(remote.provider)}</p>
                      </div>

                      <div className="storage-nav-side">
                        <StatusBadge tone={needsReconnect ? 'warning' : 'neutral'}>
                          {needsReconnect ? 'Needs reconnect' : 'Connected'}
                        </StatusBadge>

                        <div className="storage-nav-actions">
                          {needsReconnect ? (
                            <Button family="quiet" size="sm" tone="warning" type="button" onClick={() => void onReconnect(remote)}>
                              Reconnect
                            </Button>
                          ) : null}
                          <Button family="quiet" size="sm" tone="danger" type="button" onClick={() => onRemove(remote)}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </section>
        </div>
      </div>
    </aside>
  )
}
