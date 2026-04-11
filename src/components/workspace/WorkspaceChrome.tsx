import { open as openPath } from '@tauri-apps/plugin-shell'
import { Button } from '../ui/Button'
import { ToastNoticeRow } from '../ui/ToastNoticeRow'
import { ToastStack } from '../ui/ToastStack'
import type { ToastNotice } from '../../state/workspaceData/WorkspaceDataContext'

type StartupSplashProps = {
  visible: boolean
  exiting: boolean
  lockupSrc: string
}

/**
 * Startup brand overlay (keeps shell chrome out of App.tsx).
 */
export function StartupSplashOverlay({ visible, exiting, lockupSrc }: StartupSplashProps) {
  if (!visible) {
    return null
  }

  return (
    <div className={`startup-splash ${exiting ? 'exiting' : 'visible'}`} aria-hidden="true">
      <div className="startup-splash-brand">
        <img className="startup-splash-lockup" src={lockupSrc} alt="" />
      </div>
    </div>
  )
}

type WorkspaceToastDockProps = {
  toasts: ToastNotice[]
  formatIssueTimestamp: (timestamp: number) => string
  onOpenUploadModal: () => void
  onOpenIssuesModal: (issueId?: string) => void
}

/**
 * Global toast stack for workspace chrome (action routing stays explicit via callbacks).
 */
export function WorkspaceToastDock({
  toasts,
  formatIssueTimestamp,
  onOpenUploadModal,
  onOpenIssuesModal,
}: WorkspaceToastDockProps) {
  if (toasts.length === 0) {
    return null
  }

  return (
    <ToastStack>
      {toasts.map((toast) => (
        <ToastNoticeRow
          key={toast.id}
          kind={toast.kind}
          message={toast.message}
          timestampLabel={formatIssueTimestamp(toast.timestamp)}
          action={
            toast.action ? (
              <Button
                family="secondary"
                size="sm"
                className="toast-action"
                type="button"
                onClick={() => {
                  const action = toast.action

                  if (!action) {
                    return
                  }

                  if (action.type === 'open-upload') {
                    onOpenUploadModal()
                    return
                  }

                  if (action.type === 'open-path') {
                    void openPath(action.path)
                    return
                  }

                  onOpenIssuesModal(action.issueId)
                }}
              >
                {toast.actionLabel}
              </Button>
            ) : null
          }
        />
      ))}
    </ToastStack>
  )
}
