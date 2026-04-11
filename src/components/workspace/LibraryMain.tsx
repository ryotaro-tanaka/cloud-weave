import type { DownloadState } from '../../features/storage/downloads'
import type { OpenState } from '../../features/storage/openFiles'
import type { LogicalView, UnifiedItem } from '../../features/storage/unifiedItems'
import { LibraryMainCategoryView } from './LibraryMainCategoryView'
import { LibraryMainRecentView } from './LibraryMainRecentView'
import { LibraryMainStateView } from './LibraryMainStateView'

type RecentGroup = {
  label: string
  items: UnifiedItem[]
}

type LibraryMainProps = {
  activeView: LogicalView
  itemsError: string
  shouldShowNoStorageState: boolean
  shouldShowLoadingList: boolean
  shouldShowCategoryEmptyState: boolean
  shouldShowStreamingTail: boolean
  emptyListTitle: string
  emptyListDescription: string
  hasConnectedStorage: boolean
  displayedItems: UnifiedItem[]
  groupedRecentItems: RecentGroup[]
  getDownloadState: (itemId: string) => DownloadState
  getOpenState: (itemId: string) => OpenState
  onOpen: (item: UnifiedItem) => Promise<void>
  onDownload: (item: UnifiedItem) => Promise<void>
  onOpenAddStorage: () => void
  onOpenUpload: () => void
}

export function LibraryMain({
  activeView,
  itemsError,
  shouldShowNoStorageState,
  shouldShowLoadingList,
  shouldShowCategoryEmptyState,
  shouldShowStreamingTail,
  emptyListTitle,
  emptyListDescription,
  hasConnectedStorage,
  displayedItems,
  groupedRecentItems,
  getDownloadState,
  getOpenState,
  onOpen,
  onDownload,
  onOpenAddStorage,
  onOpenUpload,
}: LibraryMainProps) {
  const shouldShowListBody = !itemsError && hasConnectedStorage && !shouldShowLoadingList

  return (
    <div className="library-content">
      <LibraryMainStateView
        itemsError={itemsError}
        shouldShowNoStorageState={shouldShowNoStorageState}
        shouldShowLoadingList={shouldShowLoadingList}
        hasConnectedStorage={hasConnectedStorage}
        onOpenAddStorage={onOpenAddStorage}
        onOpenUpload={onOpenUpload}
      />

      {shouldShowListBody ? (
        activeView === 'recent' ? (
          <LibraryMainRecentView
            groupedRecentItems={groupedRecentItems}
            shouldShowCategoryEmptyState={shouldShowCategoryEmptyState}
            emptyListTitle={emptyListTitle}
            emptyListDescription={emptyListDescription}
            shouldShowStreamingTail={shouldShowStreamingTail}
            getDownloadState={getDownloadState}
            getOpenState={getOpenState}
            onOpen={onOpen}
            onDownload={onDownload}
          />
        ) : (
          <LibraryMainCategoryView
            displayedItems={displayedItems}
            shouldShowCategoryEmptyState={shouldShowCategoryEmptyState}
            emptyListTitle={emptyListTitle}
            emptyListDescription={emptyListDescription}
            shouldShowStreamingTail={shouldShowStreamingTail}
            getDownloadState={getDownloadState}
            getOpenState={getOpenState}
            onOpen={onOpen}
            onDownload={onDownload}
          />
        )
      ) : null}
    </div>
  )
}
