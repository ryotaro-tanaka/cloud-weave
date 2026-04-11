import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { WorkspaceDataProvider } from './state/workspaceData/WorkspaceDataContext'
import { WorkspaceUIProvider } from './state/workspaceUI/WorkspaceUIContext'
import { TransfersProvider } from './state/transfers/TransfersContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceDataProvider>
      <TransfersProvider>
        <WorkspaceUIProvider>
          <App />
        </WorkspaceUIProvider>
      </TransfersProvider>
    </WorkspaceDataProvider>
  </StrictMode>,
)
