import { createContext, useContext, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import type { LogicalView, UnifiedItemSortKey } from '../../features/storage/unifiedItems'
import type { PreviewPayload } from '../../features/storage/openFiles'

export type ModalName = 'none' | 'add-storage' | 'oauth-pending' | 'remove-confirm' | 'upload'

export type WorkspaceUIState = {
  activeView: LogicalView
  searchQuery: string
  sortKey: UnifiedItemSortKey

  isSortMenuOpen: boolean
  openRowMenuItemId: string | null

  isStartupSplashVisible: boolean
  isStartupSplashExiting: boolean

  activeModal: ModalName
  previewPayload: PreviewPayload | null

  isIssuesModalOpen: boolean
  focusedIssueId: string | null

  isFeedbackPromptOpen: boolean
}

export type WorkspaceUIAction =
  | { type: 'ui/setActiveView'; view: LogicalView }
  | { type: 'ui/setSearchQuery'; query: string }
  | { type: 'ui/setSortKey'; sortKey: UnifiedItemSortKey }
  | { type: 'ui/setSortMenuOpen'; open: boolean }
  | { type: 'ui/setOpenRowMenuItemId'; itemId: string | null }
  | { type: 'ui/setStartupSplash'; visible: boolean; exiting: boolean }
  | { type: 'ui/setActiveModal'; modal: ModalName }
  | { type: 'ui/setPreviewPayload'; payload: PreviewPayload | null }
  | { type: 'ui/setIssuesModal'; open: boolean; focusedIssueId?: string | null }
  | { type: 'ui/setFeedbackPromptOpen'; open: boolean }

export const DEFAULT_WORKSPACE_UI_STATE: WorkspaceUIState = {
  activeView: 'recent',
  searchQuery: '',
  sortKey: 'updated-desc',
  isSortMenuOpen: false,
  openRowMenuItemId: null,
  isStartupSplashVisible: true,
  isStartupSplashExiting: false,
  activeModal: 'none',
  previewPayload: null,
  isIssuesModalOpen: false,
  focusedIssueId: null,
  isFeedbackPromptOpen: false,
}

export function workspaceUIReducer(state: WorkspaceUIState, action: WorkspaceUIAction): WorkspaceUIState {
  switch (action.type) {
    case 'ui/setActiveView':
      return { ...state, activeView: action.view }
    case 'ui/setSearchQuery':
      return { ...state, searchQuery: action.query }
    case 'ui/setSortKey':
      return { ...state, sortKey: action.sortKey }
    case 'ui/setSortMenuOpen':
      return { ...state, isSortMenuOpen: action.open }
    case 'ui/setOpenRowMenuItemId':
      return { ...state, openRowMenuItemId: action.itemId }
    case 'ui/setStartupSplash':
      return { ...state, isStartupSplashVisible: action.visible, isStartupSplashExiting: action.exiting }
    case 'ui/setActiveModal':
      return { ...state, activeModal: action.modal }
    case 'ui/setPreviewPayload':
      return { ...state, previewPayload: action.payload }
    case 'ui/setIssuesModal':
      return {
        ...state,
        isIssuesModalOpen: action.open,
        focusedIssueId: action.open ? (action.focusedIssueId ?? state.focusedIssueId ?? null) : null,
      }
    case 'ui/setFeedbackPromptOpen':
      return { ...state, isFeedbackPromptOpen: action.open }
    default:
      return state
  }
}

type WorkspaceUIContextValue = {
  state: WorkspaceUIState
  dispatch: (action: WorkspaceUIAction) => void
}

const WorkspaceUIContext = createContext<WorkspaceUIContextValue | null>(null)

export function WorkspaceUIProvider({
  children,
  initialState,
}: {
  children: ReactNode
  initialState?: Partial<WorkspaceUIState>
}) {
  const [state, dispatch] = useReducer(workspaceUIReducer, {
    ...DEFAULT_WORKSPACE_UI_STATE,
    ...initialState,
  })

  const value = useMemo(() => ({ state, dispatch }), [state])
  return <WorkspaceUIContext.Provider value={value}>{children}</WorkspaceUIContext.Provider>
}

export function useWorkspaceUI(): WorkspaceUIContextValue {
  const value = useContext(WorkspaceUIContext)
  if (!value) {
    throw new Error('useWorkspaceUI must be used within WorkspaceUIProvider')
  }
  return value
}

