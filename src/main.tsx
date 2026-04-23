import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/i18n/i18n'
import App from './App'
import { ContainerLogsWindowApp } from './ContainerLogsWindowApp'
import { ContainerExecWindowApp } from './ContainerExecWindowApp'
import { ContainerFilesWindowApp } from './ContainerFilesWindowApp'
import { LogWindowErrorView } from './LogWindowErrorView'
import { parseLogWindowHash } from '@/lib/logWindowRoute'
import { AppDialogProvider } from '@/dialog/AppDialogContext'
import { ThemeProvider } from '@/theme/ThemeProvider'

import './index.css'

const route = parseLogWindowHash()
let shell: React.ReactNode
if (route.mode === 'exec') {
  shell = <ContainerExecWindowApp containerId={route.containerId} />
} else if (route.mode === 'exec-error') {
  shell = <LogWindowErrorView kind="exec" />
} else if (route.mode === 'logs') {
  shell = <ContainerLogsWindowApp containerId={route.containerId} />
} else if (route.mode === 'logs-error') {
  shell = <LogWindowErrorView kind="logs" />
} else if (route.mode === 'files') {
  shell = <ContainerFilesWindowApp containerId={route.containerId} initialPath={route.initialPath} />
} else if (route.mode === 'files-error') {
  shell = <LogWindowErrorView kind="files" />
} else {
  shell = <App />
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppDialogProvider>{shell}</AppDialogProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
