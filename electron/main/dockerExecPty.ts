import { ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import * as pty from 'node-pty'
import { DockerIpc } from '../../shared/dockerIpcChannels'
import { ipcErr, ipcOk, type IpcResult } from '../../shared/ipc'
import { envWithDockerCliInPath } from './dockerCliPath'

type PtySession = { pty: pty.IPty; wc: WebContents }

const dockerPtySessions = new Map<string, PtySession>()

let handlersRegistered = false

/** 应用退出或全局中断时静默结束所有 PTY（不向渲染进程发 exit）。 */
export function killAllDockerPtySessions(): void {
  const sessions = [...dockerPtySessions.values()]
  dockerPtySessions.clear()
  for (const s of sessions) {
    try {
      s.pty.kill()
    } catch {
      /* ignore */
    }
  }
}

export function registerDockerExecPtyIpc(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle(
    DockerIpc.execPtyStart,
    async (evt, payload: unknown): Promise<IpcResult<{ subscriptionId: string }>> => {
      const p = payload as { containerId?: string; cols?: number; rows?: number }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!containerId) return ipcErr('invalid containerId')
      const cols =
        typeof p.cols === 'number' && Number.isFinite(p.cols) ? Math.max(2, Math.min(400, Math.floor(p.cols))) : 80
      const rows =
        typeof p.rows === 'number' && Number.isFinite(p.rows) ? Math.max(2, Math.min(200, Math.floor(p.rows))) : 24

      const wc = evt.sender
      const subscriptionId = randomUUID()

      const dockerBin = process.platform === 'win32' ? 'docker.exe' : 'docker'
      const args = ['exec', '-it', containerId, '/bin/sh']

      let term: pty.IPty
      try {
        term = pty.spawn(dockerBin, args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: os.homedir(),
          env: envWithDockerCliInPath() as Record<string, string>,
        })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }

      dockerPtySessions.set(subscriptionId, { pty: term, wc })

      term.onData((data) => {
        if (wc.isDestroyed()) return
        try {
          wc.send(DockerIpc.execPtyData, { subscriptionId, data })
        } catch {
          /* ignore */
        }
      })

      term.onExit(({ exitCode, signal }) => {
        const had = dockerPtySessions.delete(subscriptionId)
        if (!had || wc.isDestroyed()) return
        try {
          wc.send(DockerIpc.execPtyExit, {
            subscriptionId,
            exitCode: typeof exitCode === 'number' ? exitCode : 0,
            signal: typeof signal === 'number' ? signal : undefined,
          })
        } catch {
          /* ignore */
        }
      })

      return ipcOk({ subscriptionId })
    },
  )

  ipcMain.handle(
    DockerIpc.execPtyStop,
    (evt, sid: unknown): IpcResult<void> => {
      const id = typeof sid === 'string' ? sid : ''
      if (!id) return ipcOk(undefined)
      const s = dockerPtySessions.get(id)
      if (!s) return ipcOk(undefined)
      if (s.wc.id !== evt.sender.id) return ipcErr('forbidden')
      try {
        s.pty.kill()
      } catch {
        /* ignore */
      }
      return ipcOk(undefined)
    },
  )

  ipcMain.handle(
    DockerIpc.execPtyWrite,
    (evt, payload: unknown): IpcResult<void> => {
      const p = payload as { subscriptionId?: string; data?: string }
      const sid = typeof p.subscriptionId === 'string' ? p.subscriptionId : ''
      const data = typeof p.data === 'string' ? p.data : ''
      if (!sid) return ipcErr('subscriptionId required')
      const s = dockerPtySessions.get(sid)
      if (!s) return ipcErr('session not found')
      if (s.wc.id !== evt.sender.id) return ipcErr('forbidden')
      try {
        s.pty.write(data)
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.execPtyResize,
    (evt, payload: unknown): IpcResult<void> => {
      const p = payload as { subscriptionId?: string; cols?: number; rows?: number }
      const sid = typeof p.subscriptionId === 'string' ? p.subscriptionId : ''
      const cols =
        typeof p.cols === 'number' && Number.isFinite(p.cols) ? Math.max(2, Math.min(400, Math.floor(p.cols))) : 80
      const rows =
        typeof p.rows === 'number' && Number.isFinite(p.rows) ? Math.max(2, Math.min(200, Math.floor(p.rows))) : 24
      if (!sid) return ipcErr('subscriptionId required')
      const s = dockerPtySessions.get(sid)
      if (!s) return ipcOk(undefined)
      if (s.wc.id !== evt.sender.id) return ipcErr('forbidden')
      try {
        s.pty.resize(cols, rows)
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )
}
