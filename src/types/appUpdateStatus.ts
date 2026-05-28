/** 主进程通过 `AppIpc.updateStatusEvent` 推送给渲染进程 */
export type AppUpdateStatus =
  | { kind: 'checking' }
  | { kind: 'available'; version: string; releaseNotes?: string }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string }
  | { kind: 'progress'; percent: number; transferred?: number; total?: number }
  | { kind: 'downloaded'; version: string }

export function parseAppUpdateStatus(raw: unknown): AppUpdateStatus | null {
  if (!raw || typeof raw !== 'object') return null
  const k = (raw as { kind?: unknown }).kind
  if (k === 'checking') return { kind: 'checking' }
  if (k === 'not-available') return { kind: 'not-available' }
  if (k === 'available' && typeof (raw as { version?: unknown }).version === 'string') {
    const rn = (raw as { releaseNotes?: unknown }).releaseNotes
    return {
      kind: 'available',
      version: (raw as { version: string }).version,
      releaseNotes: typeof rn === 'string' && rn.trim() ? rn : undefined,
    }
  }
  if (k === 'error' && typeof (raw as { message?: unknown }).message === 'string') {
    return { kind: 'error', message: (raw as { message: string }).message }
  }
  if (k === 'progress' && typeof (raw as { percent?: unknown }).percent === 'number') {
    const p = raw as { percent: number; transferred?: number; total?: number }
    return {
      kind: 'progress',
      percent: p.percent,
      transferred: typeof p.transferred === 'number' ? p.transferred : undefined,
      total: typeof p.total === 'number' ? p.total : undefined,
    }
  }
  if (k === 'downloaded' && typeof (raw as { version?: unknown }).version === 'string') {
    return { kind: 'downloaded', version: (raw as { version: string }).version }
  }
  return null
}
