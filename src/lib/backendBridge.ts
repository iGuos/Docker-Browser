/**
 * Tauri 后端桥：用 @tauri-apps/api 的 invoke/listen 重建 Electron preload 暴露的
 * window.dockerDesktop / window.appTheme / window.appLocale，方法签名与 DockerDesktopApi
 * 完全一致，因此前端调用点与 unwrapIpc 零改动。
 *
 * 约定：
 * - Rust 命令用 snake_case 命名；Tauri 自动把 JS 传入的 camelCase 入参键转为 snake_case 形参，
 *   故这里直接转发前端既有的 camelCase 载荷。
 * - 流式通道沿用 Electron 时代的事件名常量（DockerIpc.* / AppIpc.* / app-menu:*）。
 * - 命令统一返回 IpcResult 形状；Tauri 层异常（命令未注册/反序列化失败/panic）归一化为 IpcResult.err。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { IpcResult } from '@shared/ipc'
import { DockerIpc } from '@shared/dockerIpcChannels'
import { AppIpc } from '@shared/appIpcChannels'
import { parseAppUpdateStatus } from '@shared/appUpdateStatus'
import type { AppUpdateStatus } from '@shared/appUpdateStatus'
import type { DockerLogsChunk } from '@shared/dockerLogs'
import type { DockerEventChunk } from '@shared/dockerEvents'
import type { DockerExecPtyData, DockerExecPtyExit } from '@shared/dockerExecPty'
import type { ThemePreference } from '@shared/theme'
import type { AppLanguage } from '@shared/locale'

/** 判断当前是否运行在 Tauri 壳内（注入了 __TAURI_INTERNALS__）。 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<IpcResult<T>> {
  try {
    return (await invoke(cmd, args)) as IpcResult<T>
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 订阅 Tauri 事件，返回与 Electron 版一致的同步退订函数。 */
function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  let un: (() => void) | null = null
  let cancelled = false
  void listen<T>(event, (e) => handler(e.payload)).then((u) => {
    if (cancelled) u()
    else un = u
  })
  return () => {
    cancelled = true
    if (un) un()
    un = null
  }
}

/** CLI 进度流：生成 requestId、按 requestId 过滤进度事件、命令结束后退订。 */
async function withCliProgress(
  cmd: string,
  rest: Record<string, unknown>,
  onProgress?: (text: string) => void,
): Promise<IpcResult<void>> {
  if (!onProgress) return call<void>(cmd, rest)
  const requestId = globalThis.crypto.randomUUID()
  const off = subscribe<{ requestId?: string; text?: string }>(DockerIpc.dockerCliProgress, (m) => {
    if (m?.requestId === requestId && typeof m.text === 'string') onProgress(m.text)
  })
  try {
    return await call<void>(cmd, { ...rest, requestId })
  } finally {
    off()
  }
}

const dockerDesktop: Window['dockerDesktop'] = {
  ping: () => call(DockerCmd.ping),
  info: () => call(DockerCmd.info),
  version: () => call(DockerCmd.version),
  df: () => call(DockerCmd.df),
  listContainers: (opts) => call(DockerCmd.listContainers, { all: opts?.all }),
  inspectContainer: (id) => call(DockerCmd.inspectContainer, { id }),
  startContainer: (id) => call(DockerCmd.startContainer, { id }),
  stopContainer: (id) => call(DockerCmd.stopContainer, { id }),
  restartContainer: (id) => call(DockerCmd.restartContainer, { id }),
  killContainer: (id) => call(DockerCmd.killContainer, { id }),
  pauseContainer: (id) => call(DockerCmd.pauseContainer, { id }),
  unpauseContainer: (id) => call(DockerCmd.unpauseContainer, { id }),
  removeContainer: (payload) => call(DockerCmd.removeContainer, payload),
  listImages: () => call(DockerCmd.listImages),
  inspectImage: (name) => call(DockerCmd.inspectImage, { name }),
  removeImage: (payload) => call(DockerCmd.removeImage, payload),
  pullImage: (repoTag) => call(DockerCmd.pullImage, { repoTag }),
  createRunContainer: (payload) => call(DockerCmd.createRunContainer, { payload }),
  createAndRestartFromDockerRunCli: (line, onProgress) =>
    withCliProgress(DockerCmd.createFromCli, { line }, onProgress),
  buildAndRunFromDockerfile: ({ onProgress, ...rest }) =>
    withCliProgress(DockerCmd.buildDockerfile, rest, onProgress),
  composeUpFromYaml: ({ onProgress, ...rest }) =>
    withCliProgress(DockerCmd.composeUp, rest, onProgress),
  recreateContainer: (payload) => call(DockerCmd.recreateContainer, { payload }),
  patchContainerRuntime: (payload) => call(DockerCmd.patchRuntime, { payload }),
  tagImage: (payload) => call(DockerCmd.tagImage, payload),
  execOnce: (payload) => call(DockerCmd.execOnce, payload),
  execCancelCurrent: () => call(DockerCmd.execCancel),
  execPtyStart: (payload) => call(DockerCmd.execPtyStart, payload),
  execPtyStop: (subscriptionId) => call(DockerCmd.execPtyStop, { subscriptionId }),
  execPtyWrite: (payload) => call(DockerCmd.execPtyWrite, payload),
  execPtyResize: (payload) => call(DockerCmd.execPtyResize, payload),
  onExecPtyData: (handler) =>
    subscribe<DockerExecPtyData>(DockerIpc.execPtyData, (m) => {
      if (m && typeof m.subscriptionId === 'string' && typeof m.data === 'string') handler(m)
    }),
  onExecPtyExit: (handler) =>
    subscribe<DockerExecPtyExit>(DockerIpc.execPtyExit, (m) => {
      if (m && typeof m.subscriptionId === 'string') handler(m)
    }),
  startEvents: (opts) => call(DockerCmd.eventsStart, { sinceUnix: opts?.sinceUnix }),
  stopEvents: (subscriptionId) => call(DockerCmd.eventsStop, { subscriptionId }),
  listNetworks: () => call(DockerCmd.listNetworks),
  removeNetwork: (id) => call(DockerCmd.removeNetwork, { id }),
  listVolumes: () => call(DockerCmd.listVolumes),
  removeVolume: (name) => call(DockerCmd.removeVolume, { name }),
  startLogs: (opts) => call(DockerCmd.logsStart, opts),
  stopLogs: (subscriptionId) => call(DockerCmd.logsStop, { subscriptionId }),
  openContainerLogsWindow: (containerId) => call(DockerCmd.openLogsWindow, { containerId }),
  openContainerExecWindow: (containerId) => call(DockerCmd.openExecWindow, { containerId }),
  openContainerFilesWindow: (containerId, initialPath) =>
    call(DockerCmd.openFilesWindow, { containerId, initialPath }),
  containerFsList: (payload) => call(DockerCmd.fsList, payload),
  containerFsReadFile: (payload) => call(DockerCmd.fsRead, payload),
  containerFsWriteFile: (payload) => call(DockerCmd.fsWrite, payload),
  containerFsRm: (payload) => call(DockerCmd.fsRm, payload),
  containerFsMkdir: (payload) => call(DockerCmd.fsMkdir, payload),
  containerFsDownload: (payload) => call(DockerCmd.fsDownload, payload),
  containerFsUpload: (payload) => call(DockerCmd.fsUpload, payload),
  openEngineDocs: () => call(DockerCmd.openDocs),
  createNetwork: (payload) => call(DockerCmd.createNetwork, payload),
  createVolume: (payload) => call(DockerCmd.createVolume, payload),
  networkConnect: (payload) => call(DockerCmd.networkConnect, payload),
  networkDisconnect: (payload) => call(DockerCmd.networkDisconnect, payload),
  volumeUsedBy: (volumeName) => call(DockerCmd.volumeUsedBy, { volumeName }),
  containerStatsOnce: (containerId) => call(DockerCmd.containerStatsOnce, { containerId }),
  runningContainersMemorySummary: () => call(DockerCmd.runningMemSummary),
  containersMemoryUsage: (containerIds) => call(DockerCmd.containersMemUsage, { containerIds }),
  imageHistory: (name) => call(DockerCmd.imageHistory, { name }),
  saveImageTar: (payload) => call(DockerCmd.saveImageTar, payload),
  loadImageTar: () => call(DockerCmd.loadImageTar),
  commitContainer: (payload) => call(DockerCmd.commitContainer, payload),
  exportContainerTar: (payload) => call(DockerCmd.exportContainerTar, payload),
  reconnectDocker: () => call(DockerCmd.reconnect),
  getDockerRuntimeEnv: () => call(AppCmd.dockerRuntimeEnv),
  getComposeVersion: () => call(AppCmd.composeVersion),
  getDockerBootstrapStatus: () => call(AppCmd.bootstrapStatus),
  startDockerEngine: () => call(AppCmd.startEngine),
  stopDockerEngine: () => call(AppCmd.stopEngine),
  getHostMetrics: () => call(AppCmd.hostMetrics),
  openPathInExplorer: (p) => call(AppCmd.openPath, { path: p }),
  onLogsChunk: (handler) =>
    subscribe<DockerLogsChunk>(DockerIpc.logsChunk, (m) => {
      if (m && typeof m.subscriptionId === 'string' && typeof m.text === 'string') handler(m)
    }),
  onEventsChunk: (handler) =>
    subscribe<DockerEventChunk>(DockerIpc.eventsChunk, (m) => {
      if (m && typeof m.subscriptionId === 'string' && typeof m.line === 'string') handler(m)
    }),
  getAppVersion: () => call(AppCmd.getVersion),
  checkForUpdates: () => call(AppCmd.checkUpdates),
  quitAndInstall: () => call(AppCmd.quitInstall),
  onUpdateStatus: (handler) =>
    subscribe<unknown>(AppIpc.updateStatusEvent, (raw) => {
      const m = parseAppUpdateStatus(raw)
      if (m) handler(m as AppUpdateStatus)
    }),
}

const appTheme: NonNullable<Window['appTheme']> = {
  notifyPreferenceChanged: (pref: ThemePreference) => {
    void call(AppCmd.setThemePref, { pref })
  },
  onMenuSelect: (handler) =>
    subscribe<ThemePreference>('app-menu:theme', (pref) => {
      if (pref === 'light' || pref === 'dark' || pref === 'system') handler(pref)
    }),
}

const appLocale: NonNullable<Window['appLocale']> = {
  notifyLanguageChanged: (lng: AppLanguage) => {
    if (lng === 'en' || lng === 'zh-CN') void call(AppCmd.setLanguage, { lng })
  },
  onMenuLanguageSelect: (handler) =>
    subscribe<AppLanguage>('app-menu:language', (lng) => {
      if (lng === 'en' || lng === 'zh-CN') handler(lng)
    }),
}

/** 把桥挂到 window，使现有调用点（window.dockerDesktop.*）无改动地工作。 */
export function installTauriBridge(): void {
  window.dockerDesktop = dockerDesktop
  window.appTheme = appTheme
  window.appLocale = appLocale
}

/** Rust 命令名（snake_case），集中管理，避免散落字符串。 */
const DockerCmd = {
  ping: 'docker_ping',
  info: 'docker_info',
  version: 'docker_version',
  df: 'docker_df',
  listContainers: 'docker_list_containers',
  inspectContainer: 'docker_inspect_container',
  startContainer: 'docker_start_container',
  stopContainer: 'docker_stop_container',
  restartContainer: 'docker_restart_container',
  killContainer: 'docker_kill_container',
  pauseContainer: 'docker_pause_container',
  unpauseContainer: 'docker_unpause_container',
  removeContainer: 'docker_remove_container',
  listImages: 'docker_list_images',
  inspectImage: 'docker_inspect_image',
  removeImage: 'docker_remove_image',
  pullImage: 'docker_pull_image',
  createRunContainer: 'docker_create_run_container',
  createFromCli: 'docker_create_from_cli',
  buildDockerfile: 'docker_build_dockerfile',
  composeUp: 'docker_compose_up',
  recreateContainer: 'docker_recreate_container',
  patchRuntime: 'docker_patch_runtime',
  tagImage: 'docker_tag_image',
  execOnce: 'docker_exec_once',
  execCancel: 'docker_exec_cancel',
  execPtyStart: 'docker_exec_pty_start',
  execPtyStop: 'docker_exec_pty_stop',
  execPtyWrite: 'docker_exec_pty_write',
  execPtyResize: 'docker_exec_pty_resize',
  eventsStart: 'docker_events_start',
  eventsStop: 'docker_events_stop',
  listNetworks: 'docker_list_networks',
  removeNetwork: 'docker_remove_network',
  listVolumes: 'docker_list_volumes',
  removeVolume: 'docker_remove_volume',
  logsStart: 'docker_logs_start',
  logsStop: 'docker_logs_stop',
  openLogsWindow: 'app_open_logs_window',
  openExecWindow: 'app_open_exec_window',
  openFilesWindow: 'app_open_files_window',
  fsList: 'docker_fs_list',
  fsRead: 'docker_fs_read',
  fsWrite: 'docker_fs_write',
  fsRm: 'docker_fs_rm',
  fsMkdir: 'docker_fs_mkdir',
  fsDownload: 'docker_fs_download',
  fsUpload: 'docker_fs_upload',
  openDocs: 'docker_open_docs',
  createNetwork: 'docker_create_network',
  createVolume: 'docker_create_volume',
  networkConnect: 'docker_network_connect',
  networkDisconnect: 'docker_network_disconnect',
  volumeUsedBy: 'docker_volume_used_by',
  containerStatsOnce: 'docker_container_stats_once',
  runningMemSummary: 'docker_running_mem_summary',
  containersMemUsage: 'docker_containers_mem_usage',
  imageHistory: 'docker_image_history',
  saveImageTar: 'docker_save_image_tar',
  loadImageTar: 'docker_load_image_tar',
  commitContainer: 'docker_commit_container',
  exportContainerTar: 'docker_export_container_tar',
  reconnect: 'docker_reconnect',
} as const

const AppCmd = {
  dockerRuntimeEnv: 'app_docker_runtime_env',
  composeVersion: 'app_compose_version',
  bootstrapStatus: 'app_docker_bootstrap_status',
  startEngine: 'app_start_engine',
  stopEngine: 'app_stop_engine',
  hostMetrics: 'app_host_metrics',
  openPath: 'app_open_path',
  getVersion: 'app_get_version',
  checkUpdates: 'app_check_updates',
  quitInstall: 'app_quit_install',
  setThemePref: 'app_set_theme_pref',
  setLanguage: 'app_set_language',
} as const
