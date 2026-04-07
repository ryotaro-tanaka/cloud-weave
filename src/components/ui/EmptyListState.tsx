type EmptyListStateProps = {
  title: string
  description: string
}

export function EmptyListState({ title, description }: EmptyListStateProps) {
  return (
    <div className="empty-list-state" role="status" aria-live="polite">
      <div className="empty-list-copy">
        <p className="empty-list-title">{title}</p>
        <p className="empty-list-description">{description}</p>
      </div>
    </div>
  )
}
