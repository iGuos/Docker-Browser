import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { alertEngineError, formatThrownEngineError } from '@/lib/alertMessage'
import { useDockerStore } from '@/stores/dockerStore'
import { unwrapIpc } from '@/lib/ipc'

const CARD =
  'rounded-xl border border-zinc-200/90 bg-white/95 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/70 dark:shadow-none'

const CARD_HEADER =
  'mb-3 flex items-center gap-2 border-b border-zinc-200/80 pb-2.5 dark:border-zinc-700/80'

const BTN_SECONDARY =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800'
const BTN_SKY =
  'rounded-md border border-sky-400 bg-white px-2.5 py-1.5 text-[11px] hover:bg-sky-50 disabled:pointer-events-none disabled:opacity-40 dark:border-sky-800 dark:bg-zinc-900 dark:hover:bg-sky-950/30'

function JsonBlock({ title, data }: { title: string; data: unknown }) {
  const { t } = useTranslation()
  const isEmpty = data === null || data === undefined
  const str = isEmpty ? '' : JSON.stringify(data, null, 2)
  return (
    <div className={`flex min-h-[200px] flex-1 flex-col overflow-hidden ${CARD}`}>
      <div className={`${CARD_HEADER} shrink-0 px-3 pt-3`}>
        <span className="h-5 w-0.5 shrink-0 rounded-full bg-sky-500/70" aria-hidden />
        <h3 className="text-[11px] font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">{title}</h3>
      </div>
      <pre
        className={`min-h-0 flex-1 overflow-auto px-3 pb-3 font-mono text-[10px] leading-relaxed ${
          isEmpty ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-800 dark:text-zinc-200'
        }`}
      >
        {isEmpty ? t('system.jsonEmpty') : str}
      </pre>
    </div>
  )
}

export function SystemView() {
  const { t } = useTranslation()
  const { alert } = useAppDialog()
  const systemInfo = useDockerStore((s) => s.systemInfo)
  const versionJson = useDockerStore((s) => s.versionJson)
  const diskJson = useDockerStore((s) => s.diskJson)
  const busy = useDockerStore((s) => s.busy)
  const afterMutation = useDockerStore((s) => s.afterMutation)
  const ping = useDockerStore((s) => s.ping)
  const [composeOut, setComposeOut] = useState<string>('')
  const [runtimeEnv, setRuntimeEnv] = useState<{ dockerHost: string; dockerContext: string } | null>(
    null,
  )
  const [appMeta, setAppMeta] = useState<{ version: string; isPackaged: boolean } | null>(null)
  const [composeBusy, setComposeBusy] = useState(false)
  const [reconnectBusy, setReconnectBusy] = useState(false)

  useEffect(() => {
    void window.dockerDesktop.getDockerRuntimeEnv().then((res) => {
      if (res.ok) setRuntimeEnv(res.data)
    })
  }, [])

  useEffect(() => {
    void window.dockerDesktop.getAppVersion().then((res) => {
      if (res.ok) setAppMeta(res.data)
    })
  }, [])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      await afterMutation()
    } catch (e) {
      const text = formatThrownEngineError(t, e)
      if (text) await alert(text)
    }
  }

  const refreshCompose = () => {
    setComposeBusy(true)
    void window.dockerDesktop.getComposeVersion().then(async (res) => {
      setComposeBusy(false)
      if (!res.ok) {
        setComposeOut('—')
        await alertEngineError(alert, t, res.error)
        return
      }
      setComposeOut(res.data)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-4">
      <header className="shrink-0">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('system.title')}</h2>
        <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {t('system.subtitle')}
        </p>
      </header>

      <section className={`${CARD} w-full p-4`} aria-labelledby="system-maintenance-heading">
        <div className={CARD_HEADER}>
          <span className="h-5 w-0.5 shrink-0 rounded-full bg-emerald-500/70" aria-hidden />
          <h3 id="system-maintenance-heading" className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
            {t('system.maintenanceTitle')}
          </h3>
        </div>
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-zinc-700 dark:text-zinc-300">
          <span className="text-zinc-500 dark:text-zinc-400">{t('system.appVersionLabel')}</span>
          <code className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
            {appMeta?.version ?? '—'}
          </code>
          {!appMeta?.isPackaged ? (
            <span className="text-[10px] text-zinc-500 dark:text-zinc-500">({t('system.devBuildHint')})</span>
          ) : (
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{t('system.appUpdateMenuHint')}</span>
          )}
        </div>
        <div className="mb-4">
          <button
            type="button"
            className={BTN_SKY}
            disabled={busy || reconnectBusy}
            aria-busy={reconnectBusy}
            title={t('system.reconnectDockerHint')}
            onClick={() => {
              setReconnectBusy(true)
              void run(async () => {
                await unwrapIpc(window.dockerDesktop.reconnectDocker())
                await ping()
              }).finally(() => setReconnectBusy(false))
            }}
          >
            {reconnectBusy ? t('common.loading') : t('system.reconnectDocker')}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-200/70 bg-zinc-50/60 p-3 dark:border-zinc-700/50 dark:bg-black/25">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t('system.composeVersion')}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={composeBusy || busy}
                aria-busy={composeBusy}
                onClick={() => refreshCompose()}
              >
                {composeBusy ? t('common.loading') : t('system.composeRefresh')}
              </button>
              <code className="break-all font-mono text-[10px] text-zinc-800 dark:text-zinc-200">
                {composeOut || '—'}
              </code>
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200/70 bg-zinc-50/60 p-3 dark:border-zinc-700/50 dark:bg-black/25">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t('system.runtimeEnv')}
            </div>
            <pre className="whitespace-pre-wrap break-all rounded-md border border-zinc-200/60 bg-white/80 p-2 font-mono text-[10px] leading-relaxed text-zinc-800 dark:border-zinc-600/60 dark:bg-zinc-950/50 dark:text-zinc-200">
              {runtimeEnv
                ? `DOCKER_HOST=${runtimeEnv.dockerHost || '(empty)'}\nDOCKER_CONTEXT=${runtimeEnv.dockerContext || '(empty)'}`
                : '—'}
            </pre>
          </div>
        </div>
        <div className="mt-4 space-y-2 rounded-lg border border-amber-200/60 bg-amber-50/35 p-3 text-[10px] leading-relaxed text-amber-950/90 dark:border-amber-900/35 dark:bg-amber-950/15 dark:text-amber-100/90">
          <p>{t('system.swarmNote')}</p>
          <p className="border-t border-amber-200/50 pt-2 dark:border-amber-800/40">{t('system.tlsNote')}</p>
        </div>
      </section>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <h3 className="shrink-0 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
          {t('system.diagnosticsHeading')}
        </h3>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
          <JsonBlock title={t('system.info')} data={systemInfo} />
          <JsonBlock title={t('system.version')} data={versionJson} />
          <JsonBlock title={t('system.disk')} data={diskJson} />
        </div>
      </div>
    </div>
  )
}
