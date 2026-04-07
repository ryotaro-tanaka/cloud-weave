import type { ReactNode } from 'react'

export function LibraryMain({ children }: { children: ReactNode }) {
  return <div className="library-content">{children}</div>
}
