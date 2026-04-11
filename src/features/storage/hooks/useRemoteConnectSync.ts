import { useCallback } from 'react'
import type { RemoteSummary } from '../pendingState'
import type { UnifiedItem } from '../unifiedItems'
import { CONNECT_SYNC_ATTEMPTS, CONNECT_SYNC_DELAY_MS } from '../workspaceAppConstants'

type SetRemotes = (next: RemoteSummary[] | ((current: RemoteSummary[]) => RemoteSummary[])) => void

/**
 * Post-OAuth polling to align Rust-reported remote state with optimistic UI.
 * Used by useRemoteAuthFlow; lives in usecase layer per react-responsibility-separation.md.
 */
export function useRemoteConnectSync(params: {
  setRemotes: SetRemotes
  fetchRemotes: (options?: { silent?: boolean }) => Promise<RemoteSummary[] | null>
  fetchUnifiedItems: (
    nextRemotes?: RemoteSummary[] | null,
    options?: { silent?: boolean },
  ) => Promise<UnifiedItem[] | null>
  refreshLibrary: (options?: { silent?: boolean }) => Promise<void>
}) {
  const { setRemotes, fetchRemotes, fetchUnifiedItems, refreshLibrary } = params

  const sleep = useCallback((ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms)), [])

  const upsertOptimisticConnectedRemote = useCallback(
    (remoteName: string, provider: string) => {
      setRemotes((current) => {
        const nextRemote: RemoteSummary = {
          name: remoteName,
          provider,
          status: 'connected',
          message: undefined,
        }

        const existingIndex = current.findIndex((entry) => entry.name === remoteName)

        if (existingIndex === -1) {
          return [...current, nextRemote].sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()))
        }

        const next = [...current]
        next[existingIndex] = nextRemote
        return next
      })
    },
    [setRemotes],
  )

  const synchronizeConnectedRemote = useCallback(
    async (remoteName: string, provider: string) => {
      upsertOptimisticConnectedRemote(remoteName, provider)

      for (let attempt = 1; attempt <= CONNECT_SYNC_ATTEMPTS; attempt += 1) {
        const latestRemotes = await fetchRemotes({ silent: true })
        const matchedRemote = latestRemotes?.find((entry) => entry.name === remoteName) ?? null

        console.info('[connect-sync]', {
          remoteName,
          provider,
          attempt,
          matchedRemoteStatus: matchedRemote?.status ?? null,
        })

        if (matchedRemote?.status === 'connected') {
          await fetchUnifiedItems(latestRemotes, { silent: true })
          return
        }

        if (attempt < CONNECT_SYNC_ATTEMPTS) {
          await sleep(CONNECT_SYNC_DELAY_MS)
        }
      }

      await refreshLibrary({ silent: true })
    },
    [fetchRemotes, fetchUnifiedItems, refreshLibrary, sleep, upsertOptimisticConnectedRemote],
  )

  return {
    synchronizeConnectedRemote,
  }
}
