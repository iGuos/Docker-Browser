import type { TFunction } from 'i18next'

/** 将引擎 / IPC 返回的说明包装为界面语言；`cancelled` 不提示 */
export function formatEngineError(t: TFunction, message: string): string | null {
  const m = (message ?? '').trim()
  if (!m || m === 'cancelled') return null
  return t('common.errorDetail', { detail: m })
}

export function formatThrownEngineError(t: TFunction, err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err)
  return formatEngineError(t, msg)
}

export type AppAlertOptions = { copyable?: boolean }

export async function alertEngineError(
  alert: (msg: string, options?: AppAlertOptions) => Promise<void>,
  t: TFunction,
  message: string,
  options?: AppAlertOptions,
): Promise<void> {
  const text = formatEngineError(t, message)
  if (text) await alert(text, options)
}
