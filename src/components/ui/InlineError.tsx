import type { ReactNode } from 'react'

type InlineErrorProps = {
  children: ReactNode
}

export function InlineError({ children }: InlineErrorProps) {
  return <p className="error-text">{children}</p>
}
