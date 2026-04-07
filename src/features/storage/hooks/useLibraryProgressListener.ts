import { useEffect } from 'react'
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
      const activeRequestId = getActiveRequestId()
      if (activeRequestId && payload.requestId !== activeRequestId) {
        return
      }

      onProgress(payload)
    })

    return () => {
      isSubscribed = false
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [getActiveRequestId, isDemoMode, onProgress])
}

