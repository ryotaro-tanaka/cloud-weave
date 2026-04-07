import type { ReactNode } from 'react'

export type StatusBadgeTone = 'warning' | 'neutral'

type StatusBadgeProps = {
  tone: StatusBadgeTone
  children: ReactNode
}

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`storage-status-badge ${tone}`}>{children}</span>
}
