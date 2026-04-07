import { useEffect } from 'react'

type UseStartupSplashInput = {
  visibleMs: number
  fadeMs: number
  onStartExit: () => void
  onHide: () => void
}

export function useStartupSplash({ visibleMs, fadeMs, onStartExit, onHide }: UseStartupSplashInput) {
  useEffect(() => {
    document.getElementById('startup-static-splash')?.classList.add('is-hidden')

    const exitTimer = window.setTimeout(() => {
      onStartExit()
    }, visibleMs)

    const hideTimer = window.setTimeout(() => {
      onHide()
    }, visibleMs + fadeMs)

    return () => {
      window.clearTimeout(exitTimer)
      window.clearTimeout(hideTimer)
    }
  }, [fadeMs, onHide, onStartExit, visibleMs])
}

