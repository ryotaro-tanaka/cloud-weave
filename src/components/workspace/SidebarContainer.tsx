import { useMemo } from 'react'
import { overlayPendingRemote, type RemoteSummary } from '../../features/storage/pendingState'
import { getProviderLabel } from '../../features/storage/providerLabels'
import { PRIMARY_NAV_ITEMS } from '../../features/storage/workspaceAppConstants'
import { useWorkspaceAppBindings } from '../../features/storage/hooks/useWorkspaceAppBindings'
import { StorageSidebar } from './StorageSidebar'

type Props = {
  onAddStorage: () => void
  onReconnect: (remote: RemoteSummary) => void
  onRemove: (remote: RemoteSummary) => void
}

/**
 * Feature container for sidebar bindings and remote list projection.
 */
export function SidebarContainer({ onAddStorage, onReconnect, onRemove }: Props) {
  const { data } = useWorkspaceAppBindings()
  const displayedRemotes = useMemo(() => overlayPendingRemote(data.remotes, data.pendingSession), [data.pendingSession, data.remotes])

  return (
    <StorageSidebar
      navItems={PRIMARY_NAV_ITEMS}
      onAddStorage={onAddStorage}
      displayedRemotes={displayedRemotes}
      getProviderLabel={getProviderLabel}
      onReconnect={onReconnect}
      onRemove={onRemove}
    />
  )
}
