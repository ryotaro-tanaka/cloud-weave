import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'

type ModalOverlayProps = {
  onRequestClose: () => void
  children: ReactNode
}

export function ModalOverlay({ onRequestClose, children }: ModalOverlayProps) {
  const handleBackdropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onRequestClose()
    }
  }

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onRequestClose()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onRequestClose()
    }
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  )
}
