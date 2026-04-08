import type { ProviderDefinition } from '../../components/modals/AddStorageModal'
import type { LogicalView, UnifiedItemSortKey } from './unifiedItems'

export const STORAGE_PROVIDERS: ProviderDefinition[] = [
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

export const PRIMARY_NAV_ITEMS: Array<{ id: LogicalView; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'documents', label: 'Documents' },
  { id: 'photos', label: 'Photos' },
  { id: 'videos', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'other', label: 'Other' },
]

export const EMPTY_PENDING_MESSAGE = 'Complete authentication in your browser.'
export const CONNECT_SUCCESS_MESSAGE = 'Your storage is connected and ready to use.'
export const CONNECT_SYNC_ATTEMPTS = 8
export const CONNECT_SYNC_DELAY_MS = 500
export const STARTUP_SPLASH_VISIBLE_MS = 3000
export const STARTUP_SPLASH_FADE_MS = 260
export const BASIN_FEEDBACK_URL = 'https://usebasin.com/form/37c12519bb6c/hosted/46b7f138fca3'

export const SORT_OPTIONS: Array<{ value: UnifiedItemSortKey; label: string }> = [
  { value: 'updated-desc', label: 'Newest' },
  { value: 'updated-asc', label: 'Oldest' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
  { value: 'size-desc', label: 'Size ↓' },
  { value: 'size-asc', label: 'Size ↑' },
]
