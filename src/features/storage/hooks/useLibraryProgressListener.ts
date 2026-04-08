import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { UnifiedLibraryLoadEvent } from '../libraryLoad'

type UseLibraryProgressListenerInput = {
  isDemoMode: boolean
  getActiveRequestId: () => string | null
  onProgress: (payload: UnifiedLibraryLoadEvent) => void
}

export function useLibraryProgressListener({
  isDemoMode,
  getActiveRequestId,
  onProgress,
}: UseLibraryProgressListenerInput) {
  const getActiveRequestIdRef = useRef(getActiveRequestId)
  const onProgressRef = useRef(onProgress)
  getActiveRequestIdRef.current = getActiveRequestId
  onProgressRef.current = onProgress

  useEffect(() => {
    if (isDemoMode) {
      return
    }

    let isSubscribed = true
    const unlistenPromise = listen<UnifiedLibraryLoadEvent>('library://progress', (event) => {
      if (!isSubscribed) {
        return
      }

      const payload = event.payload
      const activeRequestId = getActiveRequestIdRef.current()
      if (activeRequestId && payload.requestId !== activeRequestId) {
        return
      }

      onProgressRef.current(payload)
    })

    return () => {
      isSubscribed = false
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [isDemoMode])
}

