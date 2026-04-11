import type { UnifiedItem } from '../../features/storage/unifiedItems'
import type { DownloadState } from '../../features/storage/downloads'
import type { OpenState } from '../../features/storage/openFiles'
import { ListHeader } from '../library/ListHeader'
import { StreamingLoadingTail } from '../library/StreamingLoadingTail'
import { UnifiedListItem } from '../library/UnifiedListItem'
import { EmptyListState } from '../ui/EmptyListState'

type RecentGroup = {
  label: string
  items: UnifiedItem[]
}

type LibraryMainRecentViewProps = {
  groupedRecentItems: RecentGroup[]
  shouldShowCategoryEmptyState: boolean
  emptyListTitle: string
  emptyListDescription: string
  shouldShowStreamingTail: boolean
  getDownloadState: (itemId: string) => DownloadState
  getOpenState: (itemId: string) => OpenState
  onOpen: (item: UnifiedItem) => Promise<void>
  onDownload: (item: UnifiedItem) => Promise<void>
}

export function LibraryMainRecentView({
  groupedRecentItems,
  shouldShowCategoryEmptyState,
  emptyListTitle,
  emptyListDescription,
  shouldShowStreamingTail,
  getDownloadState,
  getOpenState,
  onOpen,
  onDownload,
}: LibraryMainRecentViewProps) {
  if (shouldShowCategoryEmptyState) {
    return (
      <>
        <ListHeader />
        <EmptyListState title={emptyListTitle} description={emptyListDescription} />
      </>
    )
  }

  return (
    <>
      <div className="recent-groups">
        {groupedRecentItems.map((group) => (
          <section key={group.label} className="recent-group">
            <div className="section-heading">
              <h3>{group.label}</h3>
              <span>{group.items.length}</span>
            </div>
            <ListHeader />
            <div className="item-list">
              {group.items.map((item) => (
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
          </section>
        ))}
      </div>
      {shouldShowStreamingTail ? <StreamingLoadingTail /> : null}
    </>
  )
}

