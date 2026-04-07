import type { ReactNode } from 'react'

type ModalOverlayProps = {
  onRequestClose: () => void
  children: ReactNode
}

export function ModalOverlay({ onRequestClose, children }: ModalOverlayProps) {
  return (
    <div className="modal-overlay" role="presentation" onClick={onRequestClose}>
      {children}
    </div>
  )
}
