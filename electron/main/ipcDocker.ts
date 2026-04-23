import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import type { ContainerCreateOptions, HostConfig } from 'dockerode'
import type { DockerLogsChunk } from '../../shared/dockerLogs'
import { DockerIpc } from '../../shared/dockerIpcChannels'
import type { DockerCliProgressPayload } from '../../shared/dockerCliProgress'
import type { RunningContainersMemorySummary } from '../../shared/dockerMemorySummary'
import { ipcErr, ipcOk, type IpcResult } from '../../shared/ipc'
import { getDocker, resetDockerClient } from './dockerClient'
import { demuxDockerLogStream } from './dockerLogDemux'
import { normalizeRestartPolicyName, restartPolicyToDocker } from '../../shared/restartPolicy'
import {
  buildAndRunFromDockerfile,
  composeUpFromYaml,
  createAndRestartFromDockerRunCli,
} from './dockerCliCreate'
import { parseEnvLines, parsePortPublish } from './dockerCreateHelpers'
import { buildRecreateCreateOptions } from './dockerRecreateHelpers'
import { killAllDockerPtySessions, registerDockerExecPtyIpc } from './dockerExecPty'
import {
  CONTAINER_FS_MAX_READ_BYTES,
  containerExecArgv,
  extractFirstFileFromTar,
  getArchiveBuffer,
  listDirectoryFromGetArchiveStream,
  listDirectoryViaExec,
  normalizeContainerPath,
  packSingleFileEntry,
  type TarListEntry,
} from './containerFs'
import { getAppMenuLanguage } from './appMenu'
import {
  formatContainerUploadMessage,
  formatUploadFileTooLarge,
  getIpcDialogStrings,
} from '../../shared/ipcDialogStrings'

type StreamSub = {
  wc: WebContents
  destroy: () => void
}

const logSubs = new Map<string, StreamSub>()
const eventSubs = new Map<string, StreamSub>()

/** 当前正在进行的 exec 流清理（仅允许同时取消一个）。 */
let execStreamCleanup: (() => void) | null = null

let registered = false

function docker() {
  return getDocker()
}

/** 避免一次性并发过多 stats 把引擎拖慢，分批拉取。 */
const CONTAINER_STATS_BATCH = 8

function readContainerStatsMemoryUsageBytes(stats: unknown): number | null {
  if (!stats || typeof stats !== 'object') return null
  const ms = (stats as Record<string, unknown>).memory_stats
  if (!ms || typeof ms !== 'object') return null
  const m = ms as Record<string, unknown>
  const usage = m.usage
  if (typeof usage === 'number' && Number.isFinite(usage) && usage >= 0) return usage
  const st = m.stats
  if (st && typeof st === 'object') {
    const o = st as Record<string, unknown>
    const anon = typeof o.anon === 'number' && Number.isFinite(o.anon) ? o.anon : 0
    const file = typeof o.file === 'number' && Number.isFinite(o.file) ? o.file : 0
    const t = anon + file
    if (t > 0) return t
  }
  return null
}

async function collectRunningContainersMemoryParts(
  list: { Id?: string }[],
): Promise<{ used: number; counted: number; skipped: number }[]> {
  const parts: { used: number; counted: number; skipped: number }[] = []
  for (let i = 0; i < list.length; i += CONTAINER_STATS_BATCH) {
    const batch = list.slice(i, i + CONTAINER_STATS_BATCH)
    const chunk = await Promise.all(
      batch.map(async (row) => {
        const id = typeof row.Id === 'string' ? row.Id : ''
        if (!id) return { used: 0, counted: 0, skipped: 1 }
        try {
          const stats = await docker().getContainer(id).stats({ stream: false })
          const u = readContainerStatsMemoryUsageBytes(stats)
          if (u !== null) return { used: u, counted: 1, skipped: 0 }
          return { used: 0, counted: 0, skipped: 1 }
        } catch {
          return { used: 0, counted: 0, skipped: 1 }
        }
      }),
    )
    parts.push(...chunk)
  }
  return parts
}

function senderWindow(evt: { sender: WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(evt.sender) ?? BrowserWindow.getFocusedWindow()
}

function ipcDlg() {
  return getIpcDialogStrings(getAppMenuLanguage())
}

export function registerDockerIpc(): void {
  if (registered) return
  registered = true
  registerDockerExecPtyIpc()

  app.on('before-quit', () => {
    try {
      execStreamCleanup?.()
    } catch {
      /* ignore */
    }
    execStreamCleanup = null
    killAllDockerPtySessions()
    for (const sub of logSubs.values()) sub.destroy()
    logSubs.clear()
    for (const sub of eventSubs.values()) sub.destroy()
    eventSubs.clear()
  })

  ipcMain.handle('docker:ping', async (): Promise<IpcResult<string>> => {
    try {
      await docker().ping()
      return ipcOk('ok')
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle('docker:info', async (): Promise<IpcResult<unknown>> => {
    try {
      return ipcOk(await docker().info())
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle('docker:version', async (): Promise<IpcResult<unknown>> => {
    try {
      return ipcOk(await docker().version())
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle('docker:df', async (): Promise<IpcResult<unknown>> => {
    try {
      return ipcOk(await docker().df())
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(
    'docker:list-containers',
    async (_evt, opts?: { all?: boolean }): Promise<IpcResult<unknown[]>> => {
      try {
        const list = await docker().listContainers({ all: opts?.all !== false })
        return ipcOk(list)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    'docker:inspect-container',
    async (_evt, id: unknown): Promise<IpcResult<unknown>> => {
      if (typeof id !== 'string' || !id) return ipcErr('invalid id')
      try {
        const c = docker().getContainer(id)
        return ipcOk(await c.inspect())
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle('docker:start-container', async (_evt, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string' || !id) return ipcErr('invalid id')
    try {
      const c = docker().getContainer(id)
      await c.start()
      return ipcOk(undefined)
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle('docker:stop-container', async (_evt, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string' || !id) return ipcErr('invalid id')
    try {
      const c = docker().getContainer(id)
      await c.stop()
      return ipcOk(undefined)
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle('docker:restart-container', async (_evt, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string' || !id) return ipcErr('invalid id')
    try {
      const c = docker().getContainer(id)
      await c.restart()
      return ipcOk(undefined)
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle('docker:kill-container', async (_evt, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string' || !id) return ipcErr('invalid id')
    try {
      const c = docker().getContainer(id)
      await c.kill()
      return ipcOk(undefined)
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(
    'docker:pause-container',
    async (_evt, id: unknown): Promise<IpcResult<void>> => {
      if (typeof id !== 'string' || !id) return ipcErr('invalid id')
      try {
        const c = docker().getContainer(id)
        await c.pause()
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    'docker:unpause-container',
    async (_evt, id: unknown): Promise<IpcResult<void>> => {
      if (typeof id !== 'string' || !id) return ipcErr('invalid id')
      try {
        const c = docker().getContainer(id)
        await c.unpause()
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    'docker:remove-container',
    async (_evt, payload: unknown): Promise<IpcResult<void>> => {
      const p = payload as { id?: string; force?: boolean; v?: boolean }
      if (typeof p?.id !== 'string' || !p.id) return ipcErr('invalid id')
      try {
        const c = docker().getContainer(p.id)
        await c.remove({ force: p.force === true, v: p.v === true })
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle('docker:list-images', async (): Promise<IpcResult<unknown[]>> => {
    try {
      return ipcOk(await docker().listImages())
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(
    'docker:inspect-image',
    async (_evt, name: unknown): Promise<IpcResult<unknown>> => {
      if (typeof name !== 'string' || !name) return ipcErr('invalid name')
      try {
        const img = docker().getImage(name)
        return ipcOk(await img.inspect())
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    'docker:remove-image',
    async (_evt, payload: unknown): Promise<IpcResult<unknown[]>> => {
      const p = payload as { name?: string; force?: boolean; noprune?: boolean }
      if (typeof p?.name !== 'string' || !p.name) return ipcErr('invalid name')
      try {
        const img = docker().getImage(p.name)
        const res = await img.remove({ force: p.force === true, noprune: p.noprune === true })
        return ipcOk(res)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle('docker:pull-image', async (_evt, repoTag: unknown): Promise<IpcResult<void>> => {
    if (typeof repoTag !== 'string' || !repoTag) return ipcErr('invalid repoTag')
    try {
      const dk = docker()
      await new Promise<void>((resolve, reject) => {
        dk.pull(repoTag, (err: Error | null, stream: Readable | undefined) => {
          if (err || !stream) {
            reject(err ?? new Error('no stream'))
            return
          }
          dk.modem.followProgress(stream, () => {}, (err2: Error | null) => {
            if (err2) reject(err2)
            else resolve()
          })
        })
      })
      return ipcOk(undefined)
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle('docker:list-networks', async (): Promise<IpcResult<unknown[]>> => {
    try {
      return ipcOk(await docker().listNetworks())
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(
    'docker:remove-network',
    async (_evt, id: unknown): Promise<IpcResult<void>> => {
      if (typeof id !== 'string' || !id) return ipcErr('invalid id')
      try {
        const n = docker().getNetwork(id)
        await n.remove()
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle('docker:list-volumes', async (): Promise<IpcResult<unknown>> => {
    try {
      return ipcOk(await docker().listVolumes())
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(
    'docker:remove-volume',
    async (_evt, name: unknown): Promise<IpcResult<void>> => {
      if (typeof name !== 'string' || !name) return ipcErr('invalid name')
      try {
        const v = docker().getVolume(name)
        await v.remove()
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    'docker:logs:start',
    async (
      evt,
      opts: { containerId: string; tail?: number; timestamps?: boolean },
    ): Promise<IpcResult<{ subscriptionId: string }>> => {
      try {
        const { containerId, tail = 200, timestamps = true } = opts ?? {}
        if (typeof containerId !== 'string' || !containerId) return ipcErr('invalid containerId')

        const c = docker().getContainer(containerId)
        const inspect = await c.inspect()

        const stream = (await c.logs({
          follow: true,
          stdout: true,
          stderr: true,
          tail,
          timestamps,
        })) as unknown as Readable

        const subscriptionId = randomUUID()
        const wc = evt.sender

        const sendText = (text: string) => {
          if (wc.isDestroyed()) return
          wc.send(DockerIpc.logsChunk, { subscriptionId, text } satisfies DockerLogsChunk)
        }

        const destroyStream = () => {
          try {
            stream.destroy()
          } catch {
            /* ignore */
          }
        }

        let offDemux: (() => void) | undefined

        if (inspect.Config.Tty === true) {
          const onData = (chunk: Buffer) => sendText(chunk.toString('utf8'))
          stream.on('data', onData)
          offDemux = () => stream.off('data', onData)
        } else {
          offDemux = demuxDockerLogStream(stream, (_type, payload) => {
            sendText(payload.toString('utf8'))
          })
        }

        const destroy = () => {
          offDemux?.()
          destroyStream()
        }

        const sub: StreamSub = { wc, destroy }
        logSubs.set(subscriptionId, sub)

        const done = () => {
          destroy()
          logSubs.delete(subscriptionId)
        }

        stream.on('end', done)
        stream.on('close', done)
        stream.on('error', done)

        wc.once('destroyed', () => {
          if (logSubs.has(subscriptionId)) done()
        })

        return ipcOk({ subscriptionId })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    'docker:logs:stop',
    async (_evt, subscriptionId: unknown): Promise<IpcResult<void>> => {
      if (typeof subscriptionId !== 'string') return ipcErr('invalid subscription')
      const sub = logSubs.get(subscriptionId)
      if (!sub) return ipcOk(undefined)
      sub.destroy()
      logSubs.delete(subscriptionId)
      return ipcOk(undefined)
    },
  )

  ipcMain.handle(
    'docker:create-run-container',
    async (
      _evt,
      payload: unknown,
    ): Promise<IpcResult<{ id: string }>> => {
      const p = payload as {
        image?: string
        name?: string
        envText?: string
        publishText?: string
        cmdText?: string
        autoRemove?: boolean
        restartPolicy?: string
      }
      const image = typeof p.image === 'string' ? p.image.trim() : ''
      if (!image) return ipcErr('image is required')

      const env = parseEnvLines(typeof p.envText === 'string' ? p.envText : '')
      const ports = typeof p.publishText === 'string' ? parsePortPublish(p.publishText) : null

      const cmdRaw = typeof p.cmdText === 'string' ? p.cmdText.trim() : ''
      const Cmd = cmdRaw ? cmdRaw.split(/\s+/).filter(Boolean) : undefined

      const name =
        typeof p.name === 'string' && p.name.trim()
          ? p.name.trim().replace(/^\/+/, '').toLowerCase()
          : undefined

      const restartPolicy = normalizeRestartPolicyName(
        typeof p.restartPolicy === 'string' ? p.restartPolicy : 'no',
      )

      try {
        const createOpts: ContainerCreateOptions = { Image: image }
        if (env.length) createOpts.Env = env
        if (Cmd && Cmd.length) createOpts.Cmd = Cmd

        const hostConfig: HostConfig = {}
        if (p.autoRemove === true) hostConfig.AutoRemove = true
        hostConfig.RestartPolicy =
          p.autoRemove === true ? restartPolicyToDocker('no') : restartPolicyToDocker(restartPolicy)
        if (ports) {
          createOpts.ExposedPorts = ports.ExposedPorts
          Object.assign(hostConfig, ports.HostConfig)
        }
        if (Object.keys(hostConfig).length > 0) createOpts.HostConfig = hostConfig

        const created = await docker().createContainer(name ? { ...createOpts, name } : createOpts)
        await created.start()
        return ipcOk({ id: created.id })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.createAndRestartFromDockerRunCli,
    async (evt, payload: unknown): Promise<IpcResult<void>> => {
      const line =
        typeof payload === 'string'
          ? payload
          : typeof (payload as { line?: unknown })?.line === 'string'
            ? (payload as { line: string }).line
            : ''
      const requestId =
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { requestId?: unknown }).requestId === 'string'
          ? (payload as { requestId: string }).requestId
          : ''
      if (!line.trim()) return ipcErr('Command is empty.')
      const send =
        requestId && !evt.sender.isDestroyed()
          ? (text: string) => {
              if (evt.sender.isDestroyed()) return
              evt.sender.send(DockerIpc.dockerCliProgress, {
                requestId,
                text,
              } satisfies DockerCliProgressPayload)
            }
          : undefined
      try {
        await createAndRestartFromDockerRunCli(line, send)
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.buildAndRunFromDockerfile,
    async (evt, payload: unknown): Promise<IpcResult<void>> => {
      const p = payload as { dockerfile?: string; imageTag?: string; requestId?: string }
      const dockerfile = typeof p.dockerfile === 'string' ? p.dockerfile : ''
      const imageTag = typeof p.imageTag === 'string' ? p.imageTag : ''
      const requestId = typeof p.requestId === 'string' ? p.requestId : ''
      const send =
        requestId && !evt.sender.isDestroyed()
          ? (text: string) => {
              if (evt.sender.isDestroyed()) return
              evt.sender.send(DockerIpc.dockerCliProgress, {
                requestId,
                text,
              } satisfies DockerCliProgressPayload)
            }
          : undefined
      try {
        await buildAndRunFromDockerfile(dockerfile, imageTag, send)
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.composeUpFromYaml,
    async (evt, payload: unknown): Promise<IpcResult<void>> => {
      const p = payload as { composeYaml?: string; projectName?: string; requestId?: string }
      const composeYaml = typeof p.composeYaml === 'string' ? p.composeYaml : ''
      const projectName = typeof p.projectName === 'string' ? p.projectName : ''
      const requestId = typeof p.requestId === 'string' ? p.requestId : ''
      const send =
        requestId && !evt.sender.isDestroyed()
          ? (text: string) => {
              if (evt.sender.isDestroyed()) return
              evt.sender.send(DockerIpc.dockerCliProgress, {
                requestId,
                text,
              } satisfies DockerCliProgressPayload)
            }
          : undefined
      try {
        await composeUpFromYaml(composeYaml, projectName || undefined, send)
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    'docker:recreate-container',
    async (_evt, payload: unknown): Promise<IpcResult<{ id: string }>> => {
      const p = payload as {
        containerId?: string
        image?: string
        name?: string
        envText?: string
        publishText?: string
        cmdText?: string
        autoRemove?: boolean
        restartPolicy?: string
      }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      const image = typeof p.image === 'string' ? p.image.trim() : ''
      if (!containerId) return ipcErr('containerId is required')
      if (!image) return ipcErr('image is required')

      try {
        const old = docker().getContainer(containerId)
        const ins = await old.inspect()
        const { createOpts, name } = buildRecreateCreateOptions(ins, {
          image,
          name: typeof p.name === 'string' ? p.name : undefined,
          envText: typeof p.envText === 'string' ? p.envText : '',
          publishText: typeof p.publishText === 'string' ? p.publishText : '',
          cmdText: typeof p.cmdText === 'string' ? p.cmdText : undefined,
          autoRemove: p.autoRemove === true,
          restartPolicy: typeof p.restartPolicy === 'string' ? p.restartPolicy : 'no',
        })

        if (ins.State.Paused) await old.unpause()
        if (ins.State.Running || ins.State.Restarting) await old.stop({ t: 10 })
        await old.remove()

        const created = await docker().createContainer(name ? { ...createOpts, name } : createOpts)
        await created.start()
        return ipcOk({ id: created.id })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.patchContainerRuntime,
    async (_evt, payload: unknown): Promise<IpcResult<void>> => {
      const p = payload as {
        containerId?: string
        name?: string
        restartPolicy?: string
        memoryMb?: number
        cpus?: number
        pidsLimit?: number
      }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!containerId) return ipcErr('containerId is required')

      try {
        const c = docker().getContainer(containerId)
        const ins = await c.inspect()
        const hc = ins.HostConfig ?? {}

        const newRp = normalizeRestartPolicyName(
          typeof p.restartPolicy === 'string' ? p.restartPolicy : 'no',
        )
        if (hc.AutoRemove === true && newRp !== 'no') {
          return ipcErr(
            'Auto-remove containers only support restart policy "no" (Docker engine limitation).',
          )
        }

        const currentName = (typeof ins.Name === 'string' ? ins.Name.replace(/^\//, '') : '')
          .trim()
          .toLowerCase()
        const raw = typeof p.name === 'string' ? p.name.trim().replace(/^\/+/, '') : ''
        const targetName = raw === '' ? currentName : raw.toLowerCase()
        const nameChanged = targetName !== currentName

        const existingRp = normalizeRestartPolicyName(
          (hc.RestartPolicy as { Name?: string } | undefined)?.Name,
        )
        const curPolicy = hc.RestartPolicy as
          | { Name?: string; MaximumRetryCount?: number }
          | undefined
        let restartChanged = existingRp !== newRp
        if (!restartChanged && newRp === 'on-failure') {
          const curCount =
            typeof curPolicy?.MaximumRetryCount === 'number' ? curPolicy.MaximumRetryCount : 5
          restartChanged = curCount !== 5
        }

        const updateBody: Record<string, unknown> = {}
        if (restartChanged) updateBody.RestartPolicy = restartPolicyToDocker(newRp)

        if (typeof p.memoryMb === 'number' && Number.isFinite(p.memoryMb)) {
          const mem = p.memoryMb <= 0 ? 0 : Math.floor(p.memoryMb * 1024 * 1024)
          const curMem = typeof hc.Memory === 'number' ? hc.Memory : 0
          if (mem !== curMem) updateBody.Memory = mem
        }
        if (typeof p.cpus === 'number' && Number.isFinite(p.cpus)) {
          const nanos = p.cpus <= 0 ? 0 : Math.round(p.cpus * 1e9)
          const curNano = typeof hc.NanoCpus === 'number' ? hc.NanoCpus : 0
          if (nanos !== curNano) updateBody.NanoCpus = nanos
        }
        if (typeof p.pidsLimit === 'number' && Number.isFinite(p.pidsLimit)) {
          const lim = p.pidsLimit <= 0 ? 0 : Math.floor(p.pidsLimit)
          const curP = typeof hc.PidsLimit === 'number' ? hc.PidsLimit : 0
          if (lim !== curP) updateBody.PidsLimit = lim
        }

        const needUpdate = Object.keys(updateBody).length > 0
        if (!nameChanged && !needUpdate) return ipcOk(undefined)

        if (nameChanged) await c.rename({ name: targetName })
        if (needUpdate) await c.update(updateBody)

        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    'docker:tag-image',
    async (
      _evt,
      payload: unknown,
    ): Promise<IpcResult<void>> => {
      const p = payload as { source?: string; repo?: string; tag?: string }
      const source = typeof p.source === 'string' ? p.source.trim() : ''
      const repo = typeof p.repo === 'string' ? p.repo.trim() : ''
      const tag = typeof p.tag === 'string' && p.tag.trim() ? p.tag.trim() : 'latest'
      if (!source || !repo) return ipcErr('source and repo are required')
      try {
        const img = docker().getImage(source)
        await img.tag({ repo, tag })
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.execCancelCurrent,
    async (): Promise<IpcResult<void>> => {
      try {
        execStreamCleanup?.()
      } catch {
        /* ignore */
      }
      execStreamCleanup = null
      killAllDockerPtySessions()
      return ipcOk(undefined)
    },
  )

  ipcMain.handle(
    DockerIpc.execOnce,
    async (_evt, payload: unknown): Promise<IpcResult<{ output: string; exitCode?: number }>> => {
      const p = payload as { containerId?: string; command?: string; timeoutSec?: number }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      const command = typeof p.command === 'string' ? p.command.trim() : ''
      if (!containerId) return ipcErr('invalid containerId')
      if (!command) return ipcErr('command is required')
      const timeoutSec =
        typeof p.timeoutSec === 'number' && Number.isFinite(p.timeoutSec)
          ? Math.min(600, Math.max(1, Math.floor(p.timeoutSec)))
          : 0
      try {
        const c = docker().getContainer(containerId)
        const exec = await c.exec({
          Cmd: ['sh', '-c', command],
          AttachStdout: true,
          AttachStderr: true,
        })
        const stream = (await exec.start({ hijack: true, stdin: false })) as unknown as Readable
        const cleanup = () => {
          try {
            stream.destroy()
          } catch {
            /* ignore */
          }
        }
        execStreamCleanup = cleanup
        const chunks: Buffer[] = []
        let timeoutId: NodeJS.Timeout | undefined
        const readPromise = new Promise<void>((resolve, reject) => {
          const off = demuxDockerLogStream(stream, (_type, buf) => {
            chunks.push(buf)
          })
          stream.on('end', () => {
            off()
            resolve()
          })
          stream.on('error', (err) => {
            off()
            reject(err)
          })
        })
        const timeoutPromise =
          timeoutSec > 0
            ? new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                  cleanup()
                  reject(new Error(`exec timeout after ${timeoutSec}s`))
                }, timeoutSec * 1000)
              })
            : null
        try {
          if (timeoutPromise) await Promise.race([readPromise, timeoutPromise])
          else await readPromise
        } finally {
          if (timeoutId) clearTimeout(timeoutId)
          if (execStreamCleanup === cleanup) execStreamCleanup = null
        }
        const inspectExec = await exec.inspect()
        return ipcOk({
          output: Buffer.concat(chunks).toString('utf8'),
          exitCode: inspectExec.ExitCode ?? undefined,
        })
      } catch (e) {
        execStreamCleanup = null
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    'docker:events:start',
    async (_evt, opts?: { sinceUnix?: number }): Promise<IpcResult<{ subscriptionId: string }>> => {
      try {
        const subscriptionId = randomUUID()
        const wc = _evt.sender

        const sinceUnix =
          typeof opts?.sinceUnix === 'number' && Number.isFinite(opts.sinceUnix)
            ? Math.floor(opts.sinceUnix)
            : undefined

        const stream = (await new Promise<Readable>((resolve, reject) => {
          docker().getEvents(
            {
              since: sinceUnix,
            },
            (err, s) => {
              if (err) reject(err)
              else if (!s) reject(new Error('no events stream'))
              else resolve(s as Readable)
            },
          )
        })) as Readable

        let buf = ''
        const sendLine = (line: string) => {
          if (wc.isDestroyed()) return
          wc.send(DockerIpc.eventsChunk, { subscriptionId, line })
        }

        const onData = (chunk: Buffer) => {
          buf += chunk.toString('utf8')
          const parts = buf.split('\n')
          buf = parts.pop() ?? ''
          for (const line of parts) {
            const t = line.trim()
            if (t) sendLine(t)
          }
        }

        const destroyStream = () => {
          try {
            stream.destroy()
          } catch {
            /* ignore */
          }
        }

        stream.on('data', onData)
        const destroy = () => {
          stream.off('data', onData)
          destroyStream()
        }

        const sub: StreamSub = { wc, destroy }
        eventSubs.set(subscriptionId, sub)

        const done = () => {
          destroy()
          eventSubs.delete(subscriptionId)
        }

        stream.on('end', done)
        stream.on('close', done)
        stream.on('error', done)

        wc.once('destroyed', () => {
          if (eventSubs.has(subscriptionId)) done()
        })

        return ipcOk({ subscriptionId })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    'docker:events:stop',
    async (_evt, subscriptionId: unknown): Promise<IpcResult<void>> => {
      if (typeof subscriptionId !== 'string') return ipcErr('invalid subscription')
      const sub = eventSubs.get(subscriptionId)
      if (!sub) return ipcOk(undefined)
      sub.destroy()
      eventSubs.delete(subscriptionId)
      return ipcOk(undefined)
    },
  )

  ipcMain.handle(
    DockerIpc.createNetwork,
    async (_evt, payload: unknown): Promise<IpcResult<{ id: string }>> => {
      const p = payload as { name?: string; driver?: string }
      const name = typeof p.name === 'string' ? p.name.trim() : ''
      if (!name) return ipcErr('name is required')
      const driver = typeof p.driver === 'string' && p.driver.trim() ? p.driver.trim() : 'bridge'
      try {
        const net = await docker().createNetwork({
          Name: name,
          Driver: driver,
          CheckDuplicate: true,
        })
        return ipcOk({ id: net.id })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.createVolume,
    async (_evt, payload: unknown): Promise<IpcResult<{ name: string }>> => {
      const p = payload as { name?: string }
      const name = typeof p.name === 'string' ? p.name.trim() : ''
      if (!name) return ipcErr('name is required')
      try {
        await docker().createVolume({ Name: name })
        return ipcOk({ name })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.networkConnect,
    async (_evt, payload: unknown): Promise<IpcResult<void>> => {
      const p = payload as { networkId?: string; containerId?: string }
      const networkId = typeof p.networkId === 'string' ? p.networkId.trim() : ''
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!networkId || !containerId) return ipcErr('networkId and containerId are required')
      try {
        const net = docker().getNetwork(networkId)
        await net.connect({ Container: containerId })
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.networkDisconnect,
    async (_evt, payload: unknown): Promise<IpcResult<void>> => {
      const p = payload as { networkId?: string; containerId?: string; force?: boolean }
      const networkId = typeof p.networkId === 'string' ? p.networkId.trim() : ''
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!networkId || !containerId) return ipcErr('networkId and containerId are required')
      try {
        const net = docker().getNetwork(networkId)
        await net.disconnect({ Container: containerId, Force: p.force === true })
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.volumeUsedBy,
    async (_evt, volumeName: unknown): Promise<IpcResult<{ containerIds: string[] }>> => {
      if (typeof volumeName !== 'string' || !volumeName.trim()) return ipcErr('volume name required')
      const name = volumeName.trim()
      try {
        const list = await docker().listContainers({ all: true })
        const containerIds: string[] = []
        for (const row of list) {
          const mounts = row.Mounts as { Type?: string; Name?: string }[] | undefined
          if (mounts?.some((m) => m.Type === 'volume' && m.Name === name)) {
            if (typeof row.Id === 'string') containerIds.push(row.Id)
          }
        }
        return ipcOk({ containerIds })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.containerStatsOnce,
    async (_evt, id: unknown): Promise<IpcResult<unknown>> => {
      if (typeof id !== 'string' || !id) return ipcErr('invalid id')
      try {
        const c = docker().getContainer(id)
        const stats = await c.stats({ stream: false })
        return ipcOk(stats)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.runningContainersMemorySummary,
    async (): Promise<IpcResult<RunningContainersMemorySummary>> => {
      try {
        const list = await docker().listContainers()
        const parts = await collectRunningContainersMemoryParts(list)
        const usedBytes = parts.reduce((a, p) => a + p.used, 0)
        const countedContainers = parts.reduce((a, p) => a + p.counted, 0)
        const skippedContainers = parts.reduce((a, p) => a + p.skipped, 0)
        return ipcOk({ usedBytes, countedContainers, skippedContainers })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.containersMemoryUsage,
    async (_evt, idsUnknown: unknown): Promise<IpcResult<Record<string, number>>> => {
      if (!Array.isArray(idsUnknown)) return ipcErr('container id list required')
      const rawIds = idsUnknown.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      if (rawIds.length === 0) return ipcOk({})
      const out: Record<string, number> = {}
      for (let i = 0; i < rawIds.length; i += CONTAINER_STATS_BATCH) {
        const batch = rawIds.slice(i, i + CONTAINER_STATS_BATCH)
        await Promise.all(
          batch.map(async (id) => {
            try {
              const stats = await docker().getContainer(id.trim()).stats({ stream: false })
              const u = readContainerStatsMemoryUsageBytes(stats)
              if (u !== null) out[id.trim()] = u
            } catch {
              /* skip */
            }
          }),
        )
      }
      return ipcOk(out)
    },
  )

  ipcMain.handle(
    DockerIpc.imageHistory,
    async (_evt, name: unknown): Promise<IpcResult<unknown[]>> => {
      if (typeof name !== 'string' || !name) return ipcErr('invalid name')
      try {
        const img = docker().getImage(name)
        const h = await img.history()
        return ipcOk(Array.isArray(h) ? h : [])
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.saveImageTar,
    async (evt, payload: unknown): Promise<IpcResult<{ filePath: string }>> => {
      const p = payload as { name?: string }
      const name = typeof p.name === 'string' ? p.name.trim() : ''
      if (!name) return ipcErr('image name is required')
      const win = senderWindow(evt)
      if (!win) return ipcErr('No window for file dialog')
      const d = ipcDlg()
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: d.saveImageTitle,
        defaultPath: 'image.tar',
        filters: [{ name: d.tarFilterName, extensions: ['tar'] }],
      })
      if (canceled || !filePath) return ipcErr('cancelled')
      try {
        const stream = (await docker().getImage(name).get()) as Readable
        await pipeline(stream, createWriteStream(filePath))
        return ipcOk({ filePath })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.loadImageTar,
    async (evt): Promise<IpcResult<void>> => {
      const win = senderWindow(evt)
      if (!win) return ipcErr('No window for file dialog')
      const d = ipcDlg()
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: d.loadImageTitle,
        properties: ['openFile'],
        filters: [{ name: d.tarFilterName, extensions: ['tar'] }],
      })
      if (canceled || !filePaths?.[0]) return ipcErr('cancelled')
      try {
        const rs = createReadStream(filePaths[0])
        const resp = await docker().loadImage(rs)
        if (resp && typeof (resp as Readable).on === 'function') {
          await finished(resp as Readable)
        }
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.commitContainer,
    async (_evt, payload: unknown): Promise<IpcResult<{ id: string }>> => {
      const p = payload as { containerId?: string; repo?: string; tag?: string; comment?: string }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      const repo = typeof p.repo === 'string' ? p.repo.trim() : ''
      if (!containerId) return ipcErr('containerId is required')
      if (!repo) return ipcErr('repo is required')
      const tag = typeof p.tag === 'string' && p.tag.trim() ? p.tag.trim() : 'latest'
      try {
        const c = docker().getContainer(containerId)
        const res = await c.commit({
          repo,
          tag,
          comment: typeof p.comment === 'string' ? p.comment : undefined,
        })
        const id =
          typeof (res as { Id?: string }).Id === 'string'
            ? (res as { Id: string }).Id
            : typeof (res as { id?: string }).id === 'string'
              ? (res as { id: string }).id
              : ''
        if (!id) return ipcErr('commit returned no image id')
        return ipcOk({ id })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.exportContainerTar,
    async (evt, payload: unknown): Promise<IpcResult<{ filePath: string }>> => {
      const p = payload as { containerId?: string }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!containerId) return ipcErr('containerId is required')
      const win = senderWindow(evt)
      if (!win) return ipcErr('No window for file dialog')
      const d = ipcDlg()
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: d.exportContainerTitle,
        defaultPath: 'container-export.tar',
        filters: [{ name: d.tarFilterName, extensions: ['tar'] }],
      })
      if (canceled || !filePath) return ipcErr('cancelled')
      try {
        const stream = (await docker().getContainer(containerId).export()) as Readable
        await pipeline(stream, createWriteStream(filePath))
        return ipcOk({ filePath })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.containerFsList,
    async (_evt, payload: unknown): Promise<IpcResult<{ entries: TarListEntry[] }>> => {
      const p = payload as { containerId?: string; path?: string }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!containerId) return ipcErr('containerId is required')
      let dirPath = '/'
      try {
        dirPath = normalizeContainerPath(typeof p.path === 'string' ? p.path : '/')
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
      try {
        const c = docker().getContainer(containerId)
        const inspect = await c.inspect()
        const running = Boolean(inspect.State?.Running)
        if (running) {
          try {
            const entries = await listDirectoryViaExec(c, dirPath)
            return ipcOk({ entries })
          } catch {
            /* 无 sh/stat 等时回退到 getArchive 流式解析 */
          }
        }
        const entries = await listDirectoryFromGetArchiveStream(c, dirPath)
        return ipcOk({ entries })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.containerFsReadFile,
    async (_evt, payload: unknown): Promise<IpcResult<{ base64: string }>> => {
      const p = payload as { containerId?: string; path?: string }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!containerId) return ipcErr('containerId is required')
      let filePath = '/'
      try {
        filePath = normalizeContainerPath(typeof p.path === 'string' ? p.path : '')
        if (!p.path?.trim()) return ipcErr('path is required')
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
      try {
        const c = docker().getContainer(containerId)
        const buf = await getArchiveBuffer(c, filePath)
        const body = await extractFirstFileFromTar(buf, CONTAINER_FS_MAX_READ_BYTES)
        return ipcOk({ base64: body.toString('base64') })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.containerFsWriteFile,
    async (_evt, payload: unknown): Promise<IpcResult<void>> => {
      const p = payload as { containerId?: string; path?: string; base64?: string }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      const base64 = typeof p.base64 === 'string' ? p.base64 : ''
      if (!containerId) return ipcErr('containerId is required')
      let filePath = '/'
      try {
        filePath = normalizeContainerPath(typeof p.path === 'string' ? p.path : '')
        if (!p.path?.trim()) return ipcErr('path is required')
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
      let body: Buffer
      try {
        body = Buffer.from(base64, 'base64')
      } catch {
        return ipcErr('invalid base64')
      }
      if (body.length > CONTAINER_FS_MAX_READ_BYTES) return ipcErr(`file exceeds ${CONTAINER_FS_MAX_READ_BYTES} bytes`)
      const parent = path.posix.dirname(filePath)
      const base = path.posix.basename(filePath)
      if (!base || base === '.' || base === '..') return ipcErr('invalid file path')
      try {
        const c = docker().getContainer(containerId)
        const packStream = packSingleFileEntry(base, body)
        await c.putArchive(packStream as Readable, { path: parent || '/' })
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.containerFsRm,
    async (_evt, payload: unknown): Promise<IpcResult<void>> => {
      const p = payload as { containerId?: string; path?: string }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!containerId) return ipcErr('containerId is required')
      let target = '/'
      try {
        target = normalizeContainerPath(typeof p.path === 'string' ? p.path : '')
        if (!p.path?.trim()) return ipcErr('path is required')
        if (target === '/') return ipcErr('refusing to remove root')
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
      try {
        const c = docker().getContainer(containerId)
        const { exitCode, output } = await containerExecArgv(c, ['rm', '-rf', target])
        if (exitCode !== 0 && exitCode !== undefined)
          return ipcErr(output.trim() || `rm failed (exit ${exitCode})`)
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.containerFsMkdir,
    async (_evt, payload: unknown): Promise<IpcResult<void>> => {
      const p = payload as { containerId?: string; path?: string }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!containerId) return ipcErr('containerId is required')
      let dirPath = '/'
      try {
        dirPath = normalizeContainerPath(typeof p.path === 'string' ? p.path : '')
        if (!p.path?.trim()) return ipcErr('path is required')
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
      try {
        const c = docker().getContainer(containerId)
        const { exitCode, output } = await containerExecArgv(c, ['mkdir', '-p', dirPath])
        if (exitCode !== 0 && exitCode !== undefined)
          return ipcErr(output.trim() || `mkdir failed (exit ${exitCode})`)
        return ipcOk(undefined)
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.containerFsDownload,
    async (evt, payload: unknown): Promise<IpcResult<{ filePath: string }>> => {
      const p = payload as { containerId?: string; path?: string }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!containerId) return ipcErr('containerId is required')
      let remotePath = '/'
      try {
        remotePath = normalizeContainerPath(typeof p.path === 'string' ? p.path : '')
        if (!p.path?.trim()) return ipcErr('path is required')
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
      const win = senderWindow(evt)
      if (!win) return ipcErr('No window for file dialog')
      const d = ipcDlg()
      const baseName = path.posix.basename(remotePath) || 'download.tar'
      const { canceled, filePath: savePath } = await dialog.showSaveDialog(win, {
        title: d.containerDownloadTitle,
        message: d.containerDownloadMessage,
        defaultPath: baseName,
        filters: [
          { name: d.tarFilterName, extensions: ['tar'] },
          { name: d.allFilesFilterName, extensions: ['*'] },
        ],
        buttonLabel: d.containerDownloadSaveLabel,
      })
      if (canceled || !savePath) return ipcErr('cancelled')
      try {
        const c = docker().getContainer(containerId)
        const stream = (await c.getArchive({ path: remotePath })) as Readable
        await pipeline(stream, createWriteStream(savePath))
        return ipcOk({ filePath: savePath })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(
    DockerIpc.containerFsUpload,
    async (evt, payload: unknown): Promise<IpcResult<{ files: string[] }>> => {
      const p = payload as { containerId?: string; destDir?: string }
      const containerId = typeof p.containerId === 'string' ? p.containerId.trim() : ''
      if (!containerId) return ipcErr('containerId is required')
      let destDir = '/'
      try {
        destDir = normalizeContainerPath(typeof p.destDir === 'string' ? p.destDir : '/')
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
      const win = senderWindow(evt)
      if (!win) return ipcErr('No window for file dialog')
      const d = ipcDlg()
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: d.containerUploadTitle,
        message: formatContainerUploadMessage(d, destDir, CONTAINER_FS_MAX_READ_BYTES),
        properties: ['openFile', 'multiSelections'],
        buttonLabel: d.containerUploadButtonLabel,
      })
      if (canceled || !filePaths?.length) return ipcErr('cancelled')
      try {
        const c = docker().getContainer(containerId)
        const uploaded: string[] = []
        for (const fp of filePaths) {
          const body = await readFile(fp)
          if (body.length > CONTAINER_FS_MAX_READ_BYTES)
            return ipcErr(
              formatUploadFileTooLarge(d, path.basename(fp), CONTAINER_FS_MAX_READ_BYTES),
            )
          const name = path.basename(fp)
          const packStream = packSingleFileEntry(name, body)
          await c.putArchive(packStream as Readable, { path: destDir })
          uploaded.push(name)
        }
        return ipcOk({ files: uploaded })
      } catch (e) {
        return ipcErr(e instanceof Error ? e.message : String(e))
      }
    },
  )

  ipcMain.handle(DockerIpc.reconnectDocker, async (): Promise<IpcResult<void>> => {
    try {
      resetDockerClient()
      await docker().ping()
      return ipcOk(undefined)
    } catch (e) {
      return ipcErr(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(DockerIpc.openDocs, async (): Promise<IpcResult<void>> => {
    void shell.openExternal('https://docs.docker.com/engine/api/latest/')
    return ipcOk(undefined)
  })
}
