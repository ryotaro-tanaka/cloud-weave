import { useEffect, useRef } from 'react'

type UseStartupSplashInput = {
  visibleMs: number
  fadeMs: number
  onStartExit: () => void
  onHide: () => void
}

export function useStartupSplash({ visibleMs, fadeMs, onStartExit, onHide }: UseStartupSplashInput) {
  const onStartExitRef = useRef(onStartExit)
  const onHideRef = useRef(onHide)
  onStartExitRef.current = onStartExit
  onHideRef.current = onHide

  useEffect(() => {
    document.getElementById('startup-static-splash')?.classList.add('is-hidden')

    const exitTimer = window.setTimeout(() => {
      onStartExitRef.current()
    }, visibleMs)

    const hideTimer = window.setTimeout(() => {
      onHideRef.current()
    }, visibleMs + fadeMs)

    return () => {
      window.clearTimeout(exitTimer)
      window.clearTimeout(hideTimer)
    }
  }, [fadeMs, visibleMs])
}

