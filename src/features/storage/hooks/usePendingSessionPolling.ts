import { useEffect } from 'react'
import type { PendingSession } from '../pendingState'

type UsePendingSessionPollingInput = {
  activeModal: 'none' | 'add-storage' | 'oauth-pending' | 'remove-confirm' | 'upload'
  pendingSession: PendingSession | null
  onTick: () => Promise<unknown> | unknown
}

export function usePendingSessionPolling({ activeModal, pendingSession, onTick }: UsePendingSessionPollingInput) {
  useEffect(() => {
    if (activeModal !== 'oauth-pending' || !pendingSession || pendingSession.status !== 'pending') {
      return
    }

    const intervalId = window.setInterval(() => {
      void onTick()
    }, 1500)

    return () => window.clearInterval(intervalId)
  }, [activeModal, onTick, pendingSession])
}

