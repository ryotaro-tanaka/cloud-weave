import { useEffect, useMemo, useRef } from 'react'
import { IDLE_DOWNLOAD_STATE } from '../../features/storage/downloads'
import { IDLE_OPEN_STATE } from '../../features/storage/openFiles'
import { overlayPendingRemote } from '../../features/storage/pendingState'
import {
  filterItemsByView,
  getCategoryLabel,
  groupRecentItems,
  searchUnifiedItems,
  sortUnifiedItems,
  type UnifiedItem,
} from '../../features/storage/unifiedItems'
import { getDefaultSortKey } from '../../features/storage/demoEnv'
import { getSortLabel } from '../../features/storage/sortLabels'
import { SORT_OPTIONS } from '../../features/storage/workspaceAppConstants'
import { useWorkspaceAppBindings } from '../../features/storage/hooks/useWorkspaceAppBindings'
import { useDismissOnOutsideOrEscape } from '../ui/useDismissOnOutsideOrEscape'
import { LibraryMain } from './LibraryMain'
import { LibraryShell } from './LibraryShell'
import { LibraryTopbar } from './LibraryTopbar'

type Props = {
  onOpenUpload: () => void
  onOpenAddStorage: () => void
  onOpen: (item: UnifiedItem) => Promise<void>
  onDownload: (item: UnifiedItem) => Promise<void>
}

/**
 * Feature container for library shell/topbar/main composition.
 * Keeps App.tsx focused on app-level orchestration and modal wiring.
 */
export function LibraryAreaContainer({ onOpenUpload, onOpenAddStorage, onOpen, onDownload }: Props) {
  const {
    ui,
    data,
    transfers,
    dataActions,
    setSortKey,
    setIsSortMenuOpen,
    setOpenRowMenuItemId,
    setIsIssuesModalOpen,
    setFocusedIssueId,
  } = useWorkspaceAppBindings()
  const sortMenuRef = useRef<HTMLDivElement | null>(null)

  const activeView = ui.activeView
  const searchQuery = ui.searchQuery
  const sortKey = ui.sortKey
  const isSortMenuOpen = ui.isSortMenuOpen
  const openRowMenuItemId = ui.openRowMenuItemId

  const displayedItems = useMemo(() => {
    const viewItems = filterItemsByView(data.unifiedItems, activeView)
    const searchResults = searchUnifiedItems(viewItems, searchQuery)
    return sortUnifiedItems(searchResults, sortKey)
  }, [activeView, data.unifiedItems, searchQuery, sortKey])

  const displayedRemotes = useMemo(() => overlayPendingRemote(data.remotes, data.pendingSession), [data.pendingSession, data.remotes])
  const hasConnectedStorage = displayedRemotes.length > 0
  const shouldShowNoStorageState = !data.isLoadingRemotes && !data.listError && !hasConnectedStorage
  const shouldShowCategoryEmptyState =
    hasConnectedStorage &&
    !data.isLoadingItems &&
    !data.isLibraryStreaming &&
    !data.itemsError &&
    displayedItems.length === 0
  const shouldShowLoadingList =
    hasConnectedStorage &&
    !data.itemsError &&
    data.unifiedItems.length === 0 &&
    (data.isLoadingItems || data.isLibraryStreaming || data.isRefreshingItems)
  const shouldShowStreamingTail = (data.isLibraryStreaming || data.isRefreshingItems) && data.unifiedItems.length > 0 && !data.itemsError
  const emptyListTitle = searchQuery ? `No files match "${searchQuery.trim()}".` : `No files in ${getCategoryLabel(activeView)} yet.`
  const emptyListDescription = searchQuery
    ? 'Try a different search or switch to another view.'
    : 'Files added to this view will appear here.'

  const groupedRecentItems = useMemo(() => {
    if (activeView !== 'recent' || sortKey !== 'updated-desc') {
      return []
    }

    return groupRecentItems(displayedItems)
  }, [activeView, displayedItems, sortKey])

  useEffect(() => {
    setSortKey(getDefaultSortKey(activeView))
  }, [activeView, setSortKey])

  const openIssuesModal = (issueId?: string) => {
    setFocusedIssueId(issueId ?? null)
    setIsIssuesModalOpen(true)
    dataActions.markIssuesRead(issueId ? [issueId] : undefined)
  }

  const isInsideSortMenu = (target: Node) => sortMenuRef.current?.contains(target) ?? false
  useDismissOnOutsideOrEscape(isSortMenuOpen, () => setIsSortMenuOpen(false), isInsideSortMenu)

  const isInsideRowMenu = (target: Node) => {
    const element = target instanceof Element ? target : target.parentElement
    return Boolean(element?.closest('[data-row-menu-container="true"]'))
  }
  useDismissOnOutsideOrEscape(openRowMenuItemId !== null, () => setOpenRowMenuItemId(null), isInsideRowMenu)

  return (
    <LibraryShell
      topbar={
        <LibraryTopbar
          sortMenuRef={sortMenuRef}
          sortOptions={SORT_OPTIONS}
          sortLabel={getSortLabel(sortKey)}
          onSelectSortKey={(key) => {
            setSortKey(key)
            setIsSortMenuOpen(false)
          }}
          onOpenIssues={() => openIssuesModal()}
          onOpenUpload={onOpenUpload}
          hasConnectedStorage={hasConnectedStorage}
        />
      }
    >
      <LibraryMain
        activeView={activeView}
        itemsError={data.itemsError}
        shouldShowNoStorageState={shouldShowNoStorageState}
        shouldShowLoadingList={shouldShowLoadingList}
        shouldShowCategoryEmptyState={shouldShowCategoryEmptyState}
        shouldShowStreamingTail={shouldShowStreamingTail}
        emptyListTitle={emptyListTitle}
        emptyListDescription={emptyListDescription}
        hasConnectedStorage={hasConnectedStorage}
        displayedItems={displayedItems}
        groupedRecentItems={groupedRecentItems}
        getDownloadState={(itemId) => transfers.downloadStates[itemId] ?? IDLE_DOWNLOAD_STATE}
        getOpenState={(itemId) => transfers.openStates[itemId] ?? IDLE_OPEN_STATE}
        onOpen={onOpen}
        onDownload={onDownload}
        onOpenAddStorage={onOpenAddStorage}
        onOpenUpload={onOpenUpload}
      />
    </LibraryShell>
  )
}
