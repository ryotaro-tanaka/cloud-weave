import { describe, expect, it } from 'vitest'
import { applyDownloadProgressEvent, getDownloadStateSummary, IDLE_DOWNLOAD_STATE } from './downloads'

describe('applyDownloadProgressEvent', () => {
  it('creates state for a new download', () => {
    const next = applyDownloadProgressEvent({}, { downloadId: 'a', status: 'queued' })

    expect(next.a).toEqual({
      ...IDLE_DOWNLOAD_STATE,
      status: 'queued',
    })
  })

  it('preserves previous values when an event omits optional fields', () => {
    const next = applyDownloadProgressEvent(
      {
        a: {
          status: 'running',
          progressPercent: 42,
          bytesTransferred: 420,
          totalBytes: 1000,
          targetPath: 'C:/Users/example/Downloads/file.txt',
          errorMessage: null,
        },
      },
      { downloadId: 'a', status: 'running' },
    )

    expect(next.a.progressPercent).toBe(42)
    expect(next.a.bytesTransferred).toBe(420)
    expect(next.a.targetPath).toBe('C:/Users/example/Downloads/file.txt')
  })

  it('stores failure messages', () => {
    const next = applyDownloadProgressEvent({}, { downloadId: 'a', status: 'failed', errorMessage: 'Access denied' })

    expect(next.a.errorMessage).toBe('Access denied')
  })
})

describe('getDownloadStateSummary', () => {
  it('renders running state with percentage', () => {
    expect(
      getDownloadStateSummary({
        ...IDLE_DOWNLOAD_STATE,
        status: 'running',
        progressPercent: 54,
      }),
    ).toBe('Downloading 54%')
  })

  it('renders success state', () => {
    expect(
      getDownloadStateSummary({
        ...IDLE_DOWNLOAD_STATE,
        status: 'succeeded',
      }),
    ).toBe('Saved to Downloads')
  })
})
