import { describe, expect, it } from 'vitest'
import {
  canOpenInDefaultApp,
  canPreviewItem,
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

  it('renders ready preview state', () => {
    expect(
      getOpenStateSummary(
        toReadyOpenState({
          requestId: '1',
          status: 'ready',
          localPath: 'C:/temp/file.docx',
          openMode: 'preview-pdf',
        }),
      ),
    ).toBe('Ready to preview')
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

  it('creates preview payloads for pdfs', () => {
    expect(
      toPreviewPayload('a', 'doc.docx', {
        requestId: '1',
        status: 'ready',
        localPath: 'C:/temp/doc.docx',
        openMode: 'preview-pdf',
      }),
    ).toEqual({
      itemId: 'a',
      itemName: 'doc.docx',
      localPath: 'C:/temp/doc.docx',
      previewKind: 'pdf',
    })
  })
})

describe('canPreviewItem', () => {
  it('allows images and pdfs only', () => {
    expect(canPreviewItem({ mimeType: 'image/jpeg', extension: 'jpg' })).toBe(true)
    expect(canPreviewItem({ mimeType: 'application/pdf', extension: 'pdf' })).toBe(true)
    expect(canPreviewItem({ mimeType: 'application/zip', extension: 'zip' })).toBe(false)
    expect(
      canPreviewItem({
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
      }),
    ).toBe(false)
  })
})

describe('canOpenInDefaultApp', () => {
  it('allows document files only', () => {
    expect(canOpenInDefaultApp({ mimeType: 'text/plain', extension: 'txt' })).toBe(true)
    expect(
      canOpenInDefaultApp({
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
      }),
    ).toBe(true)
    expect(canOpenInDefaultApp({ mimeType: 'application/zip', extension: 'zip' })).toBe(false)
    expect(canOpenInDefaultApp({ mimeType: 'image/jpeg', extension: 'jpg' })).toBe(false)
  })
})
