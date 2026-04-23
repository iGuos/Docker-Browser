import { contextBridge, ipcRenderer } from 'electron'
import type { AppLanguage } from '../../shared/locale'
import type { ThemePreference } from '../../shared/theme'
import type { IpcResult } from '../../shared/ipc'
import type { DockerLogsChunk } from '../../shared/dockerLogs'
import type { DockerEventChunk } from '../../shared/dockerEvents'
import { AppIpc } from '../../shared/appIpcChannels'
import type { HostMetrics } from '../../shared/hostMetrics'
import type { RunningContainersMemorySummary } from '../../shared/dockerMemorySummary'
import type { AppUpdateStatus } from '../../shared/appUpdateStatus'
import { parseAppUpdateStatus } from '../../shared/appUpdateStatus'
import { DockerIpc } from '../../shared/dockerIpcChannels'

contextBridge.exposeInMainWorld('dockerDesktop', {
  ping(): Promise<IpcResult<string>> {
    return ipcRenderer.invoke(DockerIpc.ping)
  },
  info(): Promise<IpcResult<unknown>> {
    return ipcRenderer.invoke(DockerIpc.info)
  },
  version(): Promise<IpcResult<unknown>> {
    return ipcRenderer.invoke(DockerIpc.version)
  },
  df(): Promise<IpcResult<unknown>> {
    return ipcRenderer.invoke(DockerIpc.df)
  },
  listContainers(opts?: { all?: boolean }): Promise<IpcResult<unknown[]>> {
    return ipcRenderer.invoke(DockerIpc.listContainers, opts)
  },
  inspectContainer(id: string): Promise<IpcResult<unknown>> {
    return ipcRenderer.invoke(DockerIpc.inspectContainer, id)
  },
  startContainer(id: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.startContainer, id)
  },
  stopContainer(id: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.stopContainer, id)
  },
  restartContainer(id: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.restartContainer, id)
  },
  killContainer(id: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.killContainer, id)
  },
  pauseContainer(id: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.pauseContainer, id)
  },
  unpauseContainer(id: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.unpauseContainer, id)
  },
  removeContainer(payload: { id: string; force?: boolean; v?: boolean }): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.removeContainer, payload)
  },
  listImages(): Promise<IpcResult<unknown[]>> {
    return ipcRenderer.invoke(DockerIpc.listImages)
  },
  inspectImage(name: string): Promise<IpcResult<unknown>> {
    return ipcRenderer.invoke(DockerIpc.inspectImage, name)
  },
  removeImage(payload: { name: string; force?: boolean; noprune?: boolean }): Promise<IpcResult<unknown[]>> {
    return ipcRenderer.invoke(DockerIpc.removeImage, payload)
  },
  pullImage(repoTag: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.pullImage, repoTag)
  },
  createRunContainer(payload: {
    image: string
    name?: string
    envText?: string
    publishText?: string
    cmdText?: string
    autoRemove?: boolean
    restartPolicy?: string
  }): Promise<IpcResult<{ id: string }>> {
    return ipcRenderer.invoke(DockerIpc.createRunContainer, payload)
  },
  recreateContainer(payload: {
    containerId: string
    image: string
    name?: string
    envText?: string
    publishText?: string
    cmdText?: string
    autoRemove?: boolean
    restartPolicy?: string
  }): Promise<IpcResult<{ id: string }>> {
    return ipcRenderer.invoke(DockerIpc.recreateContainer, payload)
  },
  patchContainerRuntime(payload: {
    containerId: string
    name?: string
    restartPolicy?: string
    memoryMb?: number
    cpus?: number
    pidsLimit?: number
  }): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.patchContainerRuntime, payload)
  },
  tagImage(payload: { source: string; repo: string; tag?: string }): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.tagImage, payload)
  },
  execOnce(payload: {
    containerId: string
    command: string
    timeoutSec?: number
  }): Promise<IpcResult<{ output: string; exitCode?: number }>> {
    return ipcRenderer.invoke(DockerIpc.execOnce, payload)
  },
  execCancelCurrent(): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.execCancelCurrent)
  },
  startEvents(opts?: { sinceUnix?: number }): Promise<IpcResult<{ subscriptionId: string }>> {
    return ipcRenderer.invoke(DockerIpc.eventsStart, opts)
  },
  stopEvents(subscriptionId: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.eventsStop, subscriptionId)
  },
  listNetworks(): Promise<IpcResult<unknown[]>> {
    return ipcRenderer.invoke(DockerIpc.listNetworks)
  },
  removeNetwork(id: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.removeNetwork, id)
  },
  listVolumes(): Promise<IpcResult<unknown>> {
    return ipcRenderer.invoke(DockerIpc.listVolumes)
  },
  removeVolume(name: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.removeVolume, name)
  },
  startLogs(opts: { containerId: string; tail?: number; timestamps?: boolean }): Promise<
    IpcResult<{ subscriptionId: string }>
  > {
    return ipcRenderer.invoke(DockerIpc.logsStart, opts)
  },
  stopLogs(subscriptionId: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.logsStop, subscriptionId)
  },
  openContainerLogsWindow(containerId: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke('app:open-container-logs-window', containerId)
  },
  openContainerFilesWindow(containerId: string, initialPath?: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke('app:open-container-files-window', { containerId, initialPath })
  },
  containerFsList(payload: {
    containerId: string
    path: string
  }): Promise<IpcResult<{ entries: { name: string; type: 'file' | 'directory'; size: number }[] }>> {
    return ipcRenderer.invoke(DockerIpc.containerFsList, payload)
  },
  containerFsReadFile(payload: {
    containerId: string
    path: string
  }): Promise<IpcResult<{ base64: string }>> {
    return ipcRenderer.invoke(DockerIpc.containerFsReadFile, payload)
  },
  containerFsWriteFile(payload: { containerId: string; path: string; base64: string }): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.containerFsWriteFile, payload)
  },
  containerFsRm(payload: { containerId: string; path: string }): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.containerFsRm, payload)
  },
  containerFsMkdir(payload: { containerId: string; path: string }): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.containerFsMkdir, payload)
  },
  containerFsDownload(payload: { containerId: string; path: string }): Promise<IpcResult<{ filePath: string }>> {
    return ipcRenderer.invoke(DockerIpc.containerFsDownload, payload)
  },
  containerFsUpload(payload: { containerId: string; destDir: string }): Promise<IpcResult<{ files: string[] }>> {
    return ipcRenderer.invoke(DockerIpc.containerFsUpload, payload)
  },
  openEngineDocs(): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.openDocs)
  },
  createNetwork(payload: { name: string; driver?: string }): Promise<IpcResult<{ id: string }>> {
    return ipcRenderer.invoke(DockerIpc.createNetwork, payload)
  },
  createVolume(payload: { name: string }): Promise<IpcResult<{ name: string }>> {
    return ipcRenderer.invoke(DockerIpc.createVolume, payload)
  },
  networkConnect(payload: { networkId: string; containerId: string }): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.networkConnect, payload)
  },
  networkDisconnect(payload: {
    networkId: string
    containerId: string
    force?: boolean
  }): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.networkDisconnect, payload)
  },
  volumeUsedBy(volumeName: string): Promise<IpcResult<{ containerIds: string[] }>> {
    return ipcRenderer.invoke(DockerIpc.volumeUsedBy, volumeName)
  },
  containerStatsOnce(containerId: string): Promise<IpcResult<unknown>> {
    return ipcRenderer.invoke(DockerIpc.containerStatsOnce, containerId)
  },
  runningContainersMemorySummary(): Promise<IpcResult<RunningContainersMemorySummary>> {
    return ipcRenderer.invoke(DockerIpc.runningContainersMemorySummary)
  },
  containersMemoryUsage(containerIds: string[]): Promise<IpcResult<Record<string, number>>> {
    return ipcRenderer.invoke(DockerIpc.containersMemoryUsage, containerIds)
  },
  imageHistory(name: string): Promise<IpcResult<unknown[]>> {
    return ipcRenderer.invoke(DockerIpc.imageHistory, name)
  },
  saveImageTar(payload: { name: string }): Promise<IpcResult<{ filePath: string }>> {
    return ipcRenderer.invoke(DockerIpc.saveImageTar, payload)
  },
  loadImageTar(): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.loadImageTar)
  },
  commitContainer(payload: {
    containerId: string
    repo: string
    tag?: string
    comment?: string
  }): Promise<IpcResult<{ id: string }>> {
    return ipcRenderer.invoke(DockerIpc.commitContainer, payload)
  },
  exportContainerTar(payload: { containerId: string }): Promise<IpcResult<{ filePath: string }>> {
    return ipcRenderer.invoke(DockerIpc.exportContainerTar, payload)
  },
  reconnectDocker(): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(DockerIpc.reconnectDocker)
  },
  getDockerRuntimeEnv(): Promise<IpcResult<{ dockerHost: string; dockerContext: string }>> {
    return ipcRenderer.invoke('app:get-docker-runtime-env')
  },
  getComposeVersion(): Promise<IpcResult<string>> {
    return ipcRenderer.invoke('app:get-compose-version')
  },
  getHostMetrics(): Promise<IpcResult<HostMetrics>> {
    return ipcRenderer.invoke('app:get-host-metrics')
  },
  openPathInExplorer(p: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke('app:open-path', p)
  },
  onLogsChunk(handler: (msg: DockerLogsChunk) => void): () => void {
    const wrap = (_e: Electron.IpcRendererEvent, msg: unknown) => {
      const m = msg as DockerLogsChunk
      if (m && typeof m.subscriptionId === 'string' && typeof m.text === 'string') handler(m)
    }
    ipcRenderer.on(DockerIpc.logsChunk, wrap)
    return () => ipcRenderer.removeListener(DockerIpc.logsChunk, wrap)
  },
  onEventsChunk(handler: (msg: DockerEventChunk) => void): () => void {
    const wrap = (_e: Electron.IpcRendererEvent, msg: unknown) => {
      const m = msg as DockerEventChunk
      if (m && typeof m.subscriptionId === 'string' && typeof m.line === 'string') handler(m)
    }
    ipcRenderer.on(DockerIpc.eventsChunk, wrap)
    return () => ipcRenderer.removeListener(DockerIpc.eventsChunk, wrap)
  },
  getAppVersion(): Promise<IpcResult<{ version: string; isPackaged: boolean }>> {
    return ipcRenderer.invoke(AppIpc.getAppVersion)
  },
  checkForUpdates(): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(AppIpc.checkForUpdates)
  },
  quitAndInstall(): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(AppIpc.quitAndInstall)
  },
  onUpdateStatus(handler: (msg: AppUpdateStatus) => void): () => void {
    const wrap = (_e: Electron.IpcRendererEvent, raw: unknown) => {
      const m = parseAppUpdateStatus(raw)
      if (m) handler(m)
    }
    ipcRenderer.on(AppIpc.updateStatusEvent, wrap)
    return () => ipcRenderer.removeListener(AppIpc.updateStatusEvent, wrap)
  },
})

contextBridge.exposeInMainWorld('appTheme', {
  notifyPreferenceChanged(pref: ThemePreference) {
    ipcRenderer.send('app:theme-preference-changed', pref)
  },
  onMenuSelect(handler: (pref: ThemePreference) => void): () => void {
    const wrap = (_e: Electron.IpcRendererEvent, pref: unknown) => {
      if (pref === 'light' || pref === 'dark' || pref === 'system') handler(pref)
    }
    ipcRenderer.on('app-menu:theme', wrap)
    return () => ipcRenderer.removeListener('app-menu:theme', wrap)
  },
})

contextBridge.exposeInMainWorld('appLocale', {
  notifyLanguageChanged(lng: AppLanguage) {
    if (lng === 'en' || lng === 'zh-CN') ipcRenderer.send('app:language-changed', lng)
  },
  onMenuLanguageSelect(handler: (lng: AppLanguage) => void): () => void {
    const wrap = (_e: Electron.IpcRendererEvent, lng: unknown) => {
      if (lng === 'en' || lng === 'zh-CN') handler(lng)
    }
    ipcRenderer.on('app-menu:language', wrap)
    return () => ipcRenderer.removeListener('app-menu:language', wrap)
  },
})
