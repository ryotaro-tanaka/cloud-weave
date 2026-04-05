import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { open as openPath } from '@tauri-apps/plugin-shell'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  isCallbackStartupFailure,
  overlayPendingRemote,
  resolvePendingSession,
  type AuthSessionRecord,
  type AuthSessionStage,
  type OneDriveDriveCandidate,
  type PendingMode,
  type PendingSession,
  type RemoteSummary,
} from './features/storage/pendingState'
import {
  filterItemsByView,
  formatFileSize,
  formatModifiedTime,
  getCategoryLabel,
  getCategoryMonogram,
  groupRecentItems,
  searchUnifiedItems,
  sortUnifiedItems,
  type LogicalView,
  type UnifiedItemSortKey,
  type UnifiedItem,
} from './features/storage/unifiedItems'
import { getDemoLibraryState, type DemoLibraryState } from './features/storage/demoLibrary'
import {
  applyDownloadProgressEvent,
  IDLE_DOWNLOAD_STATE,
  type DownloadAcceptedResult,
  type DownloadProgressEvent,
  type DownloadRequest,
  type DownloadState,
} from './features/storage/downloads'
import {
  canOpenInDefaultApp,
  canPreviewItem,
  IDLE_OPEN_STATE,
  toFailedOpenState,
  toPreparingOpenState,
  toPreviewPayload,
  toReadyOpenState,
  type OpenRequest,
  type OpenResult,
  type OpenState,
  type PreviewPayload,
} from './features/storage/openFiles'
import {
  mergeUnifiedItems,
  type StartUnifiedLibraryLoadResult,
  type UnifiedLibraryLoadEvent,
} from './features/storage/libraryLoad'
import {
  applyUploadProgressEvent,
  getUploadBatchSummary,
  IDLE_UPLOAD_STATE,
  type PreparedUploadBatch,
  type PreparedUploadItem,
  type UploadAcceptedResult,
  type UploadProgressEvent,
  type UploadSelection,
  type UploadState,
} from './features/storage/uploads'
import { Button } from './components/ui/Button'
import splashLockup from '../assets/brand/cloud-weave-lockup.png'
import './App.css'

type StorageProvider = 'onedrive' | 'gdrive' | 'dropbox' | 'icloud'
type AuthType = 'oauth' | 'form'
type ModalName = 'none' | 'add-storage' | 'oauth-pending' | 'remove-confirm' | 'upload'
type AddFlowStep = 'providers' | 'form'

type CreateOneDriveRemoteInput = {
  remoteName: string
  clientId?: string
  clientSecret?: string
}

type CreateRemoteResult = {
  remoteName: string
  provider: string
  status: 'connected' | 'pending' | 'requires_drive_selection' | 'error'
  stage?: AuthSessionStage | null
  nextStep: 'done' | 'open_browser' | 'retry' | 'rename' | 'select_drive'
  message: string
  errorCode?: string | null
  driveCandidates?: OneDriveDriveCandidate[] | null
}

type ActionResult = {
  status: 'success' | 'error'
  message: string
}

type ExportDiagnosticsResult = {
  status: 'success'
  diagnosticsDir: string
  summaryPath: string
  zipPath: string
  message: string
}

type DiagnosticsIssueSummary = {
  level: IssueLevel
  source: string
  timestamp: number
  message: string
}

type ExportDiagnosticsInput = {
  currentLogicalView: LogicalView
  recentIssuesSummary: DiagnosticsIssueSummary[]
}

type UnifiedLibraryResult = {
  items: UnifiedItem[]
  notices: string[]
}

type DownloadStateMap = Record<string, DownloadState>
type OpenStateMap = Record<string, OpenState>
type UploadStateMap = Record<string, UploadState>
type LibraryLoadProgress = {
  requestId: string | null
  loadedRemoteCount: number
  totalRemoteCount: number
}
type IssueLevel = 'info' | 'warning' | 'error'
type WorkspaceIssue = {
  id: string
  message: string
  level: IssueLevel
  timestamp: number
  source: string
  read: boolean
}
type ToastKind = 'info' | 'warning' | 'error' | 'success'
type ToastAction =
  | { type: 'open-upload' }
  | { type: 'open-issues'; issueId?: string }
  | { type: 'open-path'; path: string }
type ToastNotice = {
  id: string
  kind: ToastKind
  message: string
  timestamp: number
  source: string
  actionLabel?: string
  action?: ToastAction
}
type PreparingUploadItem = {
  id: string
  displayName: string
}

type ProviderDefinition = {
  id: StorageProvider
  label: string
  authType: AuthType
  enabled: boolean
  description: string
}

const STORAGE_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'onedrive',
    label: 'OneDrive',
    authType: 'oauth',
    enabled: true,
    description: 'Connect with Microsoft in your browser',
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    authType: 'oauth',
    enabled: false,
    description: 'Coming next',
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    authType: 'oauth',
    enabled: false,
    description: 'Planned after Google Drive',
  },
  {
    id: 'icloud',
    label: 'iCloud Drive',
    authType: 'form',
    enabled: false,
    description: 'Needs separate support work',
  },
]

const PRIMARY_NAV_ITEMS: Array<{ id: LogicalView; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'documents', label: 'Documents' },
  { id: 'photos', label: 'Photos' },
  { id: 'videos', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'other', label: 'Other' },
]
const EMPTY_PENDING_MESSAGE = 'Complete authentication in your browser.'
const PREVIEW_ASSET_PROTOCOL = 'asset'
const CONNECT_SUCCESS_MESSAGE = 'Your storage is connected and ready to use.'
const CONNECT_SYNC_ATTEMPTS = 8
const CONNECT_SYNC_DELAY_MS = 500
const TOAST_DURATION_MS = 5000
const STARTUP_SPLASH_VISIBLE_MS = 3000
const STARTUP_SPLASH_FADE_MS = 260
const BASIN_FEEDBACK_URL = 'https://usebasin.com/form/37c12519bb6c/hosted/46b7f138fca3'
const SORT_OPTIONS: Array<{ value: UnifiedItemSortKey; label: string }> = [
  { value: 'updated-desc', label: 'Newest' },
  { value: 'updated-asc', label: 'Oldest' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
  { value: 'size-desc', label: 'Size ↓' },
  { value: 'size-asc', label: 'Size ↑' },
]

function isScreenshotDemoEnabled(): boolean {
  return import.meta.env.VITE_SCREENSHOT_DEMO === '1'
}

function getDefaultSortKey(view: LogicalView): UnifiedItemSortKey {
  return view === 'recent' ? 'updated-desc' : 'name-asc'
}

function getSortLabel(sortKey: UnifiedItemSortKey): string {
  return SORT_OPTIONS.find((option) => option.value === sortKey)?.label ?? 'Newest'
}

function inferIssueLevel(message: string): IssueLevel {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('failed') ||
    normalized.includes('error') ||
    normalized.includes('could not') ||
    normalized.includes('cannot')
  ) {
    return 'error'
  }

  if (normalized.includes('reconnect') || normalized.includes('skipped') || normalized.includes('unsupported')) {
    return 'warning'
  }

  return 'info'
}

function toIssueId(message: string, source: string): string {
  return `${source}:${message.trim().toLowerCase()}`
}

function formatIssueTimestamp(timestamp: number): string {
  const parsed = new Date(timestamp)

  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown date'
  }

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  const hour = String(parsed.getHours()).padStart(2, '0')
  const minute = String(parsed.getMinutes()).padStart(2, '0')

  return `${year}/${month}/${day} ${hour}:${minute}`
}

function getParentDirectory(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))

  if (lastSeparatorIndex <= 0) {
    return path
  }

  return normalized.slice(0, lastSeparatorIndex)
}

function getFileName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))

  if (lastSeparatorIndex < 0) {
    return normalized
  }

  return normalized.slice(lastSeparatorIndex + 1)
}

function describeIssueSource(source: string): string {
  if (source.startsWith('storage:')) {
    return source.replace('storage:', '')
  }

  if (source === 'library-stream') {
    return 'Unified library'
  }

  return 'Workspace'
}

function inferFeedbackTypeFromIssue(issue: WorkspaceIssue | null): string | null {
  if (!issue) {
    return null
  }

  return issue.level === 'error' || issue.level === 'warning' ? 'Bug' : 'Other'
}

function buildDiagnosticsInput(activeView: LogicalView, workspaceIssues: WorkspaceIssue[]): ExportDiagnosticsInput {
  return {
    currentLogicalView: activeView,
    recentIssuesSummary: workspaceIssues.slice(0, 10).map((issue) => ({
      level: issue.level,
      source: issue.source,
      timestamp: issue.timestamp,
      message: issue.message,
    })),
  }
}

function describeIssueLocation(source: string): string {
  if (source.startsWith('storage:')) {
    return 'Relevant place: Storages'
  }

  return 'Relevant place: Issues'
}

function getListItemStatusLabel(item: UnifiedItem, downloadState: DownloadState, openState: OpenState): string {
  if (downloadState.status === 'failed') {
    return 'Download failed'
  }

  if (openState.status === 'failed') {
    return 'Open failed'
  }

  if (downloadState.status === 'queued' || downloadState.status === 'running') {
    return 'Downloading'
  }

  if (downloadState.status === 'succeeded') {
    return 'Downloaded'
  }

  if (openState.status === 'preparing') {
    return canPreviewItem(item) ? 'Preparing preview' : 'Opening'
  }

  if (openState.status === 'ready') {
    return openState.openMode === 'system-default' ? 'Opened' : 'Ready to preview'
  }

  if (item.isDir) {
    return 'Folder'
  }

  if (canPreviewItem(item)) {
    return 'Preview'
  }

  if (canOpenInDefaultApp(item)) {
    return 'Ready'
  }

  return 'Ready'
}

function App() {
  const [demoState] = useState<DemoLibraryState | null>(() => (isScreenshotDemoEnabled() ? getDemoLibraryState() : null))
  const isDemoMode = demoState !== null
  const [activeModal, setActiveModal] = useState<ModalName>('none')
  const [addFlowStep, setAddFlowStep] = useState<AddFlowStep>('providers')
  const [selectedProvider, setSelectedProvider] = useState<StorageProvider>('onedrive')
  const [activeView, setActiveView] = useState<LogicalView>('recent')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<UnifiedItemSortKey>(getDefaultSortKey('recent'))
  const [remotes, setRemotes] = useState<RemoteSummary[]>(() => demoState?.remotes ?? [])
  const [unifiedItems, setUnifiedItems] = useState<UnifiedItem[]>(() => demoState?.items ?? [])
  const [workspaceIssues, setWorkspaceIssues] = useState<WorkspaceIssue[]>([])
  const [toastNotices, setToastNotices] = useState<ToastNotice[]>([])
  const [isIssuesModalOpen, setIsIssuesModalOpen] = useState(false)
  const [focusedIssueId, setFocusedIssueId] = useState<string | null>(null)
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false)
  const [openRowMenuItemId, setOpenRowMenuItemId] = useState<string | null>(null)
  const [isStartupSplashVisible, setIsStartupSplashVisible] = useState(true)
  const [isStartupSplashExiting, setIsStartupSplashExiting] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<RemoteSummary | null>(null)
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null)
  const [selectedDriveId, setSelectedDriveId] = useState('')
  const [isLoadingRemotes, setIsLoadingRemotes] = useState(!isDemoMode)
  const [isLoadingItems, setIsLoadingItems] = useState(!isDemoMode)
  const [isLibraryStreaming, setIsLibraryStreaming] = useState(false)
  const [isRefreshingItems, setIsRefreshingItems] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFinalizingDrive, setIsFinalizingDrive] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [remoteName, setRemoteName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [listError, setListError] = useState('')
  const [itemsError, setItemsError] = useState('')
  const [addError, setAddError] = useState('')
  const [removeError, setRemoveError] = useState('')
  const [downloadStates, setDownloadStates] = useState<DownloadStateMap>({})
  const [openStates, setOpenStates] = useState<OpenStateMap>({})
  const [uploadStates, setUploadStates] = useState<UploadStateMap>({})
  const [uploadBatch, setUploadBatch] = useState<PreparedUploadBatch | null>(null)
  const [preparingUploadItems, setPreparingUploadItems] = useState<PreparingUploadItem[]>([])
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | null>(null)
  const [isFeedbackPromptOpen, setIsFeedbackPromptOpen] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [isPreparingUpload, setIsPreparingUpload] = useState(false)
  const [isStartingUpload, setIsStartingUpload] = useState(false)
  const [isUploadDragActive, setIsUploadDragActive] = useState(false)
  const [hasPendingUploadRefresh, setHasPendingUploadRefresh] = useState(false)
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false)
  const [isOpeningFeedbackForm, setIsOpeningFeedbackForm] = useState(false)
  const [, setLibraryLoadProgress] = useState<LibraryLoadProgress>({
    requestId: null,
    loadedRemoteCount: 0,
    totalRemoteCount: 0,
  })
  const activeLibraryRequestIdRef = useRef<string | null>(null)
  const toastTimeoutsRef = useRef<Record<string, number>>({})
  const sortMenuRef = useRef<HTMLDivElement | null>(null)
  const lastUploadOutcomeRef = useRef<{ completed: number; failed: number } | null>(null)

  const selectedProviderConfig = useMemo(
    () => STORAGE_PROVIDERS.find((provider) => provider.id === selectedProvider) ?? STORAGE_PROVIDERS[0],
    [selectedProvider],
  )

  const displayedItems = useMemo(() => {
    const viewItems = filterItemsByView(unifiedItems, activeView)
    const searchResults = searchUnifiedItems(viewItems, searchQuery)
    return sortUnifiedItems(searchResults, sortKey)
  }, [activeView, searchQuery, sortKey, unifiedItems])

  const displayedRemotes = useMemo(() => overlayPendingRemote(remotes, pendingSession), [pendingSession, remotes])
  const pendingHasCallbackStartupFailure = pendingSession ? isCallbackStartupFailure(pendingSession.errorCode) : false
  const pendingIsFinalizing = pendingSession?.stage === 'finalizing'
  const reconnectRequiredRemotes = useMemo(
    () => remotes.filter((remote) => remote.status === 'reconnect_required'),
    [remotes],
  )
  const unreadIssueCount = useMemo(() => workspaceIssues.filter((issue) => !issue.read).length, [workspaceIssues])
  const visibleToasts = toastNotices
  const focusedIssue = useMemo(
    () => (focusedIssueId ? workspaceIssues.find((issue) => issue.id === focusedIssueId) ?? null : null),
    [focusedIssueId, workspaceIssues],
  )

  const groupedRecentItems = useMemo(() => {
    if (activeView !== 'recent' || sortKey !== 'updated-desc') {
      return []
    }

    return groupRecentItems(displayedItems)
  }, [activeView, displayedItems, sortKey])

  const uploadSummary = useMemo(
    () => getUploadBatchSummary(uploadBatch?.items ?? [], uploadStates),
    [uploadBatch, uploadStates],
  )
  const uploadListItems = useMemo(() => {
    if (!uploadBatch) {
      return []
    }

    return uploadBatch.items.map((item) => ({
      item,
      state: uploadStates[item.itemId] ?? IDLE_UPLOAD_STATE,
    }))
  }, [uploadBatch, uploadStates])
  const hasUploadItems = uploadListItems.length > 0
  const hasReadyUploads = uploadListItems.some(({ state }) => state.status === 'idle')
  const shouldShowPreparingUploadList = isPreparingUpload && preparingUploadItems.length > 0
  const currentViewLabel = getCategoryLabel(activeView)

  const dismissToast = (toastId: string) => {
    const timeoutId = toastTimeoutsRef.current[toastId]
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      delete toastTimeoutsRef.current[toastId]
    }

    setToastNotices((current) => current.filter((toast) => toast.id !== toastId))
  }

  const showToast = ({
    kind,
    message,
    source,
    actionLabel,
    action,
  }: {
    kind: ToastKind
    message: string
    source: string
    actionLabel?: string
    action?: ToastAction
  }) => {
    const timestamp = Date.now()
    const toastId = `toast:${source}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`

    toastTimeoutsRef.current[toastId] = window.setTimeout(() => {
      dismissToast(toastId)
    }, TOAST_DURATION_MS)

    setToastNotices((current) => [
      {
        id: toastId,
        kind,
        message,
        timestamp,
        source,
        actionLabel,
        action,
      },
      ...current,
    ])
  }

  const markIssuesRead = (issueIds?: string[]) => {
    setWorkspaceIssues((current) =>
      current.map((issue) =>
        !issueIds || issueIds.includes(issue.id)
          ? {
              ...issue,
              read: true,
            }
          : issue,
      ),
    )
  }

  const openIssuesModal = (issueId?: string) => {
    setFocusedIssueId(issueId ?? null)
    setIsIssuesModalOpen(true)
    markIssuesRead(issueId ? [issueId] : undefined)
  }

  const exportDiagnostics = async () => {
    if (isExportingDiagnostics) {
      return null
    }

    setIsExportingDiagnostics(true)

    try {
      return await invoke<ExportDiagnosticsResult>('export_diagnostics', {
        input: buildDiagnosticsInput(activeView, workspaceIssues),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export diagnostics right now.'
      showToast({
        kind: 'error',
        message,
        source: 'feedback',
      })
      return null
    } finally {
      setIsExportingDiagnostics(false)
    }
  }

  const startFeedbackFlow = async () => {
    if (isExportingDiagnostics || isOpeningFeedbackForm) {
      return
    }

    const diagnosticsResult = await exportDiagnostics()
    if (!diagnosticsResult) {
      return
    }

    setIsOpeningFeedbackForm(true)

    try {
      const feedbackUrl = new URL(BASIN_FEEDBACK_URL)
      const appVersion = '0.3.0'
      const feedbackType = inferFeedbackTypeFromIssue(focusedIssue)

      feedbackUrl.searchParams.set('app_version', appVersion)
      if (feedbackType) {
        feedbackUrl.searchParams.set('feedback_type', feedbackType)
      }

      await openPath(feedbackUrl.toString())
      setIsFeedbackPromptOpen(false)
      const zipFileName = getFileName(diagnosticsResult.zipPath)
      showToast({
        kind: 'success',
        message: `Feedback form opened. Attach ${zipFileName} from Downloads.`,
        source: 'feedback',
        actionLabel: 'Open Downloads',
        action: { type: 'open-path', path: getParentDirectory(diagnosticsResult.zipPath) },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open the feedback form.'
      showToast({
        kind: 'error',
        message,
        source: 'feedback',
      })
    } finally {
      setIsOpeningFeedbackForm(false)
    }
  }

  const recordIssueMessages = (messages: string[], source: string) => {
    const normalizedMessages = messages.map((message) => message.trim()).filter(Boolean)

    if (normalizedMessages.length === 0) {
      return
    }

    const createdIssues: WorkspaceIssue[] = []

    setWorkspaceIssues((current) => {
      const next = [...current]

      for (const message of normalizedMessages) {
        const issueId = toIssueId(message, source)
        if (next.some((issue) => issue.id === issueId)) {
          continue
        }

        const issue: WorkspaceIssue = {
          id: issueId,
          message,
          level: inferIssueLevel(message),
          timestamp: Date.now(),
          source,
          read: false,
        }

        createdIssues.push(issue)
        next.unshift(issue)
      }

      return next
    })

    if (createdIssues.length === 0) {
      return
    }

    for (const issue of createdIssues) {
      showToast({
        kind: issue.level === 'error' ? 'error' : issue.level === 'warning' ? 'warning' : 'info',
        message: issue.message,
        source: issue.source,
        actionLabel: 'View details',
        action: { type: 'open-issues', issueId: issue.id },
      })
    }
  }

  const recordIssueError = (error: unknown, source: string) => {
    const message = error instanceof Error ? error.message : String(error)
    recordIssueMessages([message], source)
  }

  useEffect(() => {
    setSortKey(getDefaultSortKey(activeView))
  }, [activeView])

  useEffect(() => {
    if (!isSortMenuOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (sortMenuRef.current?.contains(target)) {
        return
      }

      setIsSortMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSortMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSortMenuOpen])

  useEffect(() => {
    document.getElementById('startup-static-splash')?.classList.add('is-hidden')

    const exitTimer = window.setTimeout(() => {
      setIsStartupSplashExiting(true)
    }, STARTUP_SPLASH_VISIBLE_MS)

    const hideTimer = window.setTimeout(() => {
      setIsStartupSplashVisible(false)
    }, STARTUP_SPLASH_VISIBLE_MS + STARTUP_SPLASH_FADE_MS)

    return () => {
      window.clearTimeout(exitTimer)
      window.clearTimeout(hideTimer)
    }
  }, [])

  useEffect(() => {
    if (!openRowMenuItemId) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      const element = target instanceof Element ? target : target.parentElement
      if (element?.closest('[data-row-menu-container="true"]')) {
        return
      }

      setOpenRowMenuItemId(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenRowMenuItemId(null)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openRowMenuItemId])

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(toastTimeoutsRef.current)) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  useEffect(() => {
    for (const remote of reconnectRequiredRemotes) {
      recordIssueMessages([remote.message || `${remote.name} needs reconnect.`], `storage:${remote.name}`)
    }
  }, [reconnectRequiredRemotes])

  const fetchRemotes = async (options?: { silent?: boolean }) => {
    if (isDemoMode && demoState) {
      setRemotes(demoState.remotes)
      setListError('')
      setIsLoadingRemotes(false)
      return demoState.remotes
    }

    const silent = options?.silent ?? false

    if (!silent) {
      setIsLoadingRemotes(true)
    }

    try {
      const result = await invoke<RemoteSummary[]>('list_storage_remotes')
      setRemotes(result)
      setListError('')
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setListError(message)
      recordIssueError(error, 'storage')
      setRemotes([])
      return null
    } finally {
      if (!silent) {
        setIsLoadingRemotes(false)
      }
    }
  }

  const fetchUnifiedItems = async (nextRemotes?: RemoteSummary[] | null, options?: { silent?: boolean }) => {
    if (isDemoMode && demoState) {
      setUnifiedItems(demoState.items)
      setItemsError('')
      setIsLoadingItems(false)
      setIsLibraryStreaming(false)
      setIsRefreshingItems(false)
      return demoState.items
    }

    const silent = options?.silent ?? false
    const resolvedRemotes = nextRemotes === undefined ? remotes : nextRemotes

    if (!silent) {
      setIsLoadingItems(true)
      setIsRefreshingItems(false)
    } else {
      setIsRefreshingItems(true)
    }

    if (!resolvedRemotes || resolvedRemotes.length === 0) {
      setUnifiedItems([])
      setItemsError('')
      setIsRefreshingItems(false)
      if (!silent) {
        setIsLoadingItems(false)
      }
      return []
    }

    try {
      const result = await invoke<UnifiedLibraryResult>('list_unified_items')
      setUnifiedItems(sortUnifiedItems(result.items))
      recordIssueMessages(result.notices, 'library')
      setItemsError('')
      setIsLibraryStreaming(false)
      activeLibraryRequestIdRef.current = null
      setLibraryLoadProgress({
        requestId: null,
        loadedRemoteCount: 0,
        totalRemoteCount: 0,
      })
      return result.items
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setItemsError(message)
      recordIssueError(error, 'library')
      setUnifiedItems([])
      return null
    } finally {
      setIsRefreshingItems(false)
      if (!silent) {
        setIsLoadingItems(false)
      }
    }
  }

  const refreshLibrary = async (options?: { silent?: boolean }) => {
    const nextRemotes = await fetchRemotes(options)
    await fetchUnifiedItems(nextRemotes, options)
  }

  useEffect(() => {
    if (isDemoMode) {
      return
    }

    void initializeLibrary()
  }, [isDemoMode])

  useEffect(() => {
    if (isDemoMode) {
      return
    }

    let isSubscribed = true

    const unlistenPromise = listen<DownloadProgressEvent>('download://progress', (event) => {
      if (!isSubscribed) {
        return
      }

      setDownloadStates((current) => applyDownloadProgressEvent(current, event.payload))
    })

    return () => {
      isSubscribed = false
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [isDemoMode])

  useEffect(() => {
    if (isDemoMode) {
      return
    }

    let isSubscribed = true

    const unlistenPromise = listen<UploadProgressEvent>('upload://progress', (event) => {
      if (!isSubscribed) {
        return
      }

      setUploadStates((current) => applyUploadProgressEvent(current, event.payload))

      if (event.payload.status === 'failed' && event.payload.remoteName) {
        void fetchRemotes({ silent: true })
      }
    })

    return () => {
      isSubscribed = false
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [isDemoMode])

  useEffect(() => {
    if (isDemoMode) {
      return
    }

    let isSubscribed = true

    const unlistenPromise = listen<UnifiedLibraryLoadEvent>('library://progress', (event) => {
      if (!isSubscribed) {
        return
      }

      const payload = event.payload
      const activeRequestId = activeLibraryRequestIdRef.current

      if (activeRequestId && payload.requestId !== activeRequestId) {
        return
      }

      setLibraryLoadProgress({
        requestId: payload.requestId,
        loadedRemoteCount: payload.loadedRemoteCount,
        totalRemoteCount: payload.totalRemoteCount,
      })

      if (payload.status === 'remote_loaded') {
        setUnifiedItems((current) => mergeUnifiedItems(current, payload.items ?? []))
        recordIssueMessages(payload.notices ?? [], payload.remoteName ? `storage:${payload.remoteName}` : 'library')
        setIsLoadingItems(false)
        return
      }

      if (payload.status === 'remote_failed') {
        recordIssueMessages(
          payload.message ? [payload.message, ...(payload.notices ?? [])] : (payload.notices ?? []),
          payload.remoteName ? `storage:${payload.remoteName}` : 'library-stream',
        )
        void fetchRemotes({ silent: true })
        setIsLoadingItems(false)
        return
      }

      if (payload.status === 'completed') {
        setIsLibraryStreaming(false)
        setIsLoadingItems(false)
        activeLibraryRequestIdRef.current = null
      }
    })

    return () => {
      isSubscribed = false
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [isDemoMode])

  useEffect(() => {
    if (isDemoMode) {
      return
    }

    if (activeModal !== 'upload') {
      setIsUploadDragActive(false)
      return
    }

    let isSubscribed = true

    const unlistenPromise = getCurrentWindow().onDragDropEvent((event) => {
      if (!isSubscribed) {
        return
      }

      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setIsUploadDragActive(true)
        return
      }

      if (event.payload.type === 'leave') {
        setIsUploadDragActive(false)
        return
      }

      if (event.payload.type === 'drop') {
        setIsUploadDragActive(false)
        void prepareUploadSelections(toUploadSelections(event.payload.paths))
      }
    })

    return () => {
      isSubscribed = false
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [activeModal, isDemoMode])

  const initializeLibrary = async () => {
    if (isDemoMode && demoState) {
      setRemotes(demoState.remotes)
      setUnifiedItems(demoState.items)
      setListError('')
      setItemsError('')
      setIsLoadingRemotes(false)
      setIsLoadingItems(false)
      setIsLibraryStreaming(false)
      setIsRefreshingItems(false)
      setLibraryLoadProgress({
        requestId: null,
        loadedRemoteCount: 0,
        totalRemoteCount: 0,
      })
      activeLibraryRequestIdRef.current = null
      return
    }

    setIsLoadingItems(true)
    setIsLibraryStreaming(false)
    setIsRefreshingItems(false)
    setUnifiedItems([])
    setItemsError('')
    setLibraryLoadProgress({
      requestId: null,
      loadedRemoteCount: 0,
      totalRemoteCount: 0,
    })
    activeLibraryRequestIdRef.current = null

    const nextRemotes = await fetchRemotes()

    if (!nextRemotes || nextRemotes.length === 0) {
      setIsLoadingItems(false)
      return
    }

    try {
      const result = await invoke<StartUnifiedLibraryLoadResult>('start_unified_library_load')
      activeLibraryRequestIdRef.current = result.requestId

      setLibraryLoadProgress({
        requestId: result.requestId,
        loadedRemoteCount: 0,
        totalRemoteCount: result.totalRemotes,
      })
      setIsLibraryStreaming(result.totalRemotes > 0)

      if (result.totalRemotes === 0) {
        setIsLoadingItems(false)
        setIsLibraryStreaming(false)
        setIsRefreshingItems(false)
        activeLibraryRequestIdRef.current = null
      }
    } catch (error) {
      setItemsError(error instanceof Error ? error.message : String(error))
      recordIssueError(error, 'library')
      setIsLoadingItems(false)
      setIsLibraryStreaming(false)
      setIsRefreshingItems(false)
      activeLibraryRequestIdRef.current = null
    }
  }

  useEffect(() => {
    if (activeModal !== 'oauth-pending' || !pendingSession || pendingSession.status !== 'pending') {
      return
    }

    const intervalId = window.setInterval(() => {
      void checkPendingSession()
    }, 1500)

    return () => window.clearInterval(intervalId)
  }, [activeModal, pendingSession?.remoteName, pendingSession?.status])

  useEffect(() => {
    if (pendingSession?.status !== 'requires_drive_selection') {
      setSelectedDriveId('')
      return
    }

    const preferred =
      pendingSession.driveCandidates?.find((candidate) => candidate.isSuggested && candidate.isReachable) ??
      pendingSession.driveCandidates?.find((candidate) => candidate.isReachable) ??
      pendingSession.driveCandidates?.[0]

    setSelectedDriveId(preferred?.id ?? '')
  }, [pendingSession])

  useEffect(() => {
    if (!hasPendingUploadRefresh) {
      return
    }

    if (uploadSummary.active > 0 || isStartingUpload) {
      return
    }

    if (uploadSummary.completed === 0 && uploadSummary.failed === 0) {
      setHasPendingUploadRefresh(false)
      lastUploadOutcomeRef.current = null
      return
    }

    const previousOutcome = lastUploadOutcomeRef.current
    const nextOutcome = {
      completed: uploadSummary.completed,
      failed: uploadSummary.failed,
    }

    if (
      !previousOutcome ||
      previousOutcome.completed !== nextOutcome.completed ||
      previousOutcome.failed !== nextOutcome.failed
    ) {
      if (uploadSummary.failed > 0 && uploadSummary.completed > 0) {
        showToast({
          kind: 'warning',
          message: `${uploadSummary.completed} uploaded, ${uploadSummary.failed} failed`,
          source: 'upload',
          actionLabel: 'Open upload',
          action: { type: 'open-upload' },
        })
      } else if (uploadSummary.failed > 0) {
        showToast({
          kind: 'error',
          message: `${uploadSummary.failed} file${uploadSummary.failed === 1 ? '' : 's'} failed`,
          source: 'upload',
          actionLabel: 'Open upload',
          action: { type: 'open-upload' },
        })
      } else {
        showToast({
          kind: 'success',
          message: `${uploadSummary.completed} file${uploadSummary.completed === 1 ? '' : 's'} uploaded`,
          source: 'upload',
          actionLabel: 'Open upload',
          action: { type: 'open-upload' },
        })
      }
    }

    lastUploadOutcomeRef.current = nextOutcome
    setHasPendingUploadRefresh(false)
    void refreshLibrary({ silent: true })
  }, [hasPendingUploadRefresh, isStartingUpload, refreshLibrary, showToast, uploadSummary.active, uploadSummary.completed, uploadSummary.failed])

  const resetAddFlow = () => {
    setAddFlowStep('providers')
    setSelectedProvider('onedrive')
    setRemoteName('')
    setClientId('')
    setClientSecret('')
    setAddError('')
    setSelectedDriveId('')
  }

  const openAddModal = () => {
    resetAddFlow()
    setActiveModal('add-storage')
  }

  const openUploadModal = () => {
    setUploadError('')
    setActiveModal('upload')
  }

  const closeUploadModal = () => {
    setActiveModal('none')
    setIsUploadDragActive(false)
    if (!isPreparingUpload) {
      setPreparingUploadItems([])
    }
  }

  const closeAddModal = () => {
    setActiveModal('none')
    resetAddFlow()
  }

  const openProviderForm = (providerId: StorageProvider) => {
    setSelectedProvider(providerId)
    setAddFlowStep('form')
    setAddError('')
  }

  const fetchAuthSession = async (name: string) => {
    if (isDemoMode) {
      return null
    }

    return invoke<AuthSessionRecord | null>('get_auth_session_status', { name })
  }

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const upsertOptimisticConnectedRemote = (remoteName: string, provider: string) => {
    setRemotes((current) => {
      const nextRemote: RemoteSummary = {
        name: remoteName,
        provider,
        status: 'connected',
        message: undefined,
      }

      const existingIndex = current.findIndex((entry) => entry.name === remoteName)

      if (existingIndex === -1) {
        return [...current, nextRemote].sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()))
      }

      const next = [...current]
      next[existingIndex] = nextRemote
      return next
    })
  }

  const synchronizeConnectedRemote = async (remoteName: string, provider: string) => {
    upsertOptimisticConnectedRemote(remoteName, provider)

    for (let attempt = 1; attempt <= CONNECT_SYNC_ATTEMPTS; attempt += 1) {
      const latestRemotes = await fetchRemotes({ silent: true })
      const matchedRemote = latestRemotes?.find((entry) => entry.name === remoteName) ?? null

      console.info('[connect-sync]', {
        remoteName,
        provider,
        attempt,
        matchedRemoteStatus: matchedRemote?.status ?? null,
      })

      if (matchedRemote?.status === 'connected') {
        await fetchUnifiedItems(latestRemotes, { silent: true })
        return
      }

      if (attempt < CONNECT_SYNC_ATTEMPTS) {
        await sleep(CONNECT_SYNC_DELAY_MS)
      }
    }

    await refreshLibrary({ silent: true })
  }

  const handlePendingConnected = async (session: PendingSession) => {
    setPendingSession({
      ...session,
      status: 'connected',
      nextStep: 'done',
      message: session.message || CONNECT_SUCCESS_MESSAGE,
      errorCode: undefined,
      driveCandidates: undefined,
    })
    await synchronizeConnectedRemote(session.remoteName, session.provider)
  }

  const checkPendingSession = async () => {
    if (!pendingSession) {
      return null
    }

    try {
      const [latestRemotes, session] = await Promise.all([
        fetchRemotes({ silent: true }),
        fetchAuthSession(pendingSession.remoteName),
      ])

      const nextPending = resolvePendingSession(pendingSession, latestRemotes, session, Date.now())

      console.info('[pending-auth]', {
        remoteName: pendingSession.remoteName,
        previousStatus: pendingSession.status,
        previousStage: pendingSession.stage,
        remoteStatus: latestRemotes?.find((entry) => entry.name === pendingSession.remoteName)?.status ?? null,
        resolvedStatus: nextPending.status,
        resolvedStage: nextPending.stage,
        operationAgeMs: Date.now() - pendingSession.operationStartedAtMs,
        ...(session
          ? {
              sessionStatus: session.status,
              sessionStage: session.stage ?? null,
              sessionErrorCode: session.errorCode ?? null,
            }
          : {}),
      })

      setPendingSession(nextPending)

      if (nextPending.status === 'connected') {
        await handlePendingConnected(nextPending)
      }

      return nextPending
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedPending = {
        ...pendingSession,
        status: 'error' as const,
        stage: 'failed' as AuthSessionStage,
        nextStep: 'retry',
        message,
        errorCode: undefined,
        lastUpdatedAtMs: Date.now(),
      }
      setPendingSession(failedPending)
      return failedPending
    }
  }

  const moveToPendingModal = (result: CreateRemoteResult, mode: PendingMode) => {
    const nowMs = Date.now()
    setPendingSession({
      remoteName: result.remoteName,
      provider: result.provider,
      mode,
      status: result.status,
      stage:
        result.stage ??
        (result.status === 'connected'
          ? 'connected'
          : result.status === 'requires_drive_selection'
            ? 'requires_drive_selection'
            : result.status === 'error'
              ? 'failed'
              : 'pending_auth'),
      nextStep: result.nextStep,
      message: result.message || EMPTY_PENDING_MESSAGE,
      errorCode: result.errorCode ?? undefined,
      operationStartedAtMs: nowMs,
      lastUpdatedAtMs: nowMs,
      driveCandidates: result.driveCandidates ?? undefined,
    })
    setActiveModal('oauth-pending')
  }

  const handleCreateRemote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isDemoMode) {
      return
    }

    if (!remoteName.trim()) {
      setAddError('Remote name is required.')
      return
    }

    setIsSubmitting(true)
    setAddError('')

    try {
      const result = await invoke<CreateRemoteResult>('create_onedrive_remote', {
        input: {
          remoteName: remoteName.trim(),
          clientId: clientId.trim() || undefined,
          clientSecret: clientSecret.trim() || undefined,
        } satisfies CreateOneDriveRemoteInput,
      })

      if (result.status === 'error' && result.nextStep !== 'retry') {
        setAddError(result.message)
        return
      }

      if (result.status === 'connected') {
        await handlePendingConnected({
          remoteName: result.remoteName,
          provider: result.provider,
          mode: 'create',
          status: result.status,
          stage: 'connected',
          nextStep: result.nextStep,
          message: result.message || CONNECT_SUCCESS_MESSAGE,
          errorCode: result.errorCode ?? undefined,
          operationStartedAtMs: Date.now(),
          lastUpdatedAtMs: Date.now(),
          driveCandidates: result.driveCandidates ?? undefined,
        })
        setActiveModal('none')
        resetAddFlow()
        return
      }

      moveToPendingModal(result, 'create')
      await fetchRemotes({ silent: true })
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReconnect = async (remote: RemoteSummary) => {
    if (isDemoMode) {
      return
    }

    try {
      const result = await invoke<CreateRemoteResult>('reconnect_remote', { name: remote.name })

      if (result.status === 'connected') {
        await handlePendingConnected({
          remoteName: result.remoteName,
          provider: result.provider,
          mode: 'reconnect',
          status: result.status,
          stage: 'connected',
          nextStep: result.nextStep,
          message: result.message || CONNECT_SUCCESS_MESSAGE,
          errorCode: result.errorCode ?? undefined,
          operationStartedAtMs: Date.now(),
          lastUpdatedAtMs: Date.now(),
          driveCandidates: result.driveCandidates ?? undefined,
        })
        return
      }

      moveToPendingModal(result, 'reconnect')
      await fetchRemotes({ silent: true })
    } catch (error) {
      setPendingSession({
        remoteName: remote.name,
        provider: remote.provider,
        mode: 'reconnect',
        status: 'error',
        stage: 'failed',
        nextStep: 'retry',
        message: error instanceof Error ? error.message : String(error),
        errorCode: undefined,
        operationStartedAtMs: Date.now(),
        lastUpdatedAtMs: Date.now(),
      })
      setActiveModal('oauth-pending')
    }
  }

  const handleDeleteRemote = async () => {
    if (isDemoMode) {
      return
    }

    if (!removeTarget) {
      return
    }

    setIsRemoving(true)
    setRemoveError('')

    try {
      const result = await invoke<ActionResult>('delete_remote', { name: removeTarget.name })

      if (result.status === 'error') {
        setRemoveError(result.message)
        return
      }

      setActiveModal('none')
      setRemoveTarget(null)
      await refreshLibrary({ silent: true })
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRemoving(false)
    }
  }

  const handlePendingDone = async () => {
    setActiveModal('none')
    setPendingSession(null)
    resetAddFlow()
  }

  const handleFinalizeDriveSelection = async () => {
    if (isDemoMode) {
      return
    }

    if (!pendingSession || pendingSession.status !== 'requires_drive_selection' || !selectedDriveId) {
      return
    }

    setIsFinalizingDrive(true)

    try {
      const result = await invoke<CreateRemoteResult>('finalize_onedrive_remote', {
        name: pendingSession.remoteName,
        driveId: selectedDriveId,
      })

      setPendingSession({
        remoteName: result.remoteName,
        provider: result.provider,
        mode: pendingSession.mode,
        status: result.status,
        stage:
          result.stage ??
          (result.status === 'connected'
            ? 'connected'
            : result.status === 'requires_drive_selection'
              ? 'requires_drive_selection'
              : result.status === 'error'
                ? 'failed'
                : 'finalizing'),
        nextStep: result.nextStep,
        message: result.message,
        errorCode: result.errorCode ?? undefined,
        operationStartedAtMs: pendingSession.operationStartedAtMs,
        lastUpdatedAtMs: Date.now(),
        driveCandidates: result.driveCandidates ?? undefined,
      })

      if (result.status === 'connected') {
        await refreshLibrary({ silent: true })
      }
    } catch (error) {
      setPendingSession({
        ...pendingSession,
        status: 'error',
        stage: 'failed',
        nextStep: 'retry',
        message: error instanceof Error ? error.message : String(error),
        errorCode: undefined,
        lastUpdatedAtMs: Date.now(),
      })
    } finally {
      setIsFinalizingDrive(false)
    }
  }

  const handlePendingRemoveAndReconnect = async () => {
    if (isDemoMode) {
      return
    }

    if (!pendingSession) {
      return
    }

    try {
      await invoke<ActionResult>('delete_remote', { name: pendingSession.remoteName })
    } catch {
      // Ignore delete failures here and still guide the user back into reconnect flow.
    }

    setSelectedProvider((pendingSession.provider as StorageProvider) || 'onedrive')
    setAddFlowStep('form')
    setRemoteName(pendingSession.remoteName)
    setClientId('')
    setClientSecret('')
    setAddError('')
    setActiveModal('add-storage')
    await refreshLibrary({ silent: true })
  }

  const openRemoveModal = (remote: RemoteSummary) => {
    setRemoveTarget(remote)
    setRemoveError('')
    setActiveModal('remove-confirm')
  }

  const handleDownload = async (item: UnifiedItem) => {
    if (isDemoMode) {
      return
    }

    if (item.isDir) {
      return
    }

    const request = {
      downloadId: item.id,
      sourceRemote: item.sourceRemote,
      sourcePath: item.sourcePath,
      displayName: item.name,
      size: item.size > 0 ? item.size : undefined,
    } satisfies DownloadRequest

    setDownloadStates((current) =>
      applyDownloadProgressEvent(current, {
        downloadId: request.downloadId,
        status: 'queued',
        totalBytes: request.size ?? null,
        errorMessage: null,
      }),
    )

    try {
      const result = await invoke<DownloadAcceptedResult>('start_download', { input: request })

      setDownloadStates((current) =>
        applyDownloadProgressEvent(current, {
          downloadId: result.downloadId,
          status: 'queued',
          targetPath: result.targetPath,
          totalBytes: request.size ?? null,
          errorMessage: null,
        }),
      )
    } catch (error) {
      setDownloadStates((current) =>
        applyDownloadProgressEvent(current, {
          downloadId: request.downloadId,
          status: 'failed',
          totalBytes: request.size ?? null,
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }

  const resetUploadBatch = () => {
    setUploadBatch(null)
    setPreparingUploadItems([])
    setUploadStates({})
    setUploadError('')
    setIsPreparingUpload(false)
    setIsStartingUpload(false)
    setIsUploadDragActive(false)
    setHasPendingUploadRefresh(false)
  }

  const prepareUploadSelections = async (selections: UploadSelection[]) => {
    if (isDemoMode) {
      return
    }

    if (selections.length === 0) {
      return
    }

    setPreparingUploadItems(
      selections.map((selection, index) => ({
        id: `${selection.kind}:${selection.path}:${index}`,
        displayName: getUploadSelectionDisplayName(selection.path),
      })),
    )
    setIsPreparingUpload(true)
    setUploadError('')

    try {
      const nextBatch = await invoke<PreparedUploadBatch>('prepare_upload_batch', { input: { selections } })

      setUploadBatch((current) => {
        if (!current) {
          return nextBatch
        }

        const seen = new Set(current.items.map((item) => item.itemId))
        const mergedItems = [...current.items]

        for (const item of nextBatch.items) {
          if (!seen.has(item.itemId)) {
            mergedItems.push(item)
            seen.add(item.itemId)
          }
        }

        return {
          uploadId: current.uploadId,
          items: mergedItems,
          notices: [...current.notices, ...nextBatch.notices].filter(
            (notice, index, notices) => notices.indexOf(notice) === index,
          ),
        }
      })
      setActiveModal('upload')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
      setActiveModal('upload')
    } finally {
      setIsPreparingUpload(false)
      setPreparingUploadItems([])
    }
  }

  const handleChooseUploadFiles = async () => {
    if (isDemoMode) {
      return
    }

    try {
      const selected = await openDialog({
        multiple: true,
        directory: false,
        title: 'Choose files to upload',
      })

      const paths = normalizeDialogSelection(selected)
      await prepareUploadSelections(toUploadSelections(paths, 'file'))
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleChooseUploadFolder = async () => {
    if (isDemoMode) {
      return
    }

    try {
      const selected = await openDialog({
        multiple: false,
        directory: true,
        title: 'Choose a folder to upload',
      })

      const paths = normalizeDialogSelection(selected)
      await prepareUploadSelections(toUploadSelections(paths, 'directory'))
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleStartUpload = async () => {
    if (isDemoMode) {
      return
    }

    if (!uploadBatch || uploadBatch.items.length === 0) {
      setUploadError('Add files or folders before starting the upload.')
      return
    }

    setIsStartingUpload(true)
    setUploadError('')
    setHasPendingUploadRefresh(true)
    lastUploadOutcomeRef.current = null

    showToast({
      kind: 'info',
      message: `Uploading ${uploadBatch.items.length} file${uploadBatch.items.length === 1 ? '' : 's'}...`,
      source: 'upload',
      actionLabel: 'Open upload',
      action: { type: 'open-upload' },
    })

    const queuedStates = Object.fromEntries(
      uploadBatch.items.map((item) => [
        item.itemId,
        {
          ...IDLE_UPLOAD_STATE,
          status: 'queued' as const,
          completedCount: 0,
          totalCount: uploadBatch.items.length,
          errorMessage: null,
        },
      ]),
    )

    setUploadStates((current) => ({
      ...current,
      ...queuedStates,
    }))

    try {
      await invoke<UploadAcceptedResult>('start_upload_batch', {
        input: { uploadId: uploadBatch.uploadId, items: uploadBatch.items },
      })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
      setHasPendingUploadRefresh(false)
    } finally {
      setIsStartingUpload(false)
    }
  }

  const canStartUpload =
    !!uploadBatch &&
    uploadBatch.items.length > 0 &&
    hasReadyUploads &&
    uploadSummary.active === 0 &&
    !isPreparingUpload &&
    !isStartingUpload

  const handleOpen = async (item: UnifiedItem) => {
    if (isDemoMode) {
      return
    }

    if (item.isDir || (!canPreviewItem(item) && !canOpenInDefaultApp(item))) {
      return
    }

    const request = {
      requestId: item.id,
      sourceRemote: item.sourceRemote,
      sourcePath: item.sourcePath,
      displayName: item.name,
      mimeType: item.mimeType,
      extension: item.extension,
    } satisfies OpenRequest

    setOpenStates((current) => ({
      ...current,
      [item.id]: toPreparingOpenState(current[item.id]),
    }))

    try {
      const result = await invoke<OpenResult>('prepare_open_file', { input: request })

      setOpenStates((current) => ({
        ...current,
        [item.id]: toReadyOpenState(result),
      }))

      const preview = toPreviewPayload(item.id, item.name, result)
      if (preview) {
        setPreviewPayload(preview)
        return
      }

      await openPath(result.localPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOpenStates((current) => ({
        ...current,
        [item.id]: toFailedOpenState(message, current[item.id]),
      }))
    }
  }

  const closePendingModal = () => {
    setActiveModal('none')
    setSelectedDriveId('')
  }

  const hasConnectedStorage = displayedRemotes.length > 0
  const shouldShowNoStorageState = !isLoadingRemotes && !listError && !hasConnectedStorage
  const shouldShowCategoryEmptyState =
    hasConnectedStorage && !isLoadingItems && !isLibraryStreaming && !itemsError && displayedItems.length === 0
  const shouldShowLoadingList = isLoadingItems && hasConnectedStorage && unifiedItems.length === 0 && !itemsError
  const shouldShowStreamingTail = (isLibraryStreaming || isRefreshingItems) && unifiedItems.length > 0 && !itemsError
  const emptyListTitle = searchQuery ? `No files match "${searchQuery.trim()}".` : `No files in ${currentViewLabel} yet.`
  const emptyListDescription = searchQuery
    ? 'Try a different search or switch to another view.'
    : 'Files added to this view will appear here.'

  return (
    <>
      {isStartupSplashVisible ? (
        <div
          className={`startup-splash ${isStartupSplashExiting ? 'exiting' : 'visible'}`}
          aria-hidden="true"
        >
          <div className="startup-splash-brand">
            <img className="startup-splash-lockup" src={splashLockup} alt="" />
          </div>
        </div>
      ) : null}

      <main className="workspace-shell">
        <aside className="storage-sidebar">
        <div className="sidebar-panel">
          <div className="sidebar-list">
            <nav className="sidebar-nav" aria-label="Workspace views">
              {PRIMARY_NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  className={`sidebar-nav-item ${activeView === item.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                >
                  <span className="sidebar-nav-label">{item.label}</span>
                </button>
              ))}
            </nav>

            <section className="sidebar-section sidebar-section-storage">
              <div className="sidebar-section-heading">
                <p className="sidebar-section-label">Storages</p>
                <Button family="quiet" size="sm" type="button" onClick={openAddModal}>
                  + Add storage
                </Button>
              </div>

              {isLoadingRemotes ? <p className="empty-state">Loading storage...</p> : null}
              {!isLoadingRemotes && listError ? <p className="error-text">{listError}</p> : null}
              {shouldShowNoStorageState ? <p className="empty-state">No storage connected yet.</p> : null}

              {!isLoadingRemotes && !listError && displayedRemotes.length > 0 ? (
                <ul className="storage-nav-list">
                  {displayedRemotes.map((remote) => {
                    const needsReconnect = remote.status === 'reconnect_required'

                    return (
                      <li key={remote.name} className="storage-nav-item">
                        <div className="storage-nav-copy">
                          <p className="remote-name">{remote.name}</p>
                          <p className="remote-provider">{getProviderLabel(remote.provider)}</p>
                        </div>

                        <div className="storage-nav-side">
                          <span className={`storage-status-badge ${needsReconnect ? 'warning' : 'neutral'}`}>
                            {needsReconnect ? 'Needs reconnect' : 'Connected'}
                          </span>

                          <div className="storage-nav-actions">
                            {needsReconnect ? (
                              <Button family="quiet" size="sm" tone="warning" type="button" onClick={() => void handleReconnect(remote)}>
                                Reconnect
                              </Button>
                            ) : null}
                            <Button family="quiet" size="sm" tone="danger" type="button" onClick={() => openRemoveModal(remote)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </section>
          </div>
        </div>
        </aside>

        <section className="workspace-main">
        <div className="library-shell">
          <header className="library-topbar">
            <div className="library-toolbar">
              <label className="search-field" aria-label="Search files">
                <span className="search-icon" aria-hidden="true">
                  /
                </span>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search files, paths, or sources"
                />
              </label>

              <div className="library-actions">
                <div className={`toolbar-select ${isSortMenuOpen ? 'open' : ''}`} ref={sortMenuRef}>
                  <Button
                    family="quiet"
                    size="sm"
                    className="toolbar-select-trigger"
                    type="button"
                    aria-label="Sort files"
                    aria-haspopup="menu"
                    aria-expanded={isSortMenuOpen}
                    onClick={() => setIsSortMenuOpen((current) => !current)}
                  >
                    <span className="toolbar-select-value">{getSortLabel(sortKey)}</span>
                    <span className="toolbar-select-icon" aria-hidden="true">v</span>
                  </Button>

                  {isSortMenuOpen ? (
                    <div className="toolbar-select-menu" role="menu" aria-label="Sort files">
                      {SORT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={`toolbar-select-option ${sortKey === option.value ? 'active' : ''}`}
                          type="button"
                          role="menuitemradio"
                          aria-checked={sortKey === option.value}
                          onClick={() => {
                            setSortKey(option.value)
                            setIsSortMenuOpen(false)
                          }}
                        >
                          <span>{option.label}</span>
                          {sortKey === option.value ? <span aria-hidden="true">•</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <Button family="icon" size="md" className="issues-entry-button utility-icon-button" type="button" onClick={() => openIssuesModal()} aria-label="Open issues">
                  <span aria-hidden="true">!</span>
                  {workspaceIssues.length > 0 ? (
                    <span className="issues-entry-badge">{unreadIssueCount > 0 ? unreadIssueCount : workspaceIssues.length}</span>
                  ) : null}
                </Button>
                <Button family="primary" type="button" onClick={openUploadModal} disabled={!hasConnectedStorage}>
                  Upload
                </Button>
              </div>
            </div>

          </header>

          <div className="library-content">
            {!isLoadingItems && itemsError ? <p className="error-text">{itemsError}</p> : null}

            {shouldShowNoStorageState ? (
              <div className="main-empty-state">
                <p className="eyebrow">Unified Library</p>
                <h1>Your files will appear here.</h1>
                <p>Connect a storage from the sidebar to start browsing everything in one place.</p>
                <div className="empty-state-actions">
                  <Button family="secondary" type="button" onClick={openAddModal}>
                    Connect storage
                  </Button>
                  <Button family="primary" type="button" onClick={openUploadModal} disabled={!hasConnectedStorage}>
                    Upload
                  </Button>
                </div>
              </div>
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

            {((!isLoadingItems || unifiedItems.length > 0) && !itemsError && hasConnectedStorage && !shouldShowLoadingList) ? (
              activeView === 'recent' ? (
                shouldShowCategoryEmptyState ? (
                  <>
                    <ListHeader />
                    <div className="empty-list-state" role="status" aria-live="polite">
                      <div className="empty-list-copy">
                        <p className="empty-list-title">{emptyListTitle}</p>
                        <p className="empty-list-description">{emptyListDescription}</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="recent-groups">
                      {groupedRecentItems.map((group) => (
                        <section key={group.label} className="recent-group">
                          <div className="section-heading">
                            <h3>{group.label}</h3>
                            <span>{group.items.length}</span>
                          </div>

                          <ListHeader />
                          <div className="item-list">
                            {group.items.map((item) => (
                              <UnifiedListItem
                                key={item.id}
                                item={item}
                                downloadState={downloadStates[item.id] ?? IDLE_DOWNLOAD_STATE}
                                openState={openStates[item.id] ?? IDLE_OPEN_STATE}
                                onOpen={handleOpen}
                                onDownload={handleDownload}
                                isRowMenuOpen={openRowMenuItemId === item.id}
                                onToggleRowMenu={() => setOpenRowMenuItemId((current) => (current === item.id ? null : item.id))}
                                onCloseRowMenu={() => setOpenRowMenuItemId(null)}
                              />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                    {shouldShowStreamingTail ? <StreamingLoadingTail /> : null}
                  </>
                )
              ) : (
                <>
                  <ListHeader />
                  {shouldShowCategoryEmptyState ? (
                    <div className="empty-list-state" role="status" aria-live="polite">
                      <div className="empty-list-copy">
                        <p className="empty-list-title">{emptyListTitle}</p>
                        <p className="empty-list-description">{emptyListDescription}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="item-list">
                        {displayedItems.map((item) => (
                          <UnifiedListItem
                            key={item.id}
                            item={item}
                            downloadState={downloadStates[item.id] ?? IDLE_DOWNLOAD_STATE}
                            openState={openStates[item.id] ?? IDLE_OPEN_STATE}
                            onOpen={handleOpen}
                            onDownload={handleDownload}
                            isRowMenuOpen={openRowMenuItemId === item.id}
                            onToggleRowMenu={() => setOpenRowMenuItemId((current) => (current === item.id ? null : item.id))}
                            onCloseRowMenu={() => setOpenRowMenuItemId(null)}
                          />
                        ))}
                      </div>
                      {shouldShowStreamingTail ? <StreamingLoadingTail /> : null}
                    </>
                  )}
                </>
              )
            ) : null}
          </div>
        </div>
      </section>

      {visibleToasts.length > 0 ? (
        <div className="toast-stack" aria-live="polite" aria-label="Workspace notifications">
          {visibleToasts.map((toast) => (
            <div key={toast.id} className={`toast-notice ${toast.kind}`}>
              <div className="toast-copy">
                <p>{toast.message}</p>
                <span>{formatIssueTimestamp(toast.timestamp)}</span>
              </div>
              {toast.action ? (
                <Button
                  family="secondary"
                  size="sm"
                  className="toast-action"
                  type="button"
                  onClick={() => {
                    const action = toast.action

                    if (!action) {
                      return
                    }

                    if (action.type === 'open-upload') {
                      openUploadModal()
                      return
                    }

                    if (action.type === 'open-path') {
                      void openPath(action.path)
                      return
                    }

                    openIssuesModal(action.issueId)
                  }}
                >
                  {toast.actionLabel}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {previewPayload ? (
        <PreviewModal
          payload={previewPayload}
          onClose={() => setPreviewPayload(null)}
        />
      ) : null}

      {isIssuesModalOpen ? (
        <IssuesModal
          issues={workspaceIssues}
          focusedIssueId={focusedIssueId}
          onReportIssue={() => setIsFeedbackPromptOpen(true)}
          onClose={() => {
            setIsIssuesModalOpen(false)
            setFocusedIssueId(null)
          }}
        />
      ) : null}

      {isFeedbackPromptOpen ? (
        <FeedbackPromptModal
          isExportingDiagnostics={isExportingDiagnostics}
          isOpeningFeedbackForm={isOpeningFeedbackForm}
          onClose={() => setIsFeedbackPromptOpen(false)}
          onContinue={() => {
            void startFeedbackFlow()
          }}
        />
      ) : null}

      {activeModal === 'add-storage' ? (
        <div className="modal-overlay" role="presentation" onClick={closeAddModal}>
          <div className="full-modal" role="dialog" aria-modal="true" aria-labelledby="add-storage-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Add Storage</p>
                <h2 id="add-storage-title">
                  {addFlowStep === 'providers' ? 'Choose a provider' : `Connect ${selectedProviderConfig.label}`}
                </h2>
              </div>

              <Button family="icon" size="sm" className="modal-close" type="button" onClick={closeAddModal} aria-label="Close modal">
                ×
              </Button>
            </div>

            {addFlowStep === 'providers' ? (
              <div className="provider-grid">
                {STORAGE_PROVIDERS.map((provider) => (
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

                {addError ? <p className="error-text">{addError}</p> : null}

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
          </div>
        </div>
      ) : null}

      {activeModal === 'oauth-pending' && pendingSession ? (
        <div className="modal-overlay" role="presentation" onClick={closePendingModal}>
          <div className="full-modal pending-modal" role="dialog" aria-modal="true" aria-labelledby="pending-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{pendingSession.provider}</p>
                <h2 id="pending-title">
                  {pendingSession.status === 'connected'
                    ? 'Storage connected'
                    : pendingSession.status === 'requires_drive_selection'
                      ? 'Choose your OneDrive'
                    : pendingSession.status === 'error'
                      ? pendingHasCallbackStartupFailure
                        ? 'Sign-in could not start'
                        : 'Reconnect failed'
                      : pendingIsFinalizing
                        ? 'Finishing your OneDrive connection'
                        : 'Complete authentication in your browser'}
                </h2>
              </div>

              <Button family="icon" size="sm" className="modal-close" type="button" onClick={closePendingModal} aria-label="Close modal">
                ×
              </Button>
            </div>

            <div className="pending-body">
              <p className="pending-remote">{pendingSession.remoteName}</p>
              <p>{pendingSession.message || EMPTY_PENDING_MESSAGE}</p>

              {pendingSession.status === 'pending' ? (
                <div className="pending-indicator">
                  <span className="spinner" aria-hidden="true" />
                  <p>{pendingIsFinalizing ? 'Finishing setup...' : 'Checking for completion...'}</p>
                </div>
              ) : null}

              {pendingSession.status === 'pending' ? (
                <p className="pending-help">
                  {pendingIsFinalizing
                    ? 'Cloud Weave already has your sign-in token and is finishing the OneDrive setup. You do not need to return to the browser.'
                    : 'Finish the Microsoft sign-in flow in your browser, then return here.'}
                </p>
              ) : null}

              {pendingSession.status === 'requires_drive_selection' ? (
                <div className="drive-picker">
                  <p className="pending-help">
                    Cloud Weave found more than one OneDrive library for this account. Choose the one you want to
                    browse.
                  </p>

                  <div className="drive-candidate-list" role="list" aria-label="OneDrive libraries">
                    {pendingSession.driveCandidates?.map((candidate) => {
                      const isSelected = candidate.id === selectedDriveId

                      return (
                        <label
                          key={`${candidate.id}-${candidate.label}`}
                          className={`drive-candidate ${isSelected ? 'selected' : ''} ${candidate.isReachable ? '' : 'disabled'}`}
                        >
                          <input
                            type="radio"
                            name="drive-candidate"
                            value={candidate.id}
                            checked={isSelected}
                            disabled={!candidate.isReachable}
                            onChange={() => setSelectedDriveId(candidate.id)}
                          />

                          <div className="drive-candidate-copy">
                            <div className="drive-candidate-title">
                              <span>{candidate.label}</span>
                              <div className="drive-candidate-badges">
                                <span className="source-badge">{candidate.driveType}</span>
                                {candidate.isSuggested ? <span className="source-badge suggested-badge">Recommended</span> : null}
                              </div>
                            </div>

                            <p className="drive-candidate-id">{candidate.id}</p>
                            <p className="drive-candidate-help">
                              {candidate.isReachable
                                ? candidate.isSystemLike
                                  ? 'This looks like a system-style library. Choose it only if it is the one you expect.'
                                  : 'This library is reachable and ready to use.'
                                : candidate.message ?? 'This library could not be opened.'}
                            </p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {pendingSession.status === 'error' ? (
                <>
                  <p className="pending-help">
                    {pendingHasCallbackStartupFailure
                      ? 'Cloud Weave could not open its local sign-in callback. Another stalled sign-in may still be running. Close this message and try again.'
                      : 'This storage could not be reconnected. Remove it and connect again to keep using it.'}
                  </p>
                </>
              ) : null}

              {pendingSession.status === 'connected' ? (
                <p className="pending-help">This storage now appears in the connected list and unified library.</p>
              ) : null}
            </div>

            <div className="modal-actions">
              {pendingSession.status === 'error' ? (
                <>
                  {!pendingHasCallbackStartupFailure ? (
                    <Button family="primary" type="button" onClick={() => void handlePendingRemoveAndReconnect()}>
                      Remove and connect again
                    </Button>
                  ) : null}
                </>
              ) : pendingSession.status === 'requires_drive_selection' ? (
                <>
                  <Button family="secondary" type="button" onClick={closePendingModal}>
                    Cancel
                  </Button>
                  <Button family="secondary" type="button" onClick={() => void handlePendingRemoveAndReconnect()}>
                    Remove and start over
                  </Button>
                  <Button
                    family="primary"
                    type="button"
                    onClick={() => void handleFinalizeDriveSelection()}
                    disabled={!selectedDriveId || isFinalizingDrive}
                  >
                    {isFinalizingDrive ? 'Connecting...' : 'Use this drive'}
                  </Button>
                </>
              ) : pendingSession.status === 'connected' ? (
                <Button family="primary" type="button" onClick={handlePendingDone}>
                  Done
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === 'remove-confirm' && removeTarget ? (
        <div className="modal-overlay" role="presentation" onClick={() => setActiveModal('none')}>
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Remove Storage</p>
                <h2 id="remove-title">Remove {removeTarget.name}?</h2>
              </div>

              <Button
                family="icon"
                size="sm"
                className="modal-close"
                type="button"
                onClick={() => setActiveModal('none')}
                aria-label="Close modal"
              >
                ×
              </Button>
            </div>

            <div className="confirm-copy">
              <p>This removes the saved connection from Cloud Weave.</p>
              <p className="confirm-provider">{getProviderLabel(removeTarget.provider)}</p>
              {removeError ? <p className="error-text">{removeError}</p> : null}
            </div>

            <div className="modal-actions">
              <Button family="secondary" type="button" onClick={() => setActiveModal('none')}>
                Cancel
              </Button>
              <Button family="primary" tone="danger" type="button" onClick={() => void handleDeleteRemote()} disabled={isRemoving}>
                {isRemoving ? 'Removing...' : 'Remove'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === 'upload' ? (
        <div className="modal-overlay" role="presentation" onClick={closeUploadModal}>
          <div className="full-modal upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Upload</p>
                <h2 id="upload-title">Send files to Cloud Weave</h2>
              </div>

              <Button family="icon" size="sm" className="modal-close" type="button" onClick={closeUploadModal} aria-label="Close upload modal">
                ×
              </Button>
            </div>

            <div className="upload-body">
              <div className={`upload-dropzone ${isUploadDragActive ? 'active' : ''}`}>
                <p className="upload-dropzone-title">Drop files or folders here</p>
                <p className="upload-dropzone-copy">
                  Browse from disk or drop files here to add them to the upload list.
                </p>

                <div className="upload-picker-actions">
                  <Button family="primary" type="button" onClick={() => void handleChooseUploadFiles()} disabled={isPreparingUpload || isStartingUpload}>
                    {isPreparingUpload ? 'Preparing...' : 'Browse files'}
                  </Button>
                  <Button family="secondary" type="button" onClick={() => void handleChooseUploadFolder()} disabled={isPreparingUpload || isStartingUpload}>
                    {isPreparingUpload ? 'Preparing...' : 'Browse folder'}
                  </Button>
                </div>
              </div>

              {uploadBatch?.notices.map((notice) => (
                <p key={notice} className="pending-help">
                  {notice}
                </p>
              ))}
              {uploadError ? <p className="error-text">{uploadError}</p> : null}

              {shouldShowPreparingUploadList ? (
                <p className="upload-preparing-summary" role="status" aria-live="polite">
                  {preparingUploadItems.length} file{preparingUploadItems.length === 1 ? '' : 's'} selected
                </p>
              ) : null}

              {hasUploadItems || shouldShowPreparingUploadList ? (
                <>
                  <div className="upload-list-header" aria-hidden="true">
                    <span>Name</span>
                    <span>Status</span>
                    <span>Path</span>
                    <span>Storage</span>
                  </div>
                  <div className="upload-queue" role="list" aria-label="Upload list">
                    {uploadListItems.map(({ item, state }) => (
                      <UploadListItem key={item.itemId} item={item} state={state} />
                    ))}
                    {preparingUploadItems.map((item) => (
                      <PreparingUploadListItem key={item.id} item={item} />
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            {hasUploadItems ? (
              <div className="modal-actions">
                <Button family="secondary" type="button" onClick={resetUploadBatch} disabled={!hasUploadItems || isPreparingUpload}>
                  Clear
                </Button>
                <Button family="primary" type="button" onClick={() => void handleStartUpload()} disabled={!canStartUpload}>
                  {isPreparingUpload ? 'Preparing...' : isStartingUpload ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      </main>
    </>
  )
}

function UnifiedListItem({
  item,
  downloadState,
  openState,
  onOpen,
  onDownload,
  isRowMenuOpen,
  onToggleRowMenu,
  onCloseRowMenu,
}: {
  item: UnifiedItem
  downloadState: DownloadState
  openState: OpenState
  onOpen: (item: UnifiedItem) => Promise<void>
  onDownload: (item: UnifiedItem) => Promise<void>
  isRowMenuOpen: boolean
  onToggleRowMenu: () => void
  onCloseRowMenu: () => void
}) {
  const isBusy = downloadState.status === 'queued' || downloadState.status === 'running'
  const canPreview = canPreviewItem(item)
  const canOpen = canOpenInDefaultApp(item)
  const isPreparingOpen = openState.status === 'preparing'
  const actionLabel =
    downloadState.status === 'succeeded' ? 'Download again' : isBusy ? 'Downloading...' : 'Download'
  const canPrimaryOpen = canPreview || canOpen
  const hasOverflowActions = !item.isDir
  const statusLabel = getListItemStatusLabel(item, downloadState, openState)
  const listPath = formatListPath(item)
  const primaryActionLabel = canPreview ? (isPreparingOpen ? 'Previewing...' : 'Preview') : (isPreparingOpen ? 'Opening...' : 'Open')

  return (
    <article
      className={`unified-item list-item ${isRowMenuOpen ? 'row-menu-open' : ''}`}
      data-row-id={item.id}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return
        }

        if (event.key === 'Enter' && canPrimaryOpen) {
          event.preventDefault()
          void onOpen(item)
        }
      }}
      onDoubleClick={() => {
        if (canPrimaryOpen) {
          void onOpen(item)
        }
      }}
    >
      <div className="item-primary">
        <div className="item-leading">
          <span className={`item-monogram ${item.category}`} aria-hidden="true">
            {getCategoryMonogram(item.category)}
          </span>
        </div>

        <div className="item-copy">
          <div className="item-title-row">
            <p className="item-name">{item.name}</p>
          </div>
        </div>
      </div>

      <p className="item-cell item-storage-cell">{item.sourceRemote}</p>
      <div className="item-path-cell">
        <div className="item-path-anchor">
          <p className="item-path">{listPath}</p>
          <span className="path-tooltip" role="tooltip">
            {listPath}
          </span>
        </div>
      </div>

      <p className="item-cell item-modified-cell">{formatModifiedTime(item.modTime)}</p>
      <p className="item-cell item-size-cell">{formatFileSize(item.size)}</p>

      <div className="item-status-cell">
        <p className={`item-status-label ${downloadState.status === 'failed' || openState.status === 'failed' ? 'danger' : ''}`}>{statusLabel}</p>
      </div>

      {hasOverflowActions ? (
        <div
          className="item-actions"
          aria-label="Row actions"
          data-row-menu-container="true"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <Button
            family="icon"
            size="sm"
            className="item-actions-trigger"
            type="button"
            aria-label={`More actions for ${item.name}`}
            aria-haspopup="menu"
            aria-expanded={isRowMenuOpen}
            onClick={onToggleRowMenu}
          >
            …
          </Button>

          {isRowMenuOpen ? (
            <div className="row-action-menu" role="menu" aria-label={`Actions for ${item.name}`}>
              {canPrimaryOpen ? (
                <button
                  className="row-menu-item"
                  type="button"
                  role="menuitem"
                  disabled={isPreparingOpen}
                  onClick={() => {
                    onCloseRowMenu()
                    void onOpen(item)
                  }}
                >
                  {primaryActionLabel}
                </button>
              ) : null}
              <button
                className="row-menu-item"
                type="button"
                role="menuitem"
                disabled={isBusy}
                onClick={() => {
                  onCloseRowMenu()
                  void onDownload(item)
                }}
              >
                {actionLabel}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function UploadListItem({
  item,
  state,
}: {
  item: PreparedUploadItem
  state: UploadState
}) {
  const pathLabel = getUploadListPath(item, state)
  const storageLabel = getUploadListStorage(item, state)

  return (
    <article className="upload-queue-item" role="listitem">
      <p className="upload-item-name">{item.displayName}</p>
      <p className={`upload-item-status ${state.status === 'failed' ? 'danger' : ''}`}>{getUploadListStatusLabel(state)}</p>
      <p className="upload-item-path">{pathLabel}</p>
      <p className="upload-item-storage">{storageLabel}</p>
    </article>
  )
}

function PreparingUploadListItem({ item }: { item: PreparingUploadItem }) {
  return (
    <article className="upload-queue-item preparing" role="listitem" aria-hidden="true">
      <p className="upload-item-name">{item.displayName}</p>
      <p className="upload-item-status">Preparing...</p>
      <p className="upload-item-path">
        <span className="upload-skeleton path" />
      </p>
      <p className="upload-item-storage">
        <span className="upload-skeleton storage" />
      </p>
    </article>
  )
}

function ListHeader() {
  return (
    <div className="item-list-header" aria-hidden="true">
      <span>Name</span>
      <span>Storage</span>
      <span>Path</span>
      <span>Modified</span>
      <span>Size</span>
      <span>Status</span>
    </div>
  )
}

function LoadingList({ count = 6, className = '' }: { count?: number; className?: string }) {
  const classes = className ? `loading-list ${className}` : 'loading-list'

  return (
    <div className={classes} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <article key={`loading-row-${index}`} className="unified-item list-item loading-row">
          <div className="item-primary">
            <div className="item-leading">
              <span className="item-monogram loading-monogram" />
            </div>

            <div className="item-copy">
              <div className="item-title-row">
                <span className="loading-placeholder name" />
              </div>
            </div>
          </div>

          <p className="item-cell item-storage-cell">
            <span className="loading-placeholder storage" />
          </p>

          <div className="item-path-cell">
            <span className="loading-placeholder path" />
          </div>

          <p className="item-cell item-modified-cell">
            <span className="loading-placeholder modified" />
          </p>

          <p className="item-cell item-size-cell">
            <span className="loading-placeholder size" />
          </p>

          <div className="item-status-cell">
            <span className="loading-placeholder status" />
          </div>
        </article>
      ))}
    </div>
  )
}

function StreamingLoadingTail() {
  return (
    <>
      <p className="loading-list-copy streaming-tail" role="status" aria-live="polite">
        Loading more files...
      </p>
      <LoadingList count={3} className="streaming-tail" />
    </>
  )
}

function getUploadListStatusLabel(state: UploadState): string {
  switch (state.status) {
    case 'queued':
    case 'running':
    case 'retrying':
      return 'Uploading'
    case 'succeeded':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'idle':
      return 'Ready'
  }
}

function getUploadListPath(item: PreparedUploadItem, state: UploadState): string {
  if (state.remotePath) {
    return `/${state.remotePath.replace(/^\/+/, '')}`
  }

  const primaryCandidate = item.candidates[0]
  const normalizedRelativePath = item.relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const basePath = primaryCandidate?.basePath?.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') ?? ''

  if (!basePath) {
    return normalizedRelativePath ? `/${normalizedRelativePath}` : '/'
  }

  return normalizedRelativePath ? `/${basePath}/${normalizedRelativePath}` : `/${basePath}`
}

function getUploadListStorage(item: PreparedUploadItem, state: UploadState): string {
  return state.remoteName ?? item.candidates[0]?.remoteName ?? 'Pending'
}

function IssuesModal({
  issues,
  focusedIssueId,
  onReportIssue,
  onClose,
}: {
  issues: WorkspaceIssue[]
  focusedIssueId: string | null
  onReportIssue: () => void
  onClose: () => void
}) {
  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="issues-modal" role="dialog" aria-modal="true" aria-labelledby="issues-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Issues</p>
            <h2 id="issues-title">Workspace issues</h2>
          </div>

          <Button family="icon" size="sm" className="modal-close" type="button" onClick={onClose} aria-label="Close issues modal">
            ×
          </Button>
        </div>

        <div className="issues-feedback-actions">
          <Button family="secondary" size="sm" type="button" onClick={onReportIssue}>
            Report issue
          </Button>
        </div>

        {issues.length === 0 ? (
          <div className="main-empty-state compact issues-empty-state">
            <p className="eyebrow">Issues</p>
            <h2>No issues right now.</h2>
            <p>Cloud Weave will show skipped folders, reconnect problems, and similar notices here.</p>
          </div>
        ) : (
          <div className="issues-list" role="list" aria-label="Workspace issues">
            {issues.map((issue) => (
              <article
                key={issue.id}
                className={`issue-item ${issue.level} ${focusedIssueId === issue.id ? 'focused' : ''}`}
                role="listitem"
              >
                <div className="issue-item-header">
                  <span className={`storage-status-badge ${issue.level === 'error' ? 'warning' : 'neutral'}`}>{issue.level}</span>
                  <span className="issue-item-time">{formatIssueTimestamp(issue.timestamp)}</span>
                </div>
                <p className="issue-item-message">{issue.message}</p>
                <div className="issue-item-meta">
                  <span>{describeIssueSource(issue.source)}</span>
                  <span>{describeIssueLocation(issue.source)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FeedbackPromptModal({
  isExportingDiagnostics,
  isOpeningFeedbackForm,
  onClose,
  onContinue,
}: {
  isExportingDiagnostics: boolean
  isOpeningFeedbackForm: boolean
  onClose: () => void
  onContinue: () => void
}) {
  const isContinuing = isExportingDiagnostics || isOpeningFeedbackForm
  const continueLabel = isExportingDiagnostics
    ? 'Preparing diagnostics...'
    : isOpeningFeedbackForm
      ? 'Opening form...'
      : 'Continue'

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="confirm-modal feedback-prompt-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-prompt-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Feedback</p>
            <h2 id="feedback-prompt-title">Send feedback</h2>
          </div>

          <Button family="icon" size="sm" className="modal-close" type="button" onClick={onClose} aria-label="Close feedback prompt">
            ×
          </Button>
        </div>

        <div className="feedback-prompt-copy">
          <p>Cloud Weave will save a diagnostics ZIP to your Downloads folder.</p>
          <p>You will attach that ZIP in the feedback form next.</p>
          <p>The feedback form will open in your browser after the ZIP is prepared.</p>
          <p>Do not include personal or sensitive information.</p>
        </div>

        <div className="modal-actions">
          <Button family="quiet" type="button" onClick={onClose} disabled={isContinuing}>
            Cancel
          </Button>
          <Button family="primary" type="button" onClick={onContinue} disabled={isContinuing}>
            {continueLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

function PreviewModal({
  payload,
  onClose,
}: {
  payload: PreviewPayload
  onClose: () => void
}) {
  const assetUrl = convertFileSrc(payload.localPath, PREVIEW_ASSET_PROTOCOL)
  const [previewUrl, setPreviewUrl] = useState<string | null>(payload.previewKind === 'image' ? assetUrl : null)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    if (payload.previewKind === 'image') {
      setPreviewUrl(assetUrl)
      setPreviewError('')
      return
    }

    let isActive = true
    let objectUrl: string | null = null

    setPreviewUrl(null)
    setPreviewError('')

    void fetch(assetUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Preview request failed with ${response.status}`)
        }

        const blob = await response.blob()
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))

        if (isActive) {
          setPreviewUrl(objectUrl)
        }
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return
        }

        setPreviewError(error instanceof Error ? error.message : 'The preview could not be displayed here.')
      })

    return () => {
      isActive = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [assetUrl, payload.previewKind])

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">{payload.previewKind === 'image' ? 'Image Preview' : 'PDF Preview'}</p>
            <h2 id="preview-title">{payload.itemName}</h2>
          </div>

          <Button family="icon" size="sm" className="modal-close" type="button" onClick={onClose} aria-label="Close preview">
            ×
          </Button>
        </div>

        <div className="preview-surface">
          {previewError ? (
            <div className="preview-fallback">
              <p>The preview could not be displayed here.</p>
              <p>{previewError}</p>
            </div>
          ) : payload.previewKind === 'image' && previewUrl ? (
            <img className="preview-image" src={assetUrl} alt={payload.itemName} />
          ) : payload.previewKind === 'pdf' && previewUrl ? (
            <object className="preview-frame" data={previewUrl} type="application/pdf" aria-label={payload.itemName}>
              <div className="preview-fallback">
                <p>PDF preview is unavailable in this view.</p>
              </div>
            </object>
          ) : (
            <div className="preview-fallback">
              <p>Loading preview...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getProviderLabel(provider: string): string {
  switch (provider) {
    case 'onedrive':
      return 'OneDrive'
    case 'gdrive':
      return 'Google Drive'
    case 'dropbox':
      return 'Dropbox'
    case 'icloud':
      return 'iCloud Drive'
    default:
      return provider
  }
}

function formatListPath(item: UnifiedItem): string {
  const normalizedPath = item.sourcePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

  if (!normalizedPath) {
    return '/'
  }

  if (item.isDir) {
    return `/${normalizedPath}`
  }

  const lastSeparatorIndex = normalizedPath.lastIndexOf('/')

  if (lastSeparatorIndex < 0) {
    return '/'
  }

  const parentPath = normalizedPath.slice(0, lastSeparatorIndex)

  return parentPath ? `/${parentPath}` : '/'
}

function normalizeDialogSelection(selection: string | string[] | null): string[] {
  if (!selection) {
    return []
  }

  return Array.isArray(selection) ? selection : [selection]
}

function toUploadSelections(paths: string[], kind: UploadSelection['kind'] = 'file'): UploadSelection[] {
  return paths.map((path) => ({ path, kind }))
}

function getUploadSelectionDisplayName(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/, '')

  if (!normalizedPath) {
    return path
  }

  const segments = normalizedPath.split('/')
  return segments[segments.length - 1] || normalizedPath
}

export default App
