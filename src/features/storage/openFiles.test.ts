import { describe, expect, it } from 'vitest'
import {
  getOpenStateSummary,
  IDLE_OPEN_STATE,
  toFailedOpenState,
  toPreviewPayload,
  toReadyOpenState,
} from './openFiles'

describe('getOpenStateSummary', () => {
  it('renders preparing state', () => {
    expect(getOpenStateSummary({ ...IDLE_OPEN_STATE, status: 'preparing' })).toBe('Preparing file...')
  })

  it('renders ready system state', () => {
    expect(
      getOpenStateSummary(
        toReadyOpenState({
          requestId: '1',
          status: 'ready',
          localPath: 'C:/temp/file.docx',
          openMode: 'system-default',
        }),
      ),
    ).toBe('Opened in your default app')
  })

  it('renders failure state', () => {
    expect(getOpenStateSummary(toFailedOpenState('Access denied'))).toBe('Access denied')
  })
})

describe('toPreviewPayload', () => {
  it('creates preview payloads for images', () => {
    expect(
      toPreviewPayload('a', 'photo.jpg', {
        requestId: '1',
        status: 'ready',
        localPath: 'C:/temp/photo.jpg',
        openMode: 'preview-image',
      }),
    ).toEqual({
      itemId: 'a',
      itemName: 'photo.jpg',
      localPath: 'C:/temp/photo.jpg',
      previewKind: 'image',
    })
  })

  it('returns null for system default mode', () => {
    expect(
      toPreviewPayload('a', 'doc.docx', {
        requestId: '1',
        status: 'ready',
        localPath: 'C:/temp/doc.docx',
        openMode: 'system-default',
      }),
    ).toBeNull()
  })
})
