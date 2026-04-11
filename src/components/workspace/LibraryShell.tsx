import type { ReactNode } from 'react'

type LibraryShellProps = {
  topbar: ReactNode
  children: ReactNode
}

export function LibraryShell({ topbar, children }: LibraryShellProps) {
  return (
    <section className="workspace-main">
      <div className="library-shell">
        {topbar}
        {children}
      </div>
    </section>
  )
}
