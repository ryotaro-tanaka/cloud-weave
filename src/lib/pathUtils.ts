export function getParentDirectory(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))

  if (lastSeparatorIndex <= 0) {
    return path
  }

  return normalized.slice(0, lastSeparatorIndex)
}

export function getFileName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))

  if (lastSeparatorIndex < 0) {
    return normalized
  }

  return normalized.slice(lastSeparatorIndex + 1)
}
