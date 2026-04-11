import type { ReactNode } from 'react'

type ToastStackProps = {
  children: ReactNode
}

export function ToastStack({ children }: ToastStackProps) {
  return (
    <div className="toast-stack" aria-live="polite" aria-label="Workspace notifications">
      {children}
    </div>
  )
}
