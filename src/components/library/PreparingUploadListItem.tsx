/** Row while local files are being hashed before they become `PreparedUploadItem`s. */
export type PreparingUploadListRow = {
  id: string
  displayName: string
}

export function PreparingUploadListItem({ item }: { item: PreparingUploadListRow }) {
  return (
    <article className="upload-queue-item preparing" role="listitem" aria-hidden="true">
      <p className="upload-item-name">{item.displayName}</p>
      <p className="upload-item-status">Preparing...</p>
      <p className="upload-item-path">
        <span className="upload-skeleton path" />
      </p>
      <p className="upload-item-storage">
        <span className="upload-skeleton storage" />
      </p>
    </article>
  )
}
