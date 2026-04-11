import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { PendingSession, RemoteSummary } from '../../features/storage/pendingState'
import type { UnifiedItem } from '../../features/storage/unifiedItems'
import { mergeUnifiedItems } from '../../features/storage/libraryLoad'

export type IssueLevel = 'info' | 'warning' | 'error'

export type WorkspaceIssue = {
  id: string
  message: string
  level: IssueLevel
  timestamp: number
  source: string
  read: boolean
}

export type ToastKind = 'info' | 'warning' | 'error' | 'success'
export type ToastAction =
  | { type: 'open-upload' }
  | { type: 'open-issues'; issueId?: string }
  | { type: 'open-path'; path: string }

export type ToastNotice = {
  id: string
  kind: ToastKind
  message: string
  timestamp: number
  source: string
  actionLabel?: string
  action?: ToastAction
}

export type WorkspaceDataState = {
  remotes: RemoteSummary[]
  unifiedItems: UnifiedItem[]

  workspaceIssues: WorkspaceIssue[]
  toastNotices: ToastNotice[]

  listError: string
  itemsError: string

  isLoadingRemotes: boolean
  isLoadingItems: boolean
  isLibraryStreaming: boolean
  isRefreshingItems: boolean

  pendingSession: PendingSession | null
  selectedDriveId: string
  isFinalizingDrive: boolean

  removeTarget: RemoteSummary | null
  removeError: string
  isRemoving: boolean
}

const TOAST_DURATION_MS = 5000

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

export type WorkspaceDataAction =
  | { type: 'data/setRemotes'; remotes: RemoteSummary[] }
  | { type: 'data/setUnifiedItems'; items: UnifiedItem[] }
  | { type: 'data/mergeUnifiedItems'; items: UnifiedItem[] }
  | { type: 'data/setWorkspaceIssues'; issues: WorkspaceIssue[] }
  | { type: 'data/setToastNotices'; toasts: ToastNotice[] }
  | { type: 'data/setListError'; error: string }
  | { type: 'data/setItemsError'; error: string }
  | { type: 'data/setLoadingRemotes'; loading: boolean }
  | { type: 'data/setLoadingItems'; loading: boolean }
  | { type: 'data/setLibraryStreaming'; streaming: boolean }
  | { type: 'data/setRefreshingItems'; refreshing: boolean }
  | { type: 'data/setPendingSession'; pending: PendingSession | null }
  | { type: 'data/setSelectedDriveId'; driveId: string }
  | { type: 'data/setFinalizingDrive'; finalizing: boolean }
  | { type: 'data/setRemoveTarget'; target: RemoteSummary | null }
  | { type: 'data/setRemoveError'; error: string }
  | { type: 'data/setRemoving'; removing: boolean }

export const DEFAULT_WORKSPACE_DATA_STATE: WorkspaceDataState = {
  remotes: [],
  unifiedItems: [],
  workspaceIssues: [],
  toastNotices: [],
  listError: '',
  itemsError: '',
  isLoadingRemotes: false,
  isLoadingItems: false,
  isLibraryStreaming: false,
  isRefreshingItems: false,
  pendingSession: null,
  selectedDriveId: '',
  isFinalizingDrive: false,
  removeTarget: null,
  removeError: '',
  isRemoving: false,
}

export function workspaceDataReducer(state: WorkspaceDataState, action: WorkspaceDataAction): WorkspaceDataState {
  switch (action.type) {
    case 'data/setRemotes':
      return { ...state, remotes: action.remotes }
    case 'data/setUnifiedItems':
      return { ...state, unifiedItems: action.items }
    case 'data/mergeUnifiedItems':
      return { ...state, unifiedItems: mergeUnifiedItems(state.unifiedItems, action.items) }
    case 'data/setWorkspaceIssues':
      return { ...state, workspaceIssues: action.issues }
    case 'data/setToastNotices':
      return { ...state, toastNotices: action.toasts }
    case 'data/setListError':
      return { ...state, listError: action.error }
    case 'data/setItemsError':
      return { ...state, itemsError: action.error }
    case 'data/setLoadingRemotes':
      return { ...state, isLoadingRemotes: action.loading }
    case 'data/setLoadingItems':
      return { ...state, isLoadingItems: action.loading }
    case 'data/setLibraryStreaming':
      return { ...state, isLibraryStreaming: action.streaming }
    case 'data/setRefreshingItems':
      return { ...state, isRefreshingItems: action.refreshing }
    case 'data/setPendingSession':
      return { ...state, pendingSession: action.pending }
    case 'data/setSelectedDriveId':
      return { ...state, selectedDriveId: action.driveId }
    case 'data/setFinalizingDrive':
      return { ...state, isFinalizingDrive: action.finalizing }
    case 'data/setRemoveTarget':
      return { ...state, removeTarget: action.target }
    case 'data/setRemoveError':
      return { ...state, removeError: action.error }
    case 'data/setRemoving':
      return { ...state, isRemoving: action.removing }
    default:
      return state
  }
}

type WorkspaceDataContextValue = {
  state: WorkspaceDataState
  dispatch: (action: WorkspaceDataAction) => void
  actions: {
    dismissToast: (toastId: string) => void
    showToast: (input: { kind: ToastKind; message: string; source: string; actionLabel?: string; action?: ToastAction }) => void
    markIssuesRead: (issueIds?: string[]) => void
    recordIssueMessages: (messages: string[], source: string) => void
    recordIssueError: (error: unknown, source: string) => void
    fetchRemotes: (options?: { silent?: boolean; demoRemotes?: RemoteSummary[] }) => Promise<RemoteSummary[] | null>
    fetchUnifiedItems: (options?: { silent?: boolean; demoItems?: UnifiedItem[]; remotesOverride?: RemoteSummary[] | null }) => Promise<UnifiedItem[] | null>
  }
}

const WorkspaceDataContext = createContext<WorkspaceDataContextValue | null>(null)

export function WorkspaceDataProvider({
  children,
  initialState,
}: {
  children: ReactNode
  initialState?: Partial<WorkspaceDataState>
}) {
  const [state, dispatch] = useReducer(workspaceDataReducer, { ...DEFAULT_WORKSPACE_DATA_STATE, ...initialState })
  const toastTimeoutsRef = useRef<Record<string, number>>({})
  const stateRef = useRef(state)
  stateRef.current = state

  const dismissToast = useCallback(
    (toastId: string) => {
      const timeoutId = toastTimeoutsRef.current[toastId]
      if (timeoutId) {
        window.clearTimeout(timeoutId)
        delete toastTimeoutsRef.current[toastId]
      }

      dispatch({
        type: 'data/setToastNotices',
        toasts: stateRef.current.toastNotices.filter((toast) => toast.id !== toastId),
      })
    },
    [dispatch],
  )

  const showToast = useCallback(
    ({ kind, message, source, actionLabel, action }: { kind: ToastKind; message: string; source: string; actionLabel?: string; action?: ToastAction }) => {
      const timestamp = Date.now()
      const toastId = `toast:${source}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`

      toastTimeoutsRef.current[toastId] = window.setTimeout(() => {
        dismissToast(toastId)
      }, TOAST_DURATION_MS)

      dispatch({
        type: 'data/setToastNotices',
        toasts: [
          {
            id: toastId,
            kind,
            message,
            timestamp,
            source,
            actionLabel,
            action,
          },
          ...stateRef.current.toastNotices,
        ],
      })
    },
    [dismissToast, dispatch],
  )

  const markIssuesRead = useCallback(
    (issueIds?: string[]) => {
      dispatch({
        type: 'data/setWorkspaceIssues',
        issues: stateRef.current.workspaceIssues.map((issue) =>
          !issueIds || issueIds.includes(issue.id)
            ? {
                ...issue,
                read: true,
              }
            : issue,
        ),
      })
    },
    [dispatch],
  )

  const recordIssueMessages = useCallback(
    (messages: string[], source: string) => {
      const normalizedMessages = messages.map((message) => message.trim()).filter(Boolean)
      if (normalizedMessages.length === 0) {
        return
      }

      const createdIssues: WorkspaceIssue[] = []
      const nextIssues = [...stateRef.current.workspaceIssues]

      for (const message of normalizedMessages) {
        const issueId = toIssueId(message, source)
        if (nextIssues.some((issue) => issue.id === issueId)) {
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
        nextIssues.unshift(issue)
      }

      if (createdIssues.length === 0) {
        return
      }

      dispatch({ type: 'data/setWorkspaceIssues', issues: nextIssues })

      for (const issue of createdIssues) {
        showToast({
          kind: issue.level === 'error' ? 'error' : issue.level === 'warning' ? 'warning' : 'info',
          message: issue.message,
          source: issue.source,
          actionLabel: 'View details',
          action: { type: 'open-issues', issueId: issue.id },
        })
      }
    },
    [dispatch, showToast],
  )

  const recordIssueError = useCallback(
    (error: unknown, source: string) => {
      const message = error instanceof Error ? error.message : String(error)
      recordIssueMessages([message], source)
    },
    [recordIssueMessages],
  )

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(toastTimeoutsRef.current)) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  const fetchRemotes = useCallback(
    async (options?: { silent?: boolean; demoRemotes?: RemoteSummary[] }) => {
      if (options?.demoRemotes) {
        dispatch({ type: 'data/setRemotes', remotes: options.demoRemotes })
        dispatch({ type: 'data/setListError', error: '' })
        dispatch({ type: 'data/setLoadingRemotes', loading: false })
        return options.demoRemotes
      }

      const silent = options?.silent ?? false
      if (!silent) {
        dispatch({ type: 'data/setLoadingRemotes', loading: true })
      }

      try {
        const result = await invoke<RemoteSummary[]>('list_storage_remotes')
        dispatch({ type: 'data/setRemotes', remotes: result })
        dispatch({ type: 'data/setListError', error: '' })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        dispatch({ type: 'data/setListError', error: message })
        recordIssueError(error, 'storage')
        dispatch({ type: 'data/setRemotes', remotes: [] })
        return null
      } finally {
        if (!silent) {
          dispatch({ type: 'data/setLoadingRemotes', loading: false })
        }
      }
    },
    [dispatch, recordIssueError],
  )

  const fetchUnifiedItems = useCallback(
    async (options?: { silent?: boolean; demoItems?: UnifiedItem[]; remotesOverride?: RemoteSummary[] | null }) => {
      if (options?.demoItems) {
        dispatch({ type: 'data/setUnifiedItems', items: options.demoItems })
        dispatch({ type: 'data/setItemsError', error: '' })
        dispatch({ type: 'data/setLoadingItems', loading: false })
        dispatch({ type: 'data/setLibraryStreaming', streaming: false })
        dispatch({ type: 'data/setRefreshingItems', refreshing: false })
        return options.demoItems
      }

      const silent = options?.silent ?? false
      const resolvedRemotes = options?.remotesOverride === undefined ? stateRef.current.remotes : options.remotesOverride

      if (!silent) {
        dispatch({ type: 'data/setLoadingItems', loading: true })
        dispatch({ type: 'data/setRefreshingItems', refreshing: false })
      } else {
        dispatch({ type: 'data/setRefreshingItems', refreshing: true })
      }

      if (!resolvedRemotes || resolvedRemotes.length === 0) {
        dispatch({ type: 'data/setUnifiedItems', items: [] })
        dispatch({ type: 'data/setItemsError', error: '' })
        dispatch({ type: 'data/setRefreshingItems', refreshing: false })
        if (!silent) {
          dispatch({ type: 'data/setLoadingItems', loading: false })
        }
        return []
      }

      try {
        const result = await invoke<{ items: UnifiedItem[]; notices: string[] }>('list_unified_items')
        dispatch({ type: 'data/setUnifiedItems', items: result.items })
        recordIssueMessages(result.notices, 'library')
        dispatch({ type: 'data/setItemsError', error: '' })
        dispatch({ type: 'data/setLibraryStreaming', streaming: false })
        return result.items
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        dispatch({ type: 'data/setItemsError', error: message })
        recordIssueError(error, 'library')
        dispatch({ type: 'data/setUnifiedItems', items: [] })
        dispatch({ type: 'data/setRefreshingItems', refreshing: false })
        if (!silent) {
          dispatch({ type: 'data/setLoadingItems', loading: false })
        }
        return null
      } finally {
        if (!silent) {
          dispatch({ type: 'data/setLoadingItems', loading: false })
        }
        dispatch({ type: 'data/setRefreshingItems', refreshing: false })
      }
    },
    [dispatch, recordIssueError, recordIssueMessages],
  )

  const actions = useMemo(
    () => ({ dismissToast, showToast, markIssuesRead, recordIssueMessages, recordIssueError, fetchRemotes, fetchUnifiedItems }),
    [dismissToast, fetchRemotes, fetchUnifiedItems, markIssuesRead, recordIssueError, recordIssueMessages, showToast],
  )

  const value = useMemo(() => ({ state, dispatch, actions }), [actions, state])
  return <WorkspaceDataContext.Provider value={value}>{children}</WorkspaceDataContext.Provider>
}

export function useWorkspaceData(): WorkspaceDataContextValue {
  const value = useContext(WorkspaceDataContext)
  if (!value) {
    throw new Error('useWorkspaceData must be used within WorkspaceDataProvider')
  }
  return value
}

