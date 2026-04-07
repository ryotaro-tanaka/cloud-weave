import { Button } from '../ui/Button'
import { InlineError } from '../ui/InlineError'
import { MainEmptyState } from '../ui/MainEmptyState'
import { ListHeader } from '../library/ListHeader'
import { LoadingList } from '../library/LoadingList'

type LibraryMainStateViewProps = {
  itemsError: string
  shouldShowNoStorageState: boolean
  shouldShowLoadingList: boolean
  hasConnectedStorage: boolean
  onOpenAddStorage: () => void
  onOpenUpload: () => void
}

export function LibraryMainStateView({
  itemsError,
  shouldShowNoStorageState,
  shouldShowLoadingList,
  hasConnectedStorage,
  onOpenAddStorage,
  onOpenUpload,
}: LibraryMainStateViewProps) {
  return (
    <>
      {!shouldShowNoStorageState && itemsError ? <InlineError>{itemsError}</InlineError> : null}

      {shouldShowNoStorageState ? (
        <MainEmptyState
          eyebrow="Unified Library"
          title="Your files will appear here."
          description="Connect a storage from the sidebar to start browsing everything in one place."
        >
          <Button family="secondary" type="button" onClick={onOpenAddStorage}>
            Connect storage
          </Button>
          <Button family="primary" type="button" onClick={onOpenUpload} disabled={!hasConnectedStorage}>
            Upload
          </Button>
        </MainEmptyState>
      ) : null}

      {shouldShowLoadingList ? (
        <>
          <p className="loading-list-copy" role="status" aria-live="polite">
            Loading files...
          </p>
          <ListHeader />
          <LoadingList />
        </>
      ) : null}
    </>
  )
}

