import type { IpcResult } from '@/types/ipc'

export async function unwrapIpc<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.data
}
