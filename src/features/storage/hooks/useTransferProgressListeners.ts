import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { DownloadProgressEvent } from '../downloads'
import type { UploadProgressEvent } from '../uploads'

type UseTransferProgressListenersInput = {
  isDemoMode: boolean
  onDownloadProgress: (event: DownloadProgressEvent) => void
  onUploadProgress: (event: UploadProgressEvent) => void
}

export function useTransferProgressListeners({
  isDemoMode,
  onDownloadProgress,
  onUploadProgress,
}: UseTransferProgressListenersInput) {
  useEffect(() => {
    if (isDemoMode) {
      return
    }

    let isSubscribed = true
    const unlistenPromise = listen<DownloadProgressEvent>('download://progress', (event) => {
      if (!isSubscribed) {
        return
      }
      onDownloadProgress(event.payload)
    })

    return () => {
      isSubscribed = false
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [isDemoMode, onDownloadProgress])

  useEffect(() => {
    if (isDemoMode) {
      return
    }

    let isSubscribed = true
    const unlistenPromise = listen<UploadProgressEvent>('upload://progress', (event) => {
      if (!isSubscribed) {
        return
      }
      onUploadProgress(event.payload)
    })

    return () => {
      isSubscribed = false
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [isDemoMode, onUploadProgress])
}

