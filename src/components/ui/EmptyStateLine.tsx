import type { ReactNode } from 'react'

/** Short single-line empty / loading hint (`.empty-state`). */
export function EmptyStateLine({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>
}
