import type { ReactNode } from 'react'

type ModalSurfaceProps = {
  /** Space-separated class names, e.g. `full-modal pending-modal` */
  surfaceClassName: string
  labelledBy: string
  children: ReactNode
}

export function ModalSurface({ surfaceClassName, labelledBy, children }: ModalSurfaceProps) {
  return (
    <div
      className={surfaceClassName}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}
