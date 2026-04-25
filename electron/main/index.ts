import { app, BrowserWindow, ipcMain, shell } from 'electron'
import type { AppLanguage } from '../../shared/locale'
import type { ThemePreference } from '../../shared/theme'
import { ipcErr, ipcOk, type IpcResult } from '../../shared/ipc'
import type { HostMetrics } from '../../shared/hostMetrics'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os, { type CpuInfo } from 'node:os'
import { existsSync } from 'node:fs'
import { installAppMenu, rebuildApplicationMenu, syncNativeThemeSource } from './appMenu'
import { openExternalUrlIfAllowed } from './openExternalPolicy'
import { registerDockerIpc } from './ipcDocker'
import { registerAppUpdaterIpc, scheduleStartupUpdateCheck, setUpdaterMenuRefresh } from './updater'
import { getDocker } from './dockerClient'

registerDockerIpc()
registerAppUpdaterIpc()

ipcMain.handle(
  'app:get-docker-runtime-env',
  async (): Promise<IpcResult<{ dockerHost: string; dockerContext: string }>> => {
    return ipcOk({
      dockerHost: process.env.DOCKER_HOST ?? '',
      dockerContext: process.env.DOCKER_CONTEXT ?? '',
    })
  },
)

ipcMain.handle('app:open-path', async (_evt, rawPath: unknown): Promise<IpcResult<void>> => {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return ipcErr('path is required')
  const p = rawPath.trim()
  try {
    const err = await shell.openPath(p)
    if (err) return ipcErr(err)
    return ipcOk(undefined)
  } catch (e) {
    return ipcErr(e instanceof Error ? e.message : String(e))
  }
})

function sumCpuTimes(c: CpuInfo): number {
  const t = c.times
  return t.user + t.nice + t.sys + t.irq + t.idle
}

function sampleCpuUsagePercent(delayMs: number): Promise<number> {
  const cpus1 = os.cpus()
  const idle1 = cpus1.reduce((a, c) => a + c.times.idle, 0)
  const total1 = cpus1.reduce((a, c) => a + sumCpuTimes(c), 0)
  return new Promise((resolve) => {
    setTimeout(() => {
      const cpus2 = os.cpus()
      const idle2 = cpus2.reduce((a, c) => a + c.times.idle, 0)
      const total2 = cpus2.reduce((a, c) => a + sumCpuTimes(c), 0)
      const idleDelta = idle2 - idle1
      const totalDelta = total2 - total1
      if (totalDelta <= 0) {
        resolve(0)
        return
      }
      const pct = Math.round(100 * (1 - idleDelta / totalDelta))
      resolve(Math.min(100, Math.max(0, pct)))
    }, delayMs)
  })
}

ipcMain.handle('app:get-host-metrics', async (): Promise<IpcResult<HostMetrics>> => {
  try {
    const total = os.totalmem()
    const free = os.freemem()
    const usedPct = total > 0 ? Math.round(100 * (1 - free / total)) : 0
    const cpus = os.cpus()
    const cpuUsagePercent = await sampleCpuUsagePercent(100)
    const la = os.loadavg()
    const loadavg: [number, number, number] | null =
      os.platform() === 'win32' ? null : [la[0] ?? 0, la[1] ?? 0, la[2] ?? 0]
    const payload: HostMetrics = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptimeSec: Math.floor(os.uptime()),
      cpus: cpus.length,
      cpuModel: cpus[0]?.model?.trim() || '—',
      cpuUsagePercent,
      memTotalBytes: total,
      memFreeBytes: free,
      memUsedPercent: Math.min(100, Math.max(0, usedPct)),
      loadavg,
    }
    return ipcOk(payload)
  } catch (e) {
    return ipcErr(e instanceof Error ? e.message : String(e))
  }
})

ipcMain.handle('app:get-compose-version', async (): Promise<IpcResult<string>> => {
  try {
    const r = spawnSync('docker', ['compose', 'version'], {
      encoding: 'utf8',
      timeout: 12_000,
    })
    if (r.error) return ipcErr(r.error.message)
    if (r.status !== 0) {
      const msg = (r.stderr || r.stdout || '').trim() || 'docker compose failed'
      return ipcErr(msg)
    }
    return ipcOk((r.stdout || '').trim() || 'ok')
  } catch (e) {
    return ipcErr(e instanceof Error ? e.message : String(e))
  }
})

function dockerCliInstalled(): boolean {
  try {
    const r = spawnSync('docker', ['--version'], {
      encoding: 'utf8',
      timeout: 6_000,
      windowsHide: true,
    })
    return !r.error && r.status === 0
  } catch {
    return false
  }
}

function getWindowsDockerDesktopExePath(): string | null {
  const local = process.env.LOCALAPPDATA ?? ''
  const programFiles = process.env['ProgramFiles'] ?? ''
  const candidates = [
    local ? path.join(local, 'Docker', 'Docker', 'Docker Desktop.exe') : '',
    programFiles ? path.join(programFiles, 'Docker', 'Docker', 'Docker Desktop.exe') : '',
  ].filter(Boolean)
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

function canStartDockerEngine(): boolean {
  if (process.platform === 'win32') return getWindowsDockerDesktopExePath() !== null
  if (process.platform === 'darwin') return true
  return false
}

async function isEngineReachable(timeoutMs = 3000): Promise<boolean> {
  try {
    await Promise.race([
      getDocker().ping(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('docker ping timeout')), timeoutMs)
      }),
    ])
    return true
  } catch {
    return false
  }
}

ipcMain.handle(
  'app:get-docker-bootstrap-status',
  async (): Promise<
    IpcResult<{ dockerInstalled: boolean; engineReachable: boolean; canStartEngine: boolean }>
  > => {
    const dockerInstalled = dockerCliInstalled()
    const engineReachable = dockerInstalled ? await isEngineReachable() : false
    return ipcOk({
      dockerInstalled,
      engineReachable,
      canStartEngine: dockerInstalled && !engineReachable && canStartDockerEngine(),
    })
  },
)

ipcMain.handle('app:start-docker-engine', async (): Promise<IpcResult<void>> => {
  try {
    if (process.platform === 'win32') {
      const exePath = getWindowsDockerDesktopExePath()
      if (!exePath) return ipcErr('Docker Desktop not found')
      const cp = spawn(exePath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      cp.unref()
      return ipcOk(undefined)
    }
    if (process.platform === 'darwin') {
      const cp = spawn('open', ['-a', 'Docker'], {
        detached: true,
        stdio: 'ignore',
      })
      cp.unref()
      return ipcOk(undefined)
    }
    return ipcErr('Auto-start is not supported on this platform')
  } catch (e) {
    return ipcErr(e instanceof Error ? e.message : String(e))
  }
})

ipcMain.handle('app:stop-docker-engine', async (): Promise<IpcResult<void>> => {
  try {
    if (process.platform === 'win32') {
      void spawn('docker', ['desktop', 'stop'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      // 后台兜底：若优雅关闭未生效，延后强制结束关键进程（不阻塞当前 IPC）
      setTimeout(() => {
        try {
          void spawn('taskkill', ['/IM', 'Docker Desktop.exe', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          })
          void spawn('taskkill', ['/IM', 'com.docker.backend.exe', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          })
        } catch {
          /* ignore fallback errors */
        }
      }, 6_000)
      return ipcOk(undefined)
    }
    if (process.platform === 'darwin') {
      const r = spawn('osascript', ['-e', 'tell application "Docker" to quit'], {
        detached: true,
        stdio: 'ignore',
      })
      r.unref()
      return ipcOk(undefined)
    }
    return ipcErr('Stop action is not supported on this platform')
  } catch (e) {
    return ipcErr(e instanceof Error ? e.message : String(e))
  }
})

ipcMain.on('app:theme-preference-changed', (_, pref: unknown) => {
  if (pref !== 'light' && pref !== 'dark' && pref !== 'system') return
  const p = pref as ThemePreference
  syncNativeThemeSource(p)
  installAppMenu(p)
})

ipcMain.on('app:language-changed', (_, lng: unknown) => {
  if (lng !== 'en' && lng !== 'zh-CN') return
  installAppMenu(undefined, lng as AppLanguage)
})

app.setName('Docker Browser')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '../..')

export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

function resolveWindowIconPath(): string | undefined {
  const publicDir = process.env.VITE_PUBLIC ?? ''
  const appRoot = process.env.APP_ROOT ?? ''
  const publicPng = publicDir ? path.join(publicDir, 'icon.png') : ''
  const publicIco = publicDir ? path.join(publicDir, 'icon.ico') : ''
  const buildIco = appRoot ? path.join(appRoot, 'build', 'icon.ico') : ''

  if (process.platform === 'win32') {
    const winCandidates = [buildIco, publicIco, publicPng].filter(Boolean)
    for (const p of winCandidates) {
      if (existsSync(p)) return p
    }
    return undefined
  }

  if (publicPng && existsSync(publicPng)) return publicPng
  return undefined
}

const windowIconPath = resolveWindowIconPath()

function createLogWindow(containerId: string) {
  const logWin = new BrowserWindow({
    title: 'Docker Browser',
    width: 920,
    height: 640,
    minWidth: 400,
    minHeight: 280,
    autoHideMenuBar: true,
    icon: windowIconPath,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  logWin.setMenu(null)

  const hash = `logs?containerId=${encodeURIComponent(containerId)}`
  if (VITE_DEV_SERVER_URL) {
    void logWin.loadURL(`${VITE_DEV_SERVER_URL}#${hash}`)
  } else {
    void logWin.loadFile(indexHtml, { hash })
  }

  logWin.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrlIfAllowed(url)
    return { action: 'deny' }
  })
}

ipcMain.handle('app:open-container-logs-window', (_evt, containerId: unknown) => {
  if (typeof containerId !== 'string' || !containerId.trim()) return Promise.resolve(ipcErr('invalid container id'))
  try {
    createLogWindow(containerId.trim())
    return Promise.resolve(ipcOk(undefined))
  } catch (e) {
    return Promise.resolve(ipcErr(e instanceof Error ? e.message : String(e)))
  }
})

function createExecWindow(containerId: string) {
  const execWin = new BrowserWindow({
    title: 'Docker Browser',
    width: 960,
    height: 720,
    minWidth: 520,
    minHeight: 360,
    autoHideMenuBar: true,
    icon: windowIconPath,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  execWin.setMenu(null)

  const hash = `exec?containerId=${encodeURIComponent(containerId)}`
  if (VITE_DEV_SERVER_URL) {
    void execWin.loadURL(`${VITE_DEV_SERVER_URL}#${hash}`)
  } else {
    void execWin.loadFile(indexHtml, { hash })
  }

  execWin.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrlIfAllowed(url)
    return { action: 'deny' }
  })
}

ipcMain.handle('app:open-container-exec-window', (_evt, containerId: unknown) => {
  if (typeof containerId !== 'string' || !containerId.trim()) return Promise.resolve(ipcErr('invalid container id'))
  try {
    createExecWindow(containerId.trim())
    return Promise.resolve(ipcOk(undefined))
  } catch (e) {
    return Promise.resolve(ipcErr(e instanceof Error ? e.message : String(e)))
  }
})

function createFilesWindow(containerId: string, initialPath = '/') {
  const w = new BrowserWindow({
    title: 'Docker Browser',
    width: 920,
    height: 640,
    minWidth: 400,
    minHeight: 280,
    autoHideMenuBar: true,
    icon: windowIconPath,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  w.setMenu(null)
  const pathQ = encodeURIComponent(initialPath.startsWith('/') ? initialPath : `/${initialPath}`)
  const hash = `files?containerId=${encodeURIComponent(containerId)}&path=${pathQ}`
  if (VITE_DEV_SERVER_URL) {
    void w.loadURL(`${VITE_DEV_SERVER_URL}#${hash}`)
  } else {
    void w.loadFile(indexHtml, { hash })
  }
  w.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrlIfAllowed(url)
    return { action: 'deny' }
  })
}

ipcMain.handle('app:open-container-files-window', (_evt, payload: unknown) => {
  const p = payload as { containerId?: string; initialPath?: string }
  const id = typeof p.containerId === 'string' ? p.containerId.trim() : ''
  if (!id) return Promise.resolve(ipcErr('invalid container id'))
  const initial =
    typeof p.initialPath === 'string' && p.initialPath.trim() ? p.initialPath.trim() : '/'
  try {
    createFilesWindow(id, initial)
    return Promise.resolve(ipcOk(undefined))
  } catch (e) {
    return Promise.resolve(ipcErr(e instanceof Error ? e.message : String(e)))
  }
})

async function createWindow() {
  win = new BrowserWindow({
    title: 'Docker Browser',
    width: 1240,
    height: 780,
    minWidth: 960,
    minHeight: 560,
    icon: windowIconPath,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(indexHtml)
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrlIfAllowed(url)
    return { action: 'deny' }
  })

  win.once('closed', () => {
    win = null
  })
}

app.whenReady().then(() => {
  setUpdaterMenuRefresh(() => rebuildApplicationMenu())
  installAppMenu()
  scheduleStartupUpdateCheck()
  createWindow()
})

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  const w = win ?? BrowserWindow.getAllWindows()[0]
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) w.restore()
    w.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})
