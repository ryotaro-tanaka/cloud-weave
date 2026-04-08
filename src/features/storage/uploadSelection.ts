import type { UploadSelection } from './uploads'

export function normalizeDialogSelection(selection: string | string[] | null): string[] {
  if (!selection) {
    return []
  }

  return Array.isArray(selection) ? selection : [selection]
}

export function toUploadSelections(paths: string[], kind: UploadSelection['kind'] = 'file'): UploadSelection[] {
  return paths.map((path) => ({ path, kind }))
}

export function getUploadSelectionDisplayName(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/, '')

  if (!normalizedPath) {
    return path
  }

  const segments = normalizedPath.split('/')
  return segments[segments.length - 1] || normalizedPath
}
