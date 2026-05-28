/**
 * Tauri IPC 适配层 —— 替代原 Electron 的 window.dockerDesktop。
 * 所有 Docker/App 操作通过此模块调用 Tauri invoke/listen。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { IpcResult } from '@/types/ipc'

// ─── 通用包装 ───────────────────────────────────────────────────────────────

function ok<T>(data: T): IpcResult<T> { return { ok: true, data } }
function err(error: string): IpcResult<never> { return { ok: false, error } }

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<IpcResult<T>> {
  try {
    const data = await invoke<T>(cmd, args)
    return ok(data)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

// ─── App ────────────────────────────────────────────────────────────────────

export const dockerDesktop = {
  // App
  getAppVersion: () => call<{ version: string; isPackaged: boolean }>('get_app_version'),
  getDockerRuntimeEnv: () => call<{ dockerHost: string; dockerContext: string }>('get_docker_runtime_env'),
  getDockerBootstrapStatus: () => call<{ dockerInstalled: boolean; engineReachable: boolean; canStartEngine: boolean }>('get_docker_bootstrap_status'),
  startDockerEngine: () => call<void>('start_docker_engine'),
  stopDockerEngine: () => call<void>('stop_docker_engine'),
  getHostMetrics: () => call<unknown>('get_host_metrics'),
  getComposeVersion: () => call<string>('get_compose_version'),
  openPathInExplorer: (path: string) => call<void>('open_path', { path }),

  // Docker basic
  ping: () => call<string>('ping'),
  info: () => call<unknown>('info'),
  version: () => call<unknown>('version'),
  df: () => call<unknown>('df'),
  reconnectDocker: () => call<void>('reconnect_docker'),

  // Containers
  listContainers: (opts?: { all?: boolean }) => call<unknown[]>('list_containers', { all: opts?.all }),
  inspectContainer: (id: string) => call<unknown>('inspect_container', { id }),
  startContainer: (id: string) => call<void>('start_container', { id }),
  stopContainer: (id: string) => call<void>('stop_container', { id }),
  restartContainer: (id: string) => call<void>('restart_container', { id }),
  killContainer: (id: string) => call<void>('kill_container', { id }),
  pauseContainer: (id: string) => call<void>('pause_container', { id }),
  unpauseContainer: (id: string) => call<void>('unpause_container', { id }),
  removeContainer: (p: { id: string; force?: boolean; v?: boolean }) =>
    call<void>('remove_container', p),
  createRunContainer: (p: {
    image: string; name?: string; envText?: string; publishText?: string
    cmdText?: string; autoRemove?: boolean; restartPolicy?: string
  }) => call<{ id: string }>('create_run_container', p),
  recreateContainer: (p: {
    containerId: string; image: string; name?: string; envText?: string
    publishText?: string; cmdText?: string; autoRemove?: boolean; restartPolicy?: string
  }) => call<{ id: string }>('recreate_container', p),
  patchContainerRuntime: (p: {
    containerId: string; name?: string; restartPolicy?: string
    memoryMb?: number; cpus?: number; pidsLimit?: number
  }) => call<void>('patch_container_runtime', p),
  execOnce: (p: { containerId: string; command: string; timeoutSec?: number }) =>
    call<{ output: string; exitCode?: number }>('exec_once', p),
  execCancelCurrent: () => ok(undefined) as IpcResult<void>,  // no-op in Tauri
  containerStatsOnce: (containerId: string) => call<unknown>('container_stats_once', { containerId }),
  runningContainersMemorySummary: () => call<unknown>('running_containers_memory_summary'),
  containersMemoryUsage: (containerIds: string[]) =>
    call<Record<string, number>>('containers_memory_usage', { containerIds }),
  commitContainer: (p: { containerId: string; repo: string; tag?: string; comment?: string }) =>
    call<{ id: string }>('commit_container', p),
  exportContainerTar: (p: { containerId: string }) =>
    call<{ filePath: string }>('export_container_tar', p),

  // Images
  listImages: () => call<unknown[]>('list_images'),
  inspectImage: (name: string) => call<unknown>('inspect_image', { name }),
  removeImage: (p: { name: string; force?: boolean; noprune?: boolean }) =>
    call<unknown[]>('remove_image', p),
  pullImage: (repoTag: string) => call<void>('pull_image', { repoTag }),
  tagImage: (p: { source: string; repo: string; tag?: string }) => call<void>('tag_image', p),
  imageHistory: (name: string) => call<unknown[]>('image_history', { name }),
  saveImageTar: (p: { name: string }) => call<{ filePath: string }>('save_image_tar', p),
  loadImageTar: () => call<void>('load_image_tar'),

  // Networks
  listNetworks: () => call<unknown[]>('list_networks'),
  removeNetwork: (id: string) => call<void>('remove_network', { id }),
  createNetwork: (p: { name: string; driver?: string }) => call<{ id: string }>('create_network', p),
  networkConnect: (p: { networkId: string; containerId: string }) => call<void>('network_connect', p),
  networkDisconnect: (p: { networkId: string; containerId: string; force?: boolean }) =>
    call<void>('network_disconnect', p),

  // Volumes
  listVolumes: () => call<unknown>('list_volumes'),
  removeVolume: (name: string) => call<void>('remove_volume', { name }),
  createVolume: (p: { name: string }) => call<{ name: string }>('create_volume', p),
  volumeUsedBy: (volumeName: string) => call<{ containerIds: string[] }>('volume_used_by', { volumeName }),

  // Container filesystem
  containerFsList: (p: { containerId: string; path: string }) =>
    call<{ entries: { name: string; type: string; size: number }[] }>('container_fs_list', p),
  containerFsReadFile: (p: { containerId: string; path: string }) =>
    call<{ base64: string }>('container_fs_read_file', p),
  containerFsWriteFile: (p: { containerId: string; path: string; base64: string }) =>
    call<void>('container_fs_write_file', p),
  containerFsRm: (p: { containerId: string; path: string }) => call<void>('container_fs_rm', p),
  containerFsMkdir: (p: { containerId: string; path: string }) => call<void>('container_fs_mkdir', p),
  containerFsDownload: (p: { containerId: string; path: string }) =>
    call<{ filePath: string }>('container_fs_download', p),
  containerFsUpload: (p: { containerId: string; destDir: string }) =>
    call<{ files: string[] }>('container_fs_upload', p),

  // Docker CLI wrappers
  createAndRestartFromDockerRunCli: (
    line: string,
    onProgress?: (text: string) => void,
  ): Promise<IpcResult<void>> => {
    const requestId = onProgress ? crypto.randomUUID() : undefined
    if (onProgress && requestId) {
      listen<{ requestId: string; text: string }>('docker:docker-cli-progress', (e) => {
        if (e.payload.requestId === requestId) onProgress(e.payload.text)
      }).catch(() => {})
    }
    return call<void>('create_and_restart_from_docker_run_cli', { line, requestId })
  },
  buildAndRunFromDockerfile: (p: {
    dockerfile: string; imageTag: string; onProgress?: (text: string) => void
  }): Promise<IpcResult<void>> => {
    const { onProgress, ...rest } = p
    const requestId = onProgress ? crypto.randomUUID() : undefined
    if (onProgress && requestId) {
      listen<{ requestId: string; text: string }>('docker:docker-cli-progress', (e) => {
        if (e.payload.requestId === requestId) onProgress(e.payload.text)
      }).catch(() => {})
    }
    return call<void>('build_and_run_from_dockerfile', { ...rest, requestId })
  },
  composeUpFromYaml: (p: {
    composeYaml: string; projectName?: string; onProgress?: (text: string) => void
  }): Promise<IpcResult<void>> => {
    const { onProgress, ...rest } = p
    const requestId = onProgress ? crypto.randomUUID() : undefined
    if (onProgress && requestId) {
      listen<{ requestId: string; text: string }>('docker:docker-cli-progress', (e) => {
        if (e.payload.requestId === requestId) onProgress(e.payload.text)
      }).catch(() => {})
    }
    return call<void>('compose_up_from_yaml', { ...rest, requestId })
  },

  // Logs streaming
  startLogs: (opts: { containerId: string; tail?: number; timestamps?: boolean }) =>
    call<{ subscriptionId: string }>('logs_start', opts),
  stopLogs: (subscriptionId: string) => call<void>('logs_stop', { subscriptionId }),

  // Events streaming
  startEvents: (opts?: { sinceUnix?: number }) =>
    call<{ subscriptionId: string }>('events_start', { sinceUnix: opts?.sinceUnix }),
  stopEvents: (subscriptionId: string) => call<void>('events_stop', { subscriptionId }),

  // PTY
  execPtyStart: (p: { containerId: string; cols?: number; rows?: number }) =>
    call<{ subscriptionId: string }>('exec_pty_start', p),
  execPtyStop: (subscriptionId: string) => call<void>('exec_pty_stop', { subscriptionId }),
  execPtyWrite: (p: { subscriptionId: string; data: string }) => call<void>('exec_pty_write', p),
  execPtyResize: (p: { subscriptionId: string; cols: number; rows: number }) =>
    call<void>('exec_pty_resize', p),

  // Event listeners (returns unsubscribe fn)
  onLogsChunk: (handler: (msg: { subscriptionId: string; text: string; stream: string }) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null
    listen<{ subscriptionId: string; text: string; stream: string }>('docker:logs:chunk', (e) => handler(e.payload))
      .then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  },
  onEventsChunk: (handler: (msg: { subscriptionId: string; line: string }) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null
    listen<{ subscriptionId: string; line: string }>('docker:events:chunk', (e) => handler(e.payload))
      .then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  },
  onExecPtyData: (handler: (msg: { subscriptionId: string; data: string }) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null
    listen<{ subscriptionId: string; data: string }>('docker:exec-pty:data', (e) => handler(e.payload))
      .then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  },
  onExecPtyExit: (handler: (msg: { subscriptionId: string; exitCode: number }) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null
    listen<{ subscriptionId: string; exitCode: number }>('docker:exec-pty:exit', (e) => handler(e.payload))
      .then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  },

  // Multi-window：由 Rust 后端用 WebviewWindowBuilder 创建，避免前端权限限制
  openContainerLogsWindow: (containerId: string) =>
    call<void>('open_container_logs_window', { containerId }),
  openContainerExecWindow: (containerId: string) =>
    call<void>('open_container_exec_window', { containerId }),
  openContainerFilesWindow: (containerId: string, initialPath?: string) =>
    call<void>('open_container_files_window', { containerId, initialPath }),

  // App updates
  checkForUpdates: () => call<void>('plugin:updater|check'),
  quitAndInstall: () => call<void>('plugin:process|exit', { code: 0 }),
  onUpdateStatus: (_handler: (msg: unknown) => void): (() => void) => () => {},
  openEngineDocs: () => call<void>('open_path', { path: 'https://docs.docker.com' }),
}

// 挂载到 window，让现有代码无需改动即可使用
;(window as unknown as Record<string, unknown>).dockerDesktop = dockerDesktop
