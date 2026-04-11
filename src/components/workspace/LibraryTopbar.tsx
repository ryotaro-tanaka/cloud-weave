import type { RefObject } from 'react'
import type { UnifiedItemSortKey } from '../../features/storage/unifiedItems'
import { Button } from '../ui/Button'
import { SortMenuOptionButton } from '../ui/SortMenuOptionButton'
import { useWorkspaceData } from '../../state/workspaceData/WorkspaceDataContext'
import { useWorkspaceUI } from '../../state/workspaceUI/WorkspaceUIContext'

export type SortMenuOption = { value: UnifiedItemSortKey; label: string }

type LibraryTopbarProps = {
  sortMenuRef: RefObject<HTMLDivElement | null>
  sortOptions: SortMenuOption[]
  sortLabel: string
  onSelectSortKey: (key: UnifiedItemSortKey) => void
  onOpenIssues: () => void
  onOpenUpload: () => void
  hasConnectedStorage: boolean
}

export function LibraryTopbar({
  sortMenuRef,
  sortOptions,
  sortLabel,
  onSelectSortKey,
  onOpenIssues,
  onOpenUpload,
  hasConnectedStorage,
}: LibraryTopbarProps) {
  const { state: ui, dispatch: uiDispatch } = useWorkspaceUI()
  const { state: data } = useWorkspaceData()

  const unreadIssueCount = data.workspaceIssues.filter((issue) => !issue.read).length

  return (
    <header className="library-topbar">
      <div className="library-toolbar">
        <label className="search-field" aria-label="Search files">
          <span className="search-icon" aria-hidden="true">
            /
          </span>
          <input
            type="search"
            value={ui.searchQuery}
            onChange={(event) => uiDispatch({ type: 'ui/setSearchQuery', query: event.target.value })}
            placeholder="Search files, paths, or sources"
          />
        </label>

        <div className="library-actions">
          <div className={`toolbar-select ${ui.isSortMenuOpen ? 'open' : ''}`} ref={sortMenuRef}>
            <Button
              family="quiet"
              size="sm"
              className="toolbar-select-trigger"
              type="button"
              aria-label="Sort files"
              aria-haspopup="menu"
              aria-expanded={ui.isSortMenuOpen}
              onClick={() => uiDispatch({ type: 'ui/setSortMenuOpen', open: !ui.isSortMenuOpen })}
            >
              <span className="toolbar-select-value">{sortLabel}</span>
              <span className="toolbar-select-icon" aria-hidden="true">
                v
              </span>
            </Button>

            {ui.isSortMenuOpen ? (
              <div className="toolbar-select-menu" role="menu" aria-label="Sort files">
                {sortOptions.map((option) => (
                  <SortMenuOptionButton
                    key={option.value}
                    active={ui.sortKey === option.value}
                    label={option.label}
                    onSelect={() => onSelectSortKey(option.value)}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <Button family="icon" size="md" className="issues-entry-button utility-icon-button" type="button" onClick={onOpenIssues} aria-label="Open issues">
            <span aria-hidden="true">!</span>
            {data.workspaceIssues.length > 0 ? (
              <span className="issues-entry-badge">{unreadIssueCount > 0 ? unreadIssueCount : data.workspaceIssues.length}</span>
            ) : null}
          </Button>
          <Button family="primary" type="button" onClick={onOpenUpload} disabled={!hasConnectedStorage}>
            Upload
          </Button>
        </div>
      </div>
    </header>
  )
}
