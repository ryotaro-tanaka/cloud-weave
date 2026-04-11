import { useCallback, useEffect, useMemo } from 'react'
import type { RemoteSummary } from '../pendingState'

type Params = {
  remotes: RemoteSummary[]
  markIssuesRead: (issueIds?: string[]) => void
  recordIssueMessages: (messages: string[], source: string) => void
  setFocusedIssueId: (issueId: string | null) => void
  setIsIssuesModalOpen: (open: boolean) => void
}

/**
 * Workspace issue entry actions and reconnect-required issue reporting.
 * Keeps App.tsx focused on composition rather than issue wiring details.
 */
export function useWorkspaceIssueActions({
  remotes,
  markIssuesRead,
  recordIssueMessages,
  setFocusedIssueId,
  setIsIssuesModalOpen,
}: Params) {
  const reconnectRequiredRemotes = useMemo(
    () => remotes.filter((remote) => remote.status === 'reconnect_required'),
    [remotes],
  )

  const openIssuesModal = useCallback(
    (issueId?: string) => {
      setFocusedIssueId(issueId ?? null)
      setIsIssuesModalOpen(true)
      markIssuesRead(issueId ? [issueId] : undefined)
    },
    [markIssuesRead, setFocusedIssueId, setIsIssuesModalOpen],
  )

  useEffect(() => {
    for (const remote of reconnectRequiredRemotes) {
      recordIssueMessages([remote.message || `${remote.name} needs reconnect.`], `storage:${remote.name}`)
    }
  }, [reconnectRequiredRemotes, recordIssueMessages])

  return {
    openIssuesModal,
  }
}
