import { useEffect, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { PreviewPayload } from '../../features/storage/openFiles'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalOverlay } from '../ui/ModalOverlay'
import { ModalSurface } from '../ui/ModalSurface'

const PREVIEW_ASSET_PROTOCOL = 'asset'

type PreviewModalProps = {
  payload: PreviewPayload
  onClose: () => void
}

export function PreviewModal({ payload, onClose }: PreviewModalProps) {
  const assetUrl = convertFileSrc(payload.localPath, PREVIEW_ASSET_PROTOCOL)
  const [previewUrl, setPreviewUrl] = useState<string | null>(payload.previewKind === 'image' ? assetUrl : null)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    if (payload.previewKind === 'image') {
      setPreviewUrl(assetUrl)
      setPreviewError('')
      return
    }

    let isActive = true
    let objectUrl: string | null = null

    setPreviewUrl(null)
    setPreviewError('')

    void fetch(assetUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Preview request failed with ${response.status}`)
        }

        const blob = await response.blob()
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))

        if (isActive) {
          setPreviewUrl(objectUrl)
        }
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return
        }

        setPreviewError(error instanceof Error ? error.message : 'The preview could not be displayed here.')
      })

    return () => {
      isActive = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [assetUrl, payload.previewKind])

  return (
    <ModalOverlay onRequestClose={onClose}>
      <ModalSurface surfaceClassName="preview-modal" labelledBy="preview-title">
        <ModalHeader
          eyebrow={payload.previewKind === 'image' ? 'Image Preview' : 'PDF Preview'}
          titleId="preview-title"
          title={payload.itemName}
          onClose={onClose}
          closeAriaLabel="Close preview"
        />

        <div className="preview-surface">
          {previewError ? (
            <div className="preview-fallback">
              <p>The preview could not be displayed here.</p>
              <p>{previewError}</p>
            </div>
          ) : payload.previewKind === 'image' && previewUrl ? (
            <img className="preview-image" src={assetUrl} alt={payload.itemName} />
          ) : payload.previewKind === 'pdf' && previewUrl ? (
            <object className="preview-frame" data={previewUrl} type="application/pdf" aria-label={payload.itemName}>
              <div className="preview-fallback">
                <p>PDF preview is unavailable in this view.</p>
              </div>
            </object>
          ) : (
            <div className="preview-fallback">
              <p>Loading preview...</p>
            </div>
          )}
        </div>
      </ModalSurface>
    </ModalOverlay>
  )
}

