import { Button } from '../ui/Button'
import { RowMenuItem } from '../ui/RowMenuItem'
import {
  canOpenInDefaultApp,
  canPreviewItem,
  type OpenState,
} from '../../features/storage/openFiles'
import type { DownloadState } from '../../features/storage/downloads'
import { formatFileSize, formatModifiedTime, getCategoryMonogram, type UnifiedItem } from '../../features/storage/unifiedItems'
import { formatListPath, getListItemStatusLabel } from './listItemFormat'

export type UnifiedListItemProps = {
  item: UnifiedItem
  downloadState: DownloadState
  openState: OpenState
  onOpen: (item: UnifiedItem) => Promise<void>
  onDownload: (item: UnifiedItem) => Promise<void>
  isRowMenuOpen: boolean
  onToggleRowMenu: () => void
  onCloseRowMenu: () => void
}

export function UnifiedListItem({
  item,
  downloadState,
  openState,
  onOpen,
  onDownload,
  isRowMenuOpen,
  onToggleRowMenu,
  onCloseRowMenu,
}: UnifiedListItemProps) {
  const isBusy = downloadState.status === 'queued' || downloadState.status === 'running'
  const canPreview = canPreviewItem(item)
  const canOpen = canOpenInDefaultApp(item)
  const isPreparingOpen = openState.status === 'preparing'
  const actionLabel =
    downloadState.status === 'succeeded' ? 'Download again' : isBusy ? 'Downloading...' : 'Download'
  const canPrimaryOpen = canPreview || canOpen
  const hasOverflowActions = !item.isDir
  const statusLabel = getListItemStatusLabel(item, downloadState, openState)
  const listPath = formatListPath(item)
  const primaryActionLabel = canPreview ? (isPreparingOpen ? 'Previewing...' : 'Preview') : (isPreparingOpen ? 'Opening...' : 'Open')

  return (
    <article
      className={`unified-item list-item ${isRowMenuOpen ? 'row-menu-open' : ''}`}
      data-row-id={item.id}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return
        }

        if (event.key === 'Enter' && canPrimaryOpen) {
          event.preventDefault()
          void onOpen(item)
        }
      }}
      onDoubleClick={() => {
        if (canPrimaryOpen) {
          void onOpen(item)
        }
      }}
    >
      <div className="item-primary">
        <div className="item-leading">
          <span className={`item-monogram ${item.category}`} aria-hidden="true">
            {getCategoryMonogram(item.category)}
          </span>
        </div>

        <div className="item-copy">
          <div className="item-title-row">
            <p className="item-name">{item.name}</p>
          </div>
        </div>
      </div>

      <p className="item-cell item-storage-cell">{item.sourceRemote}</p>
      <div className="item-path-cell">
        <div className="item-path-anchor">
          <p className="item-path">{listPath}</p>
          <span className="path-tooltip" role="tooltip">
            {listPath}
          </span>
        </div>
      </div>

      <p className="item-cell item-modified-cell">{formatModifiedTime(item.modTime)}</p>
      <p className="item-cell item-size-cell">{formatFileSize(item.size)}</p>

      <div className="item-status-cell">
        <p className={`item-status-label ${downloadState.status === 'failed' || openState.status === 'failed' ? 'danger' : ''}`}>{statusLabel}</p>
      </div>

      {hasOverflowActions ? (
        <div
          className="item-actions"
          aria-label="Row actions"
          data-row-menu-container="true"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <Button
            family="icon"
            size="sm"
            className="item-actions-trigger"
            type="button"
            aria-label={`More actions for ${item.name}`}
            aria-haspopup="menu"
            aria-expanded={isRowMenuOpen}
            onClick={onToggleRowMenu}
          >
            …
          </Button>

          {isRowMenuOpen ? (
            <div className="row-action-menu" role="menu" aria-label={`Actions for ${item.name}`}>
              {canPrimaryOpen ? (
                <RowMenuItem
                  disabled={isPreparingOpen}
                  onClick={() => {
                    onCloseRowMenu()
                    void onOpen(item)
                  }}
                >
                  {primaryActionLabel}
                </RowMenuItem>
              ) : null}
              <RowMenuItem
                disabled={isBusy}
                onClick={() => {
                  onCloseRowMenu()
                  void onDownload(item)
                }}
              >
                {actionLabel}
              </RowMenuItem>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
