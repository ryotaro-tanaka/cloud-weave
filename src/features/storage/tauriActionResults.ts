export type ActionResult = {
  status: 'success' | 'error'
  message: string
}

export type ExportDiagnosticsResult = {
  status: 'success'
  diagnosticsDir: string
  summaryPath: string
  zipPath: string
  message: string
}
