import { describe, expect, it } from 'vitest'
import {
  applyUploadProgressEvent,
  describeUploadTarget,
  getUploadBatchSummary,
  getUploadStateSummary,
  IDLE_UPLOAD_STATE,
  type PreparedUploadItem,
} from './uploads'

const item = (overrides: Partial<PreparedUploadItem> = {}): PreparedUploadItem => ({
  itemId: 'item-1',
  originalLocalPath: 'C:/Users/example/report.docx',
  relativePath: 'report.docx',
  displayName: 'report.docx',
  size: 1200,
  extension: '.docx',
  category: 'documents',
  candidates: [{ provider: 'onedrive', remoteName: 'onedrive-main', basePath: 'cloud-weave/documents' }],
  ...overrides,
})

describe('applyUploadProgressEvent', () => {
  it('creates state for a new upload item', () => {
    const next = applyUploadProgressEvent({}, { uploadId: 'upload-1', itemId: 'a', status: 'queued' })

    expect(next.a).toEqual({
      ...IDLE_UPLOAD_STATE,
      status: 'queued',
    })
  })

  it('preserves resolved destination values when later events omit them', () => {
    const next = applyUploadProgressEvent(
      {
        a: {
          status: 'running',
          provider: 'onedrive',
          remoteName: 'onedrive-main',
          remotePath: 'cloud-weave/documents/report.docx',
          completedCount: 0,
          totalCount: 2,
          errorMessage: null,
        },
      },
      { uploadId: 'upload-1', itemId: 'a', status: 'running', completedCount: 1, totalCount: 2 },
    )

    expect(next.a.provider).toBe('onedrive')
    expect(next.a.remotePath).toBe('cloud-weave/documents/report.docx')
    expect(next.a.completedCount).toBe(1)
  })
})

describe('getUploadStateSummary', () => {
  it('renders retrying state', () => {
    expect(
      getUploadStateSummary({
        ...IDLE_UPLOAD_STATE,
        status: 'retrying',
      }),
    ).toBe('Trying the next destination...')
  })
})

describe('getUploadBatchSummary', () => {
  it('counts completed and failed items', () => {
    const summary = getUploadBatchSummary(
      [item(), item({ itemId: 'item-2', relativePath: 'notes.txt', displayName: 'notes.txt', extension: '.txt' })],
      {
        'item-1': { ...IDLE_UPLOAD_STATE, status: 'succeeded' },
        'item-2': { ...IDLE_UPLOAD_STATE, status: 'failed', errorMessage: 'no space left' },
      },
    )

    expect(summary.completed).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.label).toBe('1 uploaded, 1 failed')
  })
})

describe('describeUploadTarget', () => {
  it('renders fallback count when more than one candidate exists', () => {
    expect(
      describeUploadTarget(
        item({
          candidates: [
            { provider: 'onedrive', remoteName: 'onedrive-main', basePath: 'cloud-weave/documents' },
            { provider: 'dropbox', remoteName: 'dropbox-main', basePath: 'cloud-weave/documents' },
          ],
        }),
      ),
    ).toBe('OneDrive (onedrive-main) +1 fallback')
  })
})
