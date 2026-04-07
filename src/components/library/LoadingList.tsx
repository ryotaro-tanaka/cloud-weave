type LoadingListProps = {
  count?: number
  className?: string
}

export function LoadingList({ count = 6, className = '' }: LoadingListProps) {
  const classes = className ? `loading-list ${className}` : 'loading-list'

  return (
    <div className={classes} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <article key={`loading-row-${index}`} className="unified-item list-item loading-row">
          <div className="item-primary">
            <div className="item-leading">
              <span className="item-monogram loading-monogram" />
            </div>

            <div className="item-copy">
              <div className="item-title-row">
                <span className="loading-placeholder name" />
              </div>
            </div>
          </div>

          <p className="item-cell item-storage-cell">
            <span className="loading-placeholder storage" />
          </p>

          <div className="item-path-cell">
            <span className="loading-placeholder path" />
          </div>

          <p className="item-cell item-modified-cell">
            <span className="loading-placeholder modified" />
          </p>

          <p className="item-cell item-size-cell">
            <span className="loading-placeholder size" />
          </p>

          <div className="item-status-cell">
            <span className="loading-placeholder status" />
          </div>
        </article>
      ))}
    </div>
  )
}
