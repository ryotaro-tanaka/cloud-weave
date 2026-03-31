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
  describeUploadTarget,
  formatUploadItemMeta,
  getUploadBatchSummary,
  getUploadStateSummary,
  IDLE_UPLOAD_STATE,
  type PreparedUploadBatch,
  type PreparedUploadItem,
  type UploadAcceptedResult,
  type UploadProgressEvent,
  type UploadSelection,
  type UploadState,
} from './features/storage/uploads'
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
type ToastNotice = {
  id: string
  issueId: string
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
const TOAST_DURATION_MS = 4800
const SORT_OPTIONS: Array<{ value: UnifiedItemSortKey; label: string }> = [
  { value: 'updated-desc', label: 'Newest' },
  { value: 'updated-asc', label: 'Oldest' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
  { value: 'size-desc', label: 'Size ↓' },
  { value: 'size-asc', label: 'Size ↑' },
]

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

function describeIssueSource(source: string): string {
  if (source.startsWith('storage:')) {
    return source.replace('storage:', '')
  }

  if (source === 'library-stream') {
    return 'Unified library'
  }

  return 'Workspace'
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
  const [activeModal, setActiveModal] = useState<ModalName>('none')
  const [addFlowStep, setAddFlowStep] = useState<AddFlowStep>('providers')
  const [selectedProvider, setSelectedProvider] = useState<StorageProvider>('onedrive')
  const [activeView, setActiveView] = useState<LogicalView>('recent')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<UnifiedItemSortKey>(getDefaultSortKey('recent'))
  const [remotes, setRemotes] = useState<RemoteSummary[]>([])
  const [unifiedItems, setUnifiedItems] = useState<UnifiedItem[]>([])
  const [workspaceIssues, setWorkspaceIssues] = useState<WorkspaceIssue[]>([])
  const [toastNotices, setToastNotices] = useState<ToastNotice[]>([])
  const [isIssuesModalOpen, setIsIssuesModalOpen] = useState(false)
  const [focusedIssueId, setFocusedIssueId] = useState<string | null>(null)
  const [isTransfersModalOpen, setIsTransfersModalOpen] = useState(false)
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false)
  const [hoveredRemote, setHoveredRemote] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<RemoteSummary | null>(null)
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null)
  const [selectedDriveId, setSelectedDriveId] = useState('')
  const [isLoadingRemotes, setIsLoadingRemotes] = useState(true)
  const [isLoadingItems, setIsLoadingItems] = useState(true)
  const [isLibraryStreaming, setIsLibraryStreaming] = useState(false)
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
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [isPreparingUpload, setIsPreparingUpload] = useState(false)
  const [isStartingUpload, setIsStartingUpload] = useState(false)
  const [isUploadDragActive, setIsUploadDragActive] = useState(false)
  const [isUploadBrowseChooserOpen, setIsUploadBrowseChooserOpen] = useState(false)
  const [hasPendingUploadRefresh, setHasPendingUploadRefresh] = useState(false)
  const [, setLibraryLoadProgress] = useState<LibraryLoadProgress>({
    requestId: null,
    loadedRemoteCount: 0,
    totalRemoteCount: 0,
  })
  const activeLibraryRequestIdRef = useRef<string | null>(null)
  const uploadBrowseFilesButtonRef = useRef<HTMLButtonElement | null>(null)
  const toastTimeoutsRef = useRef<Record<string, number>>({})
  const sortMenuRef = useRef<HTMLDivElement | null>(null)

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
  const visibleToasts = useMemo(
    () =>
      toastNotices
        .map((toast) => ({
          toast,
          issue: workspaceIssues.find((issue) => issue.id === toast.issueId) ?? null,
        }))
        .filter((entry): entry is { toast: ToastNotice; issue: WorkspaceIssue } => entry.issue !== null),
    [toastNotices, workspaceIssues],
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
  const transferItems = useMemo(() => {
    if (!uploadBatch) {
      return []
    }

    return uploadBatch.items.map((item) => ({
      item,
      state: uploadStates[item.itemId] ?? IDLE_UPLOAD_STATE,
    }))
  }, [uploadBatch, uploadStates])
  const currentViewLabel = getCategoryLabel(activeView)

  const dismissToast = (toastId: string) => {
    const timeoutId = toastTimeoutsRef.current[toastId]
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      delete toastTimeoutsRef.current[toastId]
    }

    setToastNotices((current) => current.filter((toast) => toast.id !== toastId))
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

    setToastNotices((current) => {
      const nextToasts = createdIssues.map((issue) => {
        const toastId = `toast:${issue.id}:${issue.timestamp}`

        toastTimeoutsRef.current[toastId] = window.setTimeout(() => {
          dismissToast(toastId)
        }, TOAST_DURATION_MS)

        return {
          id: toastId,
          issueId: issue.id,
        }
      })

      return [...nextToasts, ...current]
    })
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
      setRemotes([])
      return null
    } finally {
      if (!silent) {
        setIsLoadingRemotes(false)
      }
    }
  }

  const fetchUnifiedItems = async (nextRemotes?: RemoteSummary[] | null, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    const resolvedRemotes = nextRemotes === undefined ? remotes : nextRemotes

    if (!silent) {
      setIsLoadingItems(true)
    }

    if (!resolvedRemotes || resolvedRemotes.length === 0) {
      setUnifiedItems([])
      setItemsError('')
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
      setUnifiedItems([])
      return null
    } finally {
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
    void initializeLibrary()
  }, [])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
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
  }, [activeModal])

  useEffect(() => {
    if (!isUploadBrowseChooserOpen) {
      return
    }

    uploadBrowseFilesButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      setIsUploadBrowseChooserOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isUploadBrowseChooserOpen])

  const initializeLibrary = async () => {
    setIsLoadingItems(true)
    setIsLibraryStreaming(false)
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
        activeLibraryRequestIdRef.current = null
      }
    } catch (error) {
      setItemsError(error instanceof Error ? error.message : String(error))
      setIsLoadingItems(false)
      setIsLibraryStreaming(false)
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

    if (uploadSummary.completed === 0) {
      setHasPendingUploadRefresh(false)
      return
    }

    setHasPendingUploadRefresh(false)
    void refreshLibrary({ silent: true })
  }, [hasPendingUploadRefresh, isStartingUpload, uploadSummary.active, uploadSummary.completed])

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
    setIsUploadBrowseChooserOpen(false)
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
    setUploadStates({})
    setUploadError('')
    setIsPreparingUpload(false)
    setIsStartingUpload(false)
    setIsUploadDragActive(false)
    setHasPendingUploadRefresh(false)
  }

  const prepareUploadSelections = async (selections: UploadSelection[]) => {
    if (selections.length === 0) {
      return
    }

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
    }
  }

  const handleChooseUploadFiles = async () => {
    setIsUploadBrowseChooserOpen(false)

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
    setIsUploadBrowseChooserOpen(false)

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

  const handleOpenUploadBrowseChooser = () => {
    if (isPreparingUpload || isStartingUpload) {
      return
    }

    setIsUploadBrowseChooserOpen(true)
  }

  const handleStartUpload = async () => {
    if (!uploadBatch || uploadBatch.items.length === 0) {
      setUploadError('Add files or folders before starting the upload.')
      return
    }

    setIsStartingUpload(true)
    setUploadError('')
    setHasPendingUploadRefresh(true)

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
    !!uploadBatch && uploadBatch.items.length > 0 && uploadSummary.active === 0 && !isPreparingUpload && !isStartingUpload

  const handleOpen = async (item: UnifiedItem) => {
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
  const emptyListTitle = searchQuery ? `No files match "${searchQuery.trim()}".` : `No files in ${currentViewLabel} yet.`
  const emptyListDescription = searchQuery
    ? 'Try a different search or switch to another view.'
    : 'Files added to this view will appear here.'

  return (
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
                <button className="sidebar-add-button" type="button" onClick={openAddModal}>
                  + Add storage
                </button>
              </div>

              {isLoadingRemotes ? <p className="empty-state">Loading storage...</p> : null}
              {!isLoadingRemotes && listError ? <p className="error-text">{listError}</p> : null}
              {shouldShowNoStorageState ? <p className="empty-state">No storage connected yet.</p> : null}

              {!isLoadingRemotes && !listError && displayedRemotes.length > 0 ? (
                <ul className="storage-nav-list">
                  {displayedRemotes.map((remote) => {
                    const isHovered = hoveredRemote === remote.name
                    const needsReconnect = remote.status === 'reconnect_required'

                    return (
                      <li
                        key={remote.name}
                        className={`storage-nav-item ${isHovered ? 'hovered' : ''}`}
                        onMouseEnter={() => setHoveredRemote(remote.name)}
                        onMouseLeave={() => setHoveredRemote((current) => (current === remote.name ? null : current))}
                      >
                        <div className="storage-nav-copy">
                          <div className="storage-nav-title-row">
                            <p className="remote-name">{remote.name}</p>
                            <span className={`storage-status-badge ${needsReconnect ? 'warning' : 'neutral'}`}>
                              {needsReconnect ? 'Reconnect' : 'Connected'}
                            </span>
                          </div>
                          <p className="remote-provider">{getProviderLabel(remote.provider)}</p>
                          {needsReconnect && remote.message ? <p className="storage-nav-hint">{remote.message}</p> : null}
                        </div>

                        <div className="storage-nav-actions">
                          {needsReconnect ? (
                            <button className="storage-action-button warning" type="button" onClick={() => void handleReconnect(remote)}>
                              Reconnect
                            </button>
                          ) : null}
                          <button className="storage-action-button" type="button" onClick={() => openRemoveModal(remote)}>
                            Remove
                          </button>
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
                  <button
                    className="toolbar-select-trigger"
                    type="button"
                    aria-label="Sort files"
                    aria-haspopup="menu"
                    aria-expanded={isSortMenuOpen}
                    onClick={() => setIsSortMenuOpen((current) => !current)}
                  >
                    <span className="toolbar-select-value">{getSortLabel(sortKey)}</span>
                    <span className="toolbar-select-icon" aria-hidden="true">v</span>
                  </button>

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

                <button className="issues-entry-button utility-icon-button" type="button" onClick={() => openIssuesModal()} aria-label="Open issues">
                  <span aria-hidden="true">!</span>
                  {workspaceIssues.length > 0 ? (
                    <span className="issues-entry-badge">{unreadIssueCount > 0 ? unreadIssueCount : workspaceIssues.length}</span>
                  ) : null}
                </button>
                <button
                  className="issues-entry-button utility-icon-button"
                  type="button"
                  onClick={() => setIsTransfersModalOpen(true)}
                  aria-label="Open transfers"
                >
                  <span aria-hidden="true">^</span>
                  {uploadSummary.total > 0 ? (
                    <span className="issues-entry-badge">{uploadSummary.active > 0 ? uploadSummary.active : uploadSummary.total}</span>
                  ) : null}
                </button>
                <button className="primary-button" type="button" onClick={openUploadModal} disabled={!hasConnectedStorage}>
                  Upload
                </button>
              </div>
            </div>

          </header>

          <div className="library-content">
            {isLoadingItems && hasConnectedStorage && unifiedItems.length === 0 ? (
              <p className="empty-state">Loading your unified library...</p>
            ) : null}
            {!isLoadingItems && itemsError ? <p className="error-text">{itemsError}</p> : null}

            {shouldShowNoStorageState ? (
              <div className="main-empty-state">
                <p className="eyebrow">Unified Library</p>
                <h1>Your files will appear here.</h1>
                <p>Connect a storage from the sidebar to start browsing everything in one place.</p>
                <div className="empty-state-actions">
                  <button className="ghost-button" type="button" onClick={openAddModal}>
                    Connect storage
                  </button>
                  <button className="primary-button" type="button" onClick={openUploadModal} disabled={!hasConnectedStorage}>
                    Upload
                  </button>
                </div>
              </div>
            ) : null}

            {((!isLoadingItems || unifiedItems.length > 0) && !itemsError && hasConnectedStorage) ? (
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
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
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
                    <div className="item-list">
                      {displayedItems.map((item) => (
                        <UnifiedListItem
                          key={item.id}
                          item={item}
                          downloadState={downloadStates[item.id] ?? IDLE_DOWNLOAD_STATE}
                          openState={openStates[item.id] ?? IDLE_OPEN_STATE}
                          onOpen={handleOpen}
                          onDownload={handleDownload}
                        />
                      ))}
                    </div>
                  )}
                </>
              )
            ) : null}
          </div>
        </div>
      </section>

      {visibleToasts.length > 0 ? (
        <div className="toast-stack" aria-live="polite" aria-label="Workspace issues">
          {visibleToasts.map(({ toast, issue }) => (
            <div key={toast.id} className={`toast-notice ${issue.level}`}>
              <div className="toast-copy">
                <p>{issue.message}</p>
                <span>{formatIssueTimestamp(issue.timestamp)}</span>
              </div>
              <button className="ghost-button toast-action" type="button" onClick={() => openIssuesModal(issue.id)}>
                View details
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {uploadSummary.total > 0 ? (
        <div className="transfer-tray" aria-live="polite">
          <div className="transfer-tray-copy">
            <p>{uploadSummary.label}</p>
            <span>
              {uploadSummary.active > 0
                ? `${uploadSummary.active} in progress`
                : `${uploadSummary.completed} complete • ${uploadSummary.failed} failed`}
            </span>
          </div>
          <button className="ghost-button transfer-tray-action" type="button" onClick={() => setIsTransfersModalOpen(true)}>
            View transfers
          </button>
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
          onClose={() => {
            setIsIssuesModalOpen(false)
            setFocusedIssueId(null)
          }}
        />
      ) : null}

      {isTransfersModalOpen ? (
        <TransfersModal
          items={transferItems}
          onClose={() => setIsTransfersModalOpen(false)}
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

              <button className="icon-button modal-close" type="button" onClick={closeAddModal} aria-label="Close modal">
                ×
              </button>
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
                  <button className="ghost-button" type="button" onClick={() => setAddFlowStep('providers')}>
                    Back
                  </button>
                  <button className="primary-button" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Starting...' : `Connect ${selectedProviderConfig.label}`}
                  </button>
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

              <button className="icon-button modal-close" type="button" onClick={closePendingModal} aria-label="Close modal">
                ×
              </button>
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
                    <button className="primary-button" type="button" onClick={() => void handlePendingRemoveAndReconnect()}>
                      Remove and connect again
                    </button>
                  ) : null}
                </>
              ) : pendingSession.status === 'requires_drive_selection' ? (
                <>
                  <button className="ghost-button" type="button" onClick={closePendingModal}>
                    Cancel
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void handlePendingRemoveAndReconnect()}>
                    Remove and start over
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void handleFinalizeDriveSelection()}
                    disabled={!selectedDriveId || isFinalizingDrive}
                  >
                    {isFinalizingDrive ? 'Connecting...' : 'Use this drive'}
                  </button>
                </>
              ) : pendingSession.status === 'connected' ? (
                <button className="primary-button" type="button" onClick={handlePendingDone}>
                  Done
                </button>
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

              <button
                className="icon-button modal-close"
                type="button"
                onClick={() => setActiveModal('none')}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>

            <div className="confirm-copy">
              <p>This removes the saved connection from Cloud Weave.</p>
              <p className="confirm-provider">{getProviderLabel(removeTarget.provider)}</p>
              {removeError ? <p className="error-text">{removeError}</p> : null}
            </div>

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setActiveModal('none')}>
                Cancel
              </button>
              <button className="primary-button destructive" type="button" onClick={() => void handleDeleteRemote()} disabled={isRemoving}>
                {isRemoving ? 'Removing...' : 'Remove'}
              </button>
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

              <button className="icon-button modal-close" type="button" onClick={closeUploadModal} aria-label="Close upload modal">
                ×
              </button>
            </div>

            <div className="upload-body">
              <div className={`upload-dropzone ${isUploadDragActive ? 'active' : ''}`}>
                <p className="upload-dropzone-title">Drop files or folders here</p>
                <p className="upload-dropzone-copy">
                  Cloud Weave keeps folder structure, classifies files by category, and routes them to the best connected destination.
                </p>

                <div className="upload-picker-actions">
                  <button className="ghost-button" type="button" onClick={handleOpenUploadBrowseChooser} disabled={isPreparingUpload || isStartingUpload}>
                    Browse…
                  </button>
                </div>

                {isUploadBrowseChooserOpen ? (
                  <div
                    className="upload-browse-chooser-backdrop"
                    role="presentation"
                    onClick={() => setIsUploadBrowseChooserOpen(false)}
                  >
                    <div
                      className="upload-browse-chooser"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="upload-browse-title"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <p id="upload-browse-title" className="upload-browse-chooser-title">
                        What would you like to add?
                      </p>
                      <p className="upload-browse-chooser-copy">
                        Choose files or a folder, then Cloud Weave will open the matching system picker.
                      </p>
                      <div className="upload-browse-chooser-actions">
                        <button
                          ref={uploadBrowseFilesButtonRef}
                          className="primary-button"
                          type="button"
                          onClick={() => void handleChooseUploadFiles()}
                          disabled={isPreparingUpload || isStartingUpload}
                        >
                          Choose files
                        </button>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => void handleChooseUploadFolder()}
                          disabled={isPreparingUpload || isStartingUpload}
                        >
                          Choose folder
                        </button>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => setIsUploadBrowseChooserOpen(false)}
                          disabled={isPreparingUpload || isStartingUpload}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="upload-summary-card">
                <p className="upload-summary-label">{uploadSummary.label}</p>
                <p className="upload-summary-meta">
                  {uploadSummary.total > 0
                    ? `${uploadSummary.completed} complete • ${uploadSummary.failed} failed • ${uploadSummary.total} total`
                    : 'No files queued yet'}
                </p>
                {uploadBatch?.notices.map((notice) => (
                  <p key={notice} className="pending-help">
                    {notice}
                  </p>
                ))}
                {uploadError ? <p className="error-text">{uploadError}</p> : null}
              </div>

              {uploadBatch?.items.length ? (
                <div className="upload-queue" role="list" aria-label="Upload queue">
                  {uploadBatch.items.map((item) => (
                    <UploadQueueItem
                      key={item.itemId}
                      item={item}
                      state={uploadStates[item.itemId] ?? IDLE_UPLOAD_STATE}
                    />
                  ))}
                </div>
              ) : (
                <div className="main-empty-state compact upload-empty-state">
                  <p className="eyebrow">Queue</p>
                  <h2>Nothing queued yet.</h2>
                  <p>Drop a folder or choose files from disk to prepare the upload batch.</p>
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={resetUploadBatch} disabled={uploadSummary.active > 0}>
                Clear
              </button>
              <button className="primary-button" type="button" onClick={() => void handleStartUpload()} disabled={!canStartUpload}>
                {isPreparingUpload ? 'Preparing...' : isStartingUpload ? 'Starting...' : 'Start upload'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

function UnifiedListItem({
  item,
  downloadState,
  openState,
  onOpen,
  onDownload,
}: {
  item: UnifiedItem
  downloadState: DownloadState
  openState: OpenState
  onOpen: (item: UnifiedItem) => Promise<void>
  onDownload: (item: UnifiedItem) => Promise<void>
}) {
  const isBusy = downloadState.status === 'queued' || downloadState.status === 'running'
  const canPreview = canPreviewItem(item)
  const canOpen = canOpenInDefaultApp(item)
  const isPreparingOpen = openState.status === 'preparing'
  const actionLabel =
    downloadState.status === 'succeeded' ? 'Download again' : isBusy ? 'Downloading...' : 'Download'
  const canPrimaryOpen = canPreview || canOpen
  const hasActions = !item.isDir
  const statusLabel = getListItemStatusLabel(item, downloadState, openState)
  const listPath = formatListPath(item)

  return (
    <article
      className="unified-item list-item"
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

      <div className="item-actions" aria-label="Row actions">
        {hasActions && canPreview ? (
          <button
            className="row-action primary-open-action"
            type="button"
            onClick={() => void onOpen(item)}
            disabled={isPreparingOpen || item.isDir}
          >
            {isPreparingOpen ? 'Previewing...' : 'Preview'}
          </button>
        ) : hasActions && canOpen ? (
          <button
            className="row-action primary-open-action"
            type="button"
            onClick={() => void onOpen(item)}
            disabled={isPreparingOpen || item.isDir}
          >
            {isPreparingOpen ? 'Opening...' : 'Open'}
          </button>
        ) : null}
        {!item.isDir ? (
          <button className="row-action" type="button" onClick={() => void onDownload(item)} disabled={isBusy || item.isDir}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </article>
  )
}

function UploadQueueItem({
  item,
  state,
}: {
  item: PreparedUploadItem
  state: UploadState
}) {
  const isRunning = state.status === 'queued' || state.status === 'running' || state.status === 'retrying'

  return (
    <article className="upload-queue-item" role="listitem">
      <div className="upload-queue-copy">
        <div className="item-title-row">
          <p className="item-name">{item.displayName}</p>
          <span className="source-badge">{item.category}</span>
        </div>
        <p className="upload-relative-path">{item.relativePath}</p>
        <div className="item-meta">
          <span>{formatUploadItemMeta(item)}</span>
          <span>{describeUploadTarget(item)}</span>
        </div>
      </div>

      <div className="upload-queue-status">
        <p>{getUploadStateSummary(state)}</p>
        {state.remoteName ? <p className="grid-path">{state.remoteName}</p> : null}
        {isRunning ? (
          <div className="download-progress" aria-hidden="true">
            <div className="download-progress-fill upload-progress-fill" />
          </div>
        ) : null}
      </div>
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

function TransferListItem({
  item,
  state,
}: {
  item: PreparedUploadItem
  state: UploadState
}) {
  const isRunning = state.status === 'queued' || state.status === 'running' || state.status === 'retrying'
  const transferPath = state.remotePath ?? item.relativePath
  const storageLabel = state.remoteName ?? item.candidates[0]?.remoteName ?? 'Pending destination'

  return (
    <article className="transfer-item" role="listitem">
      <div className="transfer-status">
        <span className={`storage-status-badge ${state.status === 'failed' ? 'warning' : 'neutral'}`}>
          {toTransferBadgeLabel(state)}
        </span>
        {isRunning ? (
          <div className="download-progress" aria-hidden="true">
            <div className="download-progress-fill upload-progress-fill" />
          </div>
        ) : null}
      </div>

      <p className="transfer-path">{transferPath}</p>
      <p className="transfer-storage">{storageLabel}</p>
    </article>
  )
}

function toTransferBadgeLabel(state: UploadState): string {
  switch (state.status) {
    case 'queued':
    case 'running':
    case 'retrying':
      return 'In progress'
    case 'succeeded':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'idle':
      return 'Queued'
  }
}

function IssuesModal({
  issues,
  focusedIssueId,
  onClose,
}: {
  issues: WorkspaceIssue[]
  focusedIssueId: string | null
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

          <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close issues modal">
            ×
          </button>
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

function TransfersModal({
  items,
  onClose,
}: {
  items: Array<{ item: PreparedUploadItem; state: UploadState }>
  onClose: () => void
}) {
  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="issues-modal transfers-modal" role="dialog" aria-modal="true" aria-labelledby="transfers-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Transfers</p>
            <h2 id="transfers-title">Upload activity</h2>
          </div>

          <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close transfers modal">
            ×
          </button>
        </div>

        {items.length === 0 ? (
          <div className="main-empty-state compact issues-empty-state">
            <p className="eyebrow">Transfers</p>
            <h2>No transfers yet.</h2>
            <p>Uploads will appear here after you start sending files to Cloud Weave.</p>
          </div>
        ) : (
          <>
            <div className="transfer-list-header" aria-hidden="true">
              <span>Status</span>
              <span>Path</span>
              <span>Storage</span>
            </div>
            <div className="transfer-list" role="list" aria-label="Transfers">
              {items.map(({ item, state }) => (
                <TransferListItem key={item.itemId} item={item} state={state} />
              ))}
            </div>
          </>
        )}
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

          <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close preview">
            ×
          </button>
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

export default App
