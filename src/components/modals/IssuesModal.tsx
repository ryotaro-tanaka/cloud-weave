import { Button } from '../ui/Button'
import { MainEmptyState } from '../ui/MainEmptyState'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalOverlay } from '../ui/ModalOverlay'
import { ModalSurface } from '../ui/ModalSurface'
import { StatusBadge } from '../ui/StatusBadge'
import type { WorkspaceIssue } from '../../state/workspaceData/WorkspaceDataContext'

type IssuesModalProps = {
  issues: WorkspaceIssue[]
  focusedIssueId: string | null
  onReportIssue: () => void
  onClose: () => void
  formatIssueTimestamp: (timestamp: number) => string
  describeIssueSource: (source: string) => string
  describeIssueLocation: (source: string) => string
}

export function IssuesModal({
  issues,
  focusedIssueId,
  onReportIssue,
  onClose,
  formatIssueTimestamp,
  describeIssueSource,
  describeIssueLocation,
}: IssuesModalProps) {
  return (
    <ModalOverlay onRequestClose={onClose}>
      <ModalSurface surfaceClassName="issues-modal" labelledBy="issues-title">
        <ModalHeader
          eyebrow="Issues"
          titleId="issues-title"
          title="Workspace issues"
          onClose={onClose}
          closeAriaLabel="Close issues modal"
        />

        <div className="issues-feedback-actions">
          <Button family="secondary" size="sm" type="button" onClick={onReportIssue}>
            Report issue
          </Button>
        </div>

        {issues.length === 0 ? (
          <MainEmptyState
            className="compact issues-empty-state"
            eyebrow="Issues"
            title="No issues right now."
            description="Cloud Weave will show skipped folders, reconnect problems, and similar notices here."
            titleLevel="h2"
          />
        ) : (
          <div className="issues-list" role="list" aria-label="Workspace issues">
            {issues.map((issue) => (
              <article
                key={issue.id}
                className={`issue-item ${issue.level} ${focusedIssueId === issue.id ? 'focused' : ''}`}
                role="listitem"
              >
                <div className="issue-item-header">
                  <StatusBadge tone={issue.level === 'error' ? 'warning' : 'neutral'}>{issue.level}</StatusBadge>
                  <span className="issue-item-time">{formatIssueTimestamp(issue.timestamp)}</span>
                </div>
                <p className="issue-item-message">{issue.message}</p>
                <div className="issue-item-meta">
                  <span>{describeIssueSource(issue.source)}</span>
                  <span>{describeIssueLocation(issue.source)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </ModalSurface>
    </ModalOverlay>
  )
}

