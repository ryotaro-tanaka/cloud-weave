import type { ReactNode } from 'react'
import './shared-utilities.css'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type MainEmptyStateProps = {
  eyebrow: ReactNode
  title: ReactNode
  description: ReactNode
  children?: ReactNode
  /** Extra classes on the root, e.g. `compact issues-empty-state` */
  className?: string
  /** Default `h1` for library hero; use `h2` for compact panels (e.g. issues list). */
  titleLevel?: 'h1' | 'h2'
}

export function MainEmptyState({
  eyebrow,
  title,
  description,
  children,
  className,
  titleLevel = 'h1',
}: MainEmptyStateProps) {
  const TitleTag = titleLevel === 'h2' ? 'h2' : 'h1'

  return (
    <div className={cx('main-empty-state', className)}>
      <p className="eyebrow">{eyebrow}</p>
      <TitleTag>{title}</TitleTag>
      <p>{description}</p>
      {children ? <div className="empty-state-actions">{children}</div> : null}
    </div>
  )
}
