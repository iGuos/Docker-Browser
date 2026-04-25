/// <reference types="vite/client" />

import type { HostMetrics } from '../shared/hostMetrics'
import type { RunningContainersMemorySummary } from '../shared/dockerMemorySummary'
import type { AppUpdateStatus } from '../shared/appUpdateStatus'
import type { DockerEventChunk } from '../shared/dockerEvents'
import type { DockerLogsChunk } from '../shared/dockerLogs'
import type { DockerExecPtyData, DockerExecPtyExit } from '../shared/dockerExecPty'
import type { IpcResult } from '../shared/ipc'
import type { AppLanguage } from '../shared/locale'
import type { ThemePreference } from '../shared/theme'

export interface DockerDesktopApi {
  ping(): Promise<IpcResult<string>>
  info(): Promise<IpcResult<unknown>>
  version(): Promise<IpcResult<unknown>>
  df(): Promise<IpcResult<unknown>>
  listContainers(opts?: { all?: boolean }): Promise<IpcResult<unknown[]>>
  inspectContainer(id: string): Promise<IpcResult<unknown>>
  startContainer(id: string): Promise<IpcResult<void>>
  stopContainer(id: string): Promise<IpcResult<void>>
  restartContainer(id: string): Promise<IpcResult<void>>
  killContainer(id: string): Promise<IpcResult<void>>
  pauseContainer(id: string): Promise<IpcResult<void>>
  unpauseContainer(id: string): Promise<IpcResult<void>>
  removeContainer(payload: { id: string; force?: boolean; v?: boolean }): Promise<IpcResult<void>>
  listImages(): Promise<IpcResult<unknown[]>>
  inspectImage(name: string): Promise<IpcResult<unknown>>
  removeImage(payload: { name: string; force?: boolean; noprune?: boolean }): Promise<IpcResult<unknown[]>>
  pullImage(repoTag: string): Promise<IpcResult<void>>
  createRunContainer(payload: {
    image: string
    name?: string
    envText?: string
    publishText?: string
    cmdText?: string
    autoRemove?: boolean
    restartPolicy?: string
  }): Promise<IpcResult<{ id: string }>>
  createAndRestartFromDockerRunCli(line: string, onProgress?: (text: string) => void): Promise<IpcResult<void>>
  buildAndRunFromDockerfile(payload: {
    dockerfile: string
    imageTag: string
    onProgress?: (text: string) => void
  }): Promise<IpcResult<void>>
  composeUpFromYaml(payload: {
    composeYaml: string
    projectName?: string
    onProgress?: (text: string) => void
  }): Promise<IpcResult<void>>
  recreateContainer(payload: {
    containerId: string
    image: string
    name?: string
    envText?: string
    publishText?: string
    cmdText?: string
    autoRemove?: boolean
    restartPolicy?: string
  }): Promise<IpcResult<{ id: string }>>
  patchContainerRuntime(payload: {
    containerId: string
    name?: string
    restartPolicy?: string
    memoryMb?: number
    cpus?: number
    pidsLimit?: number
  }): Promise<IpcResult<void>>
  tagImage(payload: { source: string; repo: string; tag?: string }): Promise<IpcResult<void>>
  execOnce(payload: {
    containerId: string
    command: string
    timeoutSec?: number
  }): Promise<IpcResult<{ output: string; exitCode?: number }>>
  execCancelCurrent(): Promise<IpcResult<void>>
  execPtyStart(payload: {
    containerId: string
    cols?: number
    rows?: number
  }): Promise<IpcResult<{ subscriptionId: string }>>
  execPtyStop(subscriptionId: string): Promise<IpcResult<void>>
  execPtyWrite(payload: { subscriptionId: string; data: string }): Promise<IpcResult<void>>
  execPtyResize(payload: { subscriptionId: string; cols: number; rows: number }): Promise<IpcResult<void>>
  onExecPtyData(handler: (msg: DockerExecPtyData) => void): () => void
  onExecPtyExit(handler: (msg: DockerExecPtyExit) => void): () => void
  startEvents(opts?: { sinceUnix?: number }): Promise<IpcResult<{ subscriptionId: string }>>
  stopEvents(subscriptionId: string): Promise<IpcResult<void>>
  listNetworks(): Promise<IpcResult<unknown[]>>
  removeNetwork(id: string): Promise<IpcResult<void>>
  listVolumes(): Promise<IpcResult<unknown>>
  removeVolume(name: string): Promise<IpcResult<void>>
  startLogs(opts: { containerId: string; tail?: number; timestamps?: boolean }): Promise<
    IpcResult<{ subscriptionId: string }>
  >
  stopLogs(subscriptionId: string): Promise<IpcResult<void>>
  openContainerLogsWindow(containerId: string): Promise<IpcResult<void>>
  openContainerExecWindow(containerId: string): Promise<IpcResult<void>>
  openContainerFilesWindow(containerId: string, initialPath?: string): Promise<IpcResult<void>>
  containerFsList(payload: {
    containerId: string
    path: string
  }): Promise<
    IpcResult<{
      entries: Array<{
        name: string
        type: 'file' | 'directory'
        size: number
        mode: string
        nlink: number
        user: string
        group: string
        mtime: number
      }>
    }>
  >
  containerFsReadFile(payload: { containerId: string; path: string }): Promise<IpcResult<{ base64: string }>>
  containerFsWriteFile(payload: { containerId: string; path: string; base64: string }): Promise<IpcResult<void>>
  containerFsRm(payload: { containerId: string; path: string }): Promise<IpcResult<void>>
  containerFsMkdir(payload: { containerId: string; path: string }): Promise<IpcResult<void>>
  containerFsDownload(payload: { containerId: string; path: string }): Promise<IpcResult<{ filePath: string }>>
  containerFsUpload(payload: { containerId: string; destDir: string }): Promise<IpcResult<{ files: string[] }>>
  openEngineDocs(): Promise<IpcResult<void>>
  createNetwork(payload: { name: string; driver?: string }): Promise<IpcResult<{ id: string }>>
  createVolume(payload: { name: string }): Promise<IpcResult<{ name: string }>>
  networkConnect(payload: { networkId: string; containerId: string }): Promise<IpcResult<void>>
  networkDisconnect(payload: {
    networkId: string
    containerId: string
    force?: boolean
  }): Promise<IpcResult<void>>
  volumeUsedBy(volumeName: string): Promise<IpcResult<{ containerIds: string[] }>>
  containerStatsOnce(containerId: string): Promise<IpcResult<unknown>>
  runningContainersMemorySummary(): Promise<IpcResult<RunningContainersMemorySummary>>
  containersMemoryUsage(containerIds: string[]): Promise<IpcResult<Record<string, number>>>
  imageHistory(name: string): Promise<IpcResult<unknown[]>>
  saveImageTar(payload: { name: string }): Promise<IpcResult<{ filePath: string }>>
  loadImageTar(): Promise<IpcResult<void>>
  commitContainer(payload: {
    containerId: string
    repo: string
    tag?: string
    comment?: string
  }): Promise<IpcResult<{ id: string }>>
  exportContainerTar(payload: { containerId: string }): Promise<IpcResult<{ filePath: string }>>
  reconnectDocker(): Promise<IpcResult<void>>
  getDockerRuntimeEnv(): Promise<IpcResult<{ dockerHost: string; dockerContext: string }>>
  getComposeVersion(): Promise<IpcResult<string>>
  getDockerBootstrapStatus(): Promise<
    IpcResult<{ dockerInstalled: boolean; engineReachable: boolean; canStartEngine: boolean }>
  >
  startDockerEngine(): Promise<IpcResult<void>>
  stopDockerEngine(): Promise<IpcResult<void>>
  getHostMetrics(): Promise<IpcResult<HostMetrics>>
  openPathInExplorer(p: string): Promise<IpcResult<void>>
  onLogsChunk(handler: (msg: DockerLogsChunk) => void): () => void
  onEventsChunk(handler: (msg: DockerEventChunk) => void): () => void
  getAppVersion(): Promise<IpcResult<{ version: string; isPackaged: boolean }>>
  checkForUpdates(): Promise<IpcResult<void>>
  quitAndInstall(): Promise<IpcResult<void>>
  onUpdateStatus(handler: (msg: AppUpdateStatus) => void): () => void
}

export interface AppThemeApi {
  notifyPreferenceChanged(pref: ThemePreference): void
  onMenuSelect(handler: (pref: ThemePreference) => void): () => void
}

export interface AppLocaleApi {
  notifyLanguageChanged(lng: AppLanguage): void
  onMenuLanguageSelect(handler: (lng: AppLanguage) => void): () => void
}

declare global {
  interface Window {
    dockerDesktop: DockerDesktopApi
    appTheme?: AppThemeApi
    appLocale?: AppLocaleApi
  }
}

export {}
