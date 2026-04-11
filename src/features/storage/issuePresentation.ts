import type { IssueLevel, WorkspaceIssue } from '../../state/workspaceData/WorkspaceDataContext'
import type { LogicalView } from './unifiedItems'

export type DiagnosticsIssueSummary = {
  level: IssueLevel
  source: string
  timestamp: number
  message: string
}

export type ExportDiagnosticsInput = {
  currentLogicalView: LogicalView
  recentIssuesSummary: DiagnosticsIssueSummary[]
}

export function formatIssueTimestamp(timestamp: number): string {
  const parsed = new Date(timestamp)

  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown date'
  }

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  const hour = String(parsed.getHours()).padStart(2, '0')
  const minute = String(parsed.getMinutes()).padStart(2, '0')

  return `${year}/${month}/${day} ${hour}:${minute}`
}

export function describeIssueSource(source: string): string {
  if (source.startsWith('storage:')) {
    return source.replace('storage:', '')
  }

  if (source === 'library-stream') {
    return 'Unified library'
  }

  return 'Workspace'
}

export function inferFeedbackTypeFromIssue(issue: WorkspaceIssue | null): string | null {
  if (!issue) {
    return null
  }

  return issue.level === 'error' || issue.level === 'warning' ? 'Bug' : 'Other'
}

export function buildDiagnosticsInput(activeView: LogicalView, workspaceIssues: WorkspaceIssue[]): ExportDiagnosticsInput {
  return {
    currentLogicalView: activeView,
    recentIssuesSummary: workspaceIssues.slice(0, 10).map((issue) => ({
      level: issue.level,
      source: issue.source,
      timestamp: issue.timestamp,
      message: issue.message,
    })),
  }
}

export function describeIssueLocation(source: string): string {
  if (source.startsWith('storage:')) {
    return 'Relevant place: Storages'
  }

  return 'Relevant place: Issues'
}
