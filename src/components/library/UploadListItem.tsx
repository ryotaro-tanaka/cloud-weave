import type { PreparedUploadItem, UploadState } from '../../features/storage/uploads'
import { getUploadListPath, getUploadListStatusLabel, getUploadListStorage } from './uploadListFormat'

type UploadListItemProps = {
  item: PreparedUploadItem
  state: UploadState
}

export function UploadListItem({ item, state }: UploadListItemProps) {
  const pathLabel = getUploadListPath(item, state)
  const storageLabel = getUploadListStorage(item, state)

  return (
    <article className="upload-queue-item" role="listitem">
      <p className="upload-item-name">{item.displayName}</p>
      <p className={`upload-item-status ${state.status === 'failed' ? 'danger' : ''}`}>{getUploadListStatusLabel(state)}</p>
      <p className="upload-item-path">{pathLabel}</p>
      <p className="upload-item-storage">{storageLabel}</p>
    </article>
  )
}
