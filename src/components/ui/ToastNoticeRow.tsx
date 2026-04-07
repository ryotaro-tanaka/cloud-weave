import type { ReactNode } from 'react'

export type ToastNoticeKind = 'info' | 'warning' | 'error' | 'success'

type ToastNoticeRowProps = {
  kind: ToastNoticeKind
  message: string
  timestampLabel: string
  action?: ReactNode
}

export function ToastNoticeRow({ kind, message, timestampLabel, action }: ToastNoticeRowProps) {
  return (
    <div className={`toast-notice ${kind}`}>
      <div className="toast-copy">
        <p>{message}</p>
        <span>{timestampLabel}</span>
      </div>
      {action}
    </div>
  )
}
