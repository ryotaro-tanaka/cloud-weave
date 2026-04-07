import type { ReactNode } from 'react'

export function WorkspaceShell({ children }: { children: ReactNode }) {
  return <main className="workspace-shell">{children}</main>
}
