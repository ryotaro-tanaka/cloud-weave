import { createContext, useContext, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import type { DownloadState } from '../../features/storage/downloads'
import type { OpenState } from '../../features/storage/openFiles'
import type { PreparedUploadBatch, UploadState } from '../../features/storage/uploads'

export type DownloadStateMap = Record<string, DownloadState>
export type OpenStateMap = Record<string, OpenState>
export type UploadStateMap = Record<string, UploadState>

export type PreparingUploadItem = {
  id: string
  displayName: string
}

export type TransfersState = {
  downloadStates: DownloadStateMap
  openStates: OpenStateMap

  uploadStates: UploadStateMap
  uploadBatch: PreparedUploadBatch | null
  preparingUploadItems: PreparingUploadItem[]

  uploadError: string
  isPreparingUpload: boolean
  isStartingUpload: boolean
  isUploadDragActive: boolean
  hasPendingUploadRefresh: boolean
}

export type TransfersAction =
  | { type: 'transfers/setDownloadStates'; states: DownloadStateMap }
  | { type: 'transfers/patchDownloadState'; itemId: string; state: DownloadState }
  | { type: 'transfers/setOpenStates'; states: OpenStateMap }
  | { type: 'transfers/patchOpenState'; itemId: string; state: OpenState }
  | { type: 'transfers/setUploadStates'; states: UploadStateMap }
  | { type: 'transfers/patchUploadState'; itemId: string; state: UploadState }
  | { type: 'transfers/setUploadBatch'; batch: PreparedUploadBatch | null }
  | { type: 'transfers/setPreparingUploadItems'; items: PreparingUploadItem[] }
  | { type: 'transfers/setUploadError'; error: string }
  | { type: 'transfers/setPreparingUpload'; preparing: boolean }
  | { type: 'transfers/setStartingUpload'; starting: boolean }
  | { type: 'transfers/setUploadDragActive'; active: boolean }
  | { type: 'transfers/setHasPendingUploadRefresh'; pending: boolean }

export const DEFAULT_TRANSFERS_STATE: TransfersState = {
  downloadStates: {},
  openStates: {},
  uploadStates: {},
  uploadBatch: null,
  preparingUploadItems: [],
  uploadError: '',
  isPreparingUpload: false,
  isStartingUpload: false,
  isUploadDragActive: false,
  hasPendingUploadRefresh: false,
}

export function transfersReducer(state: TransfersState, action: TransfersAction): TransfersState {
  switch (action.type) {
    case 'transfers/setDownloadStates':
      return { ...state, downloadStates: action.states }
    case 'transfers/patchDownloadState':
      return { ...state, downloadStates: { ...state.downloadStates, [action.itemId]: action.state } }
    case 'transfers/setOpenStates':
      return { ...state, openStates: action.states }
    case 'transfers/patchOpenState':
      return { ...state, openStates: { ...state.openStates, [action.itemId]: action.state } }
    case 'transfers/setUploadStates':
      return { ...state, uploadStates: action.states }
    case 'transfers/patchUploadState':
      return { ...state, uploadStates: { ...state.uploadStates, [action.itemId]: action.state } }
    case 'transfers/setUploadBatch':
      return { ...state, uploadBatch: action.batch }
    case 'transfers/setPreparingUploadItems':
      return { ...state, preparingUploadItems: action.items }
    case 'transfers/setUploadError':
      return { ...state, uploadError: action.error }
    case 'transfers/setPreparingUpload':
      return { ...state, isPreparingUpload: action.preparing }
    case 'transfers/setStartingUpload':
      return { ...state, isStartingUpload: action.starting }
    case 'transfers/setUploadDragActive':
      return { ...state, isUploadDragActive: action.active }
    case 'transfers/setHasPendingUploadRefresh':
      return { ...state, hasPendingUploadRefresh: action.pending }
    default:
      return state
  }
}

type TransfersContextValue = {
  state: TransfersState
  dispatch: (action: TransfersAction) => void
}

const TransfersContext = createContext<TransfersContextValue | null>(null)

export function TransfersProvider({
  children,
  initialState,
}: {
  children: ReactNode
  initialState?: Partial<TransfersState>
}) {
  const [state, dispatch] = useReducer(transfersReducer, { ...DEFAULT_TRANSFERS_STATE, ...initialState })
  const value = useMemo(() => ({ state, dispatch }), [state])
  return <TransfersContext.Provider value={value}>{children}</TransfersContext.Provider>
}

export function useTransfers(): TransfersContextValue {
  const value = useContext(TransfersContext)
  if (!value) {
    throw new Error('useTransfers must be used within TransfersProvider')
  }
  return value
}

