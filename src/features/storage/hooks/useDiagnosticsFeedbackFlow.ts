import { useCallback, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openPath } from '@tauri-apps/plugin-shell'
import type { WorkspaceIssue } from '../../../state/workspaceData/WorkspaceDataContext'
import type { LogicalView } from '../unifiedItems'
import { BASIN_FEEDBACK_URL } from '../workspaceAppConstants'
import {
  buildDiagnosticsInput,
  inferFeedbackTypeFromIssue,
} from '../issuePresentation'
import type { ExportDiagnosticsResult } from '../tauriActionResults'
import { getFileName, getParentDirectory } from '../../../lib/pathUtils'

type ShowToast = (notice: {
  kind: 'info' | 'warning' | 'error' | 'success'
  message: string
  source: string
  actionLabel?: string
  action?: { type: 'open-upload' } | { type: 'open-path'; path: string } | { type: 'open-issues'; issueId?: string }
}) => void

/**
 * Diagnostics export + external feedback URL (Usecase layer; no JSX).
 * Complements WorkspaceData issue/toast recording.
 */
export function useDiagnosticsFeedbackFlow(params: {
  activeView: LogicalView
  workspaceIssues: WorkspaceIssue[]
  focusedIssue: WorkspaceIssue | null
  showToast: ShowToast
  setIsFeedbackPromptOpen: (open: boolean) => void
}) {
  const { activeView, workspaceIssues, focusedIssue, showToast, setIsFeedbackPromptOpen } = params
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false)
  const [isOpeningFeedbackForm, setIsOpeningFeedbackForm] = useState(false)
  const exportInFlightRef = useRef(false)

  const exportDiagnostics = useCallback(async () => {
    if (exportInFlightRef.current) {
      return null
    }

    exportInFlightRef.current = true
    setIsExportingDiagnostics(true)

    try {
      return await invoke<ExportDiagnosticsResult>('export_diagnostics', {
        input: buildDiagnosticsInput(activeView, workspaceIssues),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export diagnostics right now.'
      showToast({
        kind: 'error',
        message,
        source: 'feedback',
      })
      return null
    } finally {
      exportInFlightRef.current = false
      setIsExportingDiagnostics(false)
    }
  }, [activeView, showToast, workspaceIssues])

  const startFeedbackFlow = useCallback(async () => {
    if (exportInFlightRef.current || isOpeningFeedbackForm) {
      return
    }

    const diagnosticsResult = await exportDiagnostics()
    if (!diagnosticsResult) {
      return
    }

    setIsOpeningFeedbackForm(true)

    try {
      const feedbackUrl = new URL(BASIN_FEEDBACK_URL)
      const appVersion = '0.3.1'
      const feedbackType = inferFeedbackTypeFromIssue(focusedIssue)

      feedbackUrl.searchParams.set('app_version', appVersion)
      if (feedbackType) {
        feedbackUrl.searchParams.set('feedback_type', feedbackType)
      }

      await openPath(feedbackUrl.toString())
      setIsFeedbackPromptOpen(false)
      const zipFileName = getFileName(diagnosticsResult.zipPath)
      showToast({
        kind: 'success',
        message: `Feedback form opened. Attach ${zipFileName} from Downloads.`,
        source: 'feedback',
        actionLabel: 'Open Downloads',
        action: { type: 'open-path', path: getParentDirectory(diagnosticsResult.zipPath) },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open the feedback form.'
      showToast({
        kind: 'error',
        message,
        source: 'feedback',
      })
    } finally {
      setIsOpeningFeedbackForm(false)
    }
  }, [exportDiagnostics, focusedIssue, isOpeningFeedbackForm, setIsFeedbackPromptOpen, showToast])

  return {
    exportDiagnostics,
    startFeedbackFlow,
    isExportingDiagnostics,
    isOpeningFeedbackForm,
  }
}
