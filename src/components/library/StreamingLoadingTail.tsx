import { LoadingList } from './LoadingList'

export function StreamingLoadingTail() {
  return (
    <>
      <p className="loading-list-copy streaming-tail" role="status" aria-live="polite">
        Loading more files...
      </p>
      <LoadingList count={3} className="streaming-tail" />
    </>
  )
}
