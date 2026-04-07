import type { UnifiedItem } from '../../features/storage/unifiedItems'
import type { DownloadState } from '../../features/storage/downloads'
import type { OpenState } from '../../features/storage/openFiles'
import { ListHeader } from '../library/ListHeader'
import { StreamingLoadingTail } from '../library/StreamingLoadingTail'
import { UnifiedListItem } from '../library/UnifiedListItem'
import { EmptyListState } from '../ui/EmptyListState'

type LibraryMainCategoryViewProps = {
  displayedItems: UnifiedItem[]
  shouldShowCategoryEmptyState: boolean
  emptyListTitle: string
  emptyListDescription: string
  shouldShowStreamingTail: boolean
  getDownloadState: (itemId: string) => DownloadState
  getOpenState: (itemId: string) => OpenState
  onOpen: (item: UnifiedItem) => Promise<void>
  onDownload: (item: UnifiedItem) => Promise<void>
}

export function LibraryMainCategoryView({
  displayedItems,
  shouldShowCategoryEmptyState,
  emptyListTitle,
  emptyListDescription,
  shouldShowStreamingTail,
  getDownloadState,
  getOpenState,
  onOpen,
  onDownload,
}: LibraryMainCategoryViewProps) {
  return (
    <>
      <ListHeader />
      {shouldShowCategoryEmptyState ? (
        <EmptyListState title={emptyListTitle} description={emptyListDescription} />
      ) : (
        <>
          <div className="item-list">
            {displayedItems.map((item) => (
              <UnifiedListItem
                key={item.id}
                item={item}
                downloadState={getDownloadState(item.id)}
                openState={getOpenState(item.id)}
                onOpen={onOpen}
                onDownload={onDownload}
              />
            ))}
          </div>
          {shouldShowStreamingTail ? <StreamingLoadingTail /> : null}
        </>
      )}
    </>
  )
}

