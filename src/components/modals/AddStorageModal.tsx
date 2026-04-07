import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/InlineError'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalOverlay } from '../ui/ModalOverlay'
import { ModalSurface } from '../ui/ModalSurface'

export type StorageProvider = 'onedrive' | 'gdrive' | 'dropbox' | 'icloud'
export type AuthType = 'oauth' | 'form'
export type AddFlowStep = 'providers' | 'form'

export type ProviderDefinition = {
  id: StorageProvider
  label: string
  authType: AuthType
  enabled: boolean
  description: string
}

export type CreateRemoteInput = {
  provider: StorageProvider
  remoteName: string
  clientId?: string
  clientSecret?: string
}

type AddStorageModalProps = {
  providers: ProviderDefinition[]
  onClose: () => void
  onCreateRemote: (input: CreateRemoteInput) => Promise<void>
}

export function AddStorageModal({ providers, onClose, onCreateRemote }: AddStorageModalProps) {
  const [addFlowStep, setAddFlowStep] = useState<AddFlowStep>('providers')
  const [selectedProvider, setSelectedProvider] = useState<StorageProvider>('onedrive')
  const [remoteName, setRemoteName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [addError, setAddError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const selectedProviderConfig = useMemo(
    () => providers.find((provider) => provider.id === selectedProvider) ?? providers[0],
    [providers, selectedProvider],
  )

  const openProviderForm = (providerId: StorageProvider) => {
    setSelectedProvider(providerId)
    setAddFlowStep('form')
    setAddError('')
  }

  const handleCreateRemote = async (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting) {
      return
    }

    if (!remoteName.trim()) {
      setAddError('Remote name is required.')
      return
    }

    setIsSubmitting(true)
    setAddError('')

    try {
      await onCreateRemote({
        provider: selectedProvider,
        remoteName: remoteName.trim(),
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
      })
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ModalOverlay onRequestClose={onClose}>
      <ModalSurface surfaceClassName="full-modal" labelledBy="add-storage-title">
        <ModalHeader
          eyebrow="Add Storage"
          titleId="add-storage-title"
          title={addFlowStep === 'providers' ? 'Choose a provider' : `Connect ${selectedProviderConfig.label}`}
          onClose={onClose}
          closeAriaLabel="Close modal"
        />

        {addFlowStep === 'providers' ? (
          <div className="provider-grid">
            {providers.map((provider) => (
              <button
                key={provider.id}
                className={`provider-option ${provider.enabled ? '' : 'disabled'}`}
                type="button"
                disabled={!provider.enabled}
                onClick={() => openProviderForm(provider.id)}
              >
                <span>{provider.label}</span>
                <small>{provider.description}</small>
              </button>
            ))}
          </div>
        ) : (
          <form className="connect-form" onSubmit={handleCreateRemote}>
            <div className="form-copy">
              <p>Authentication opens in your default browser. When you finish there, this app will keep checking for completion.</p>
            </div>

            <label className="field">
              <span>Remote name</span>
              <input
                value={remoteName}
                onChange={(event) => setRemoteName(event.target.value)}
                placeholder="onedrive-main"
                autoComplete="off"
              />
            </label>

            <details className="advanced-options">
              <summary>Advanced options</summary>

              <label className="field">
                <span>Client ID</span>
                <input value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" />
              </label>

              <label className="field">
                <span>Client Secret</span>
                <input
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  autoComplete="off"
                  type="password"
                />
              </label>
            </details>

            {addError ? <InlineError>{addError}</InlineError> : null}

            <div className="modal-actions">
              <Button family="secondary" type="button" onClick={() => setAddFlowStep('providers')}>
                Back
              </Button>
              <Button family="primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Starting...' : `Connect ${selectedProviderConfig.label}`}
              </Button>
            </div>
          </form>
        )}
      </ModalSurface>
    </ModalOverlay>
  )
}

