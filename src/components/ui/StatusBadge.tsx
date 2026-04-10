import type { ReactNode } from 'react'
import './shared-utilities.css'

export type StatusBadgeTone = 'warning' | 'neutral'

type StatusBadgeProps = {
  tone: StatusBadgeTone
  children: ReactNode
}

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`storage-status-badge ${tone}`}>{children}</span>
}
