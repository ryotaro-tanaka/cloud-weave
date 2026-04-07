import type { RefObject } from 'react'
import type { UnifiedItemSortKey } from '../../features/storage/unifiedItems'
import { Button } from '../ui/Button'
import { SortMenuOptionButton } from '../ui/SortMenuOptionButton'

export type SortMenuOption = { value: UnifiedItemSortKey; label: string }

type LibraryTopbarProps = {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  sortMenuRef: RefObject<HTMLDivElement | null>
  isSortMenuOpen: boolean
  onToggleSortMenu: () => void
  sortOptions: SortMenuOption[]
  sortKey: UnifiedItemSortKey
  sortLabel: string
  onSelectSortKey: (key: UnifiedItemSortKey) => void
  workspaceIssueCount: number
  unreadIssueCount: number
  onOpenIssues: () => void
  onOpenUpload: () => void
  hasConnectedStorage: boolean
}

export function LibraryTopbar({
  searchQuery,
  onSearchQueryChange,
  sortMenuRef,
  isSortMenuOpen,
  onToggleSortMenu,
  sortOptions,
  sortKey,
  sortLabel,
  onSelectSortKey,
  workspaceIssueCount,
  unreadIssueCount,
  onOpenIssues,
  onOpenUpload,
  hasConnectedStorage,
}: LibraryTopbarProps) {
  return (
    <header className="library-topbar">
      <div className="library-toolbar">
        <label className="search-field" aria-label="Search files">
          <span className="search-icon" aria-hidden="true">
            /
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search files, paths, or sources"
          />
        </label>

        <div className="library-actions">
          <div className={`toolbar-select ${isSortMenuOpen ? 'open' : ''}`} ref={sortMenuRef}>
            <Button
              family="quiet"
              size="sm"
              className="toolbar-select-trigger"
              type="button"
              aria-label="Sort files"
              aria-haspopup="menu"
              aria-expanded={isSortMenuOpen}
              onClick={onToggleSortMenu}
            >
              <span className="toolbar-select-value">{sortLabel}</span>
              <span className="toolbar-select-icon" aria-hidden="true">
                v
              </span>
            </Button>

            {isSortMenuOpen ? (
              <div className="toolbar-select-menu" role="menu" aria-label="Sort files">
                {sortOptions.map((option) => (
                  <SortMenuOptionButton
                    key={option.value}
                    active={sortKey === option.value}
                    label={option.label}
                    onSelect={() => onSelectSortKey(option.value)}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <Button family="icon" size="md" className="issues-entry-button utility-icon-button" type="button" onClick={onOpenIssues} aria-label="Open issues">
            <span aria-hidden="true">!</span>
            {workspaceIssueCount > 0 ? (
              <span className="issues-entry-badge">{unreadIssueCount > 0 ? unreadIssueCount : workspaceIssueCount}</span>
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
