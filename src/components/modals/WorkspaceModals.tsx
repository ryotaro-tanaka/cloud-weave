import type { ReactNode } from 'react'

type WorkspaceModalsProps = {
  previewModal: ReactNode
  issuesModal: ReactNode
  feedbackModal: ReactNode
  addStorageModal: ReactNode
  oauthPendingModal: ReactNode
  removeConfirmModal: ReactNode
  uploadModal: ReactNode
}

export function WorkspaceModals({
  previewModal,
  issuesModal,
  feedbackModal,
  addStorageModal,
  oauthPendingModal,
  removeConfirmModal,
  uploadModal,
}: WorkspaceModalsProps) {
  return (
    <>
      {previewModal}
      {issuesModal}
      {feedbackModal}
      {addStorageModal}
      {oauthPendingModal}
      {removeConfirmModal}
      {uploadModal}
    </>
  )
}

