import { useEffect, useRef } from 'react'

/**
 * While `isActive`, dismisses on Escape or pointer down outside the area
 * where `isInsideTarget` returns true.
 */
export function useDismissOnOutsideOrEscape(
  isActive: boolean,
  onDismiss: () => void,
  isInsideTarget: (target: Node) => boolean,
): void {
  const onDismissRef = useRef(onDismiss)
  const isInsideRef = useRef(isInsideTarget)
  onDismissRef.current = onDismiss
  isInsideRef.current = isInsideTarget

  useEffect(() => {
    if (!isActive) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (isInsideRef.current(target)) {
        return
      }

      onDismissRef.current()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismissRef.current()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActive])
}
