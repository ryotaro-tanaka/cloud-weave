import type { ReactNode } from 'react'
import { Button } from './Button'

type ModalHeaderProps = {
  eyebrow: ReactNode
  titleId: string
  title: ReactNode
  onClose: () => void
  closeAriaLabel: string
}

export function ModalHeader({ eyebrow, titleId, title, onClose, closeAriaLabel }: ModalHeaderProps) {
  return (
    <div className="modal-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
      </div>

      <Button family="icon" size="sm" className="modal-close" type="button" onClick={onClose} aria-label={closeAriaLabel}>
        ×
      </Button>
    </div>
  )
}
