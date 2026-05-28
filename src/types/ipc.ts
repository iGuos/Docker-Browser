export type IpcOk<T> = { ok: true; data: T }
export type IpcErr = { ok: false; error: string }
export type IpcResult<T> = IpcOk<T> | IpcErr

export function ipcOk<T>(data: T): IpcOk<T> {
  return { ok: true, data }
}

export function ipcErr(message: string): IpcErr {
  return { ok: false, error: message }
}
