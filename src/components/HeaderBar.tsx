import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { useDockerStore } from '@/stores/dockerStore'
import { unwrapIpc } from '@/lib/ipc'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { formatThrownEngineError } from '@/lib/alertMessage'

export function HeaderBar() {
  const { t } = useTranslation()
  const { alert } = useAppDialog()
  const connectionOk = useDockerStore((s) => s.connectionOk)
  const busy = useDockerStore((s) => s.busy)
  const globalError = useDockerStore((s) => s.globalError)
  const tab = useDockerStore((s) => s.tab)
  const ping = useDockerStore((s) => s.ping)
  const loadTab = useDockerStore((s) => s.loadTab)
  const bumpMetricsRefresh = useDockerStore((s) => s.bumpMetricsRefresh)

  const runHeaderRefresh = useCallback(() => {
    void ping().then(() => {
      if (tab === 'metrics') bumpMetricsRefresh()
      else void loadTab(tab)
    })
  }, [ping, loadTab, tab, bumpMetricsRefresh])

  const onRefresh = () => {
    runHeaderRefresh()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault()
        runHeaderRefresh()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runHeaderRefresh])

  const onDocs = () => {
    void unwrapIpc(window.dockerDesktop.openEngineDocs()).catch(async (e) => {
      const text = formatThrownEngineError(t, e)
      if (text) await alert(text)
    })
  }

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200/80 bg-white/70 px-4 py-2.5 backdrop-blur dark:border-white/[0.06] dark:bg-zinc-950/70">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <img
          src="/favicon.svg"
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 rounded-lg border border-zinc-200/90 bg-zinc-900/5 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/40"
          decoding="async"
        />
        <h1 className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t('app.title')}
        </h1>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
            connectionOk === true
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : connectionOk === false
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                : 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connectionOk === true
                ? 'bg-emerald-500'
                : connectionOk === false
                  ? 'bg-rose-500'
                  : 'bg-zinc-400'
            }`}
            aria-hidden
          />
          {connectionOk === true
            ? t('header.connected')
            : connectionOk === false
              ? t('header.disconnected')
              : t('common.connectingEllipsis')}
        </span>
        {globalError ? (
          <span
            className="min-w-0 max-w-[min(52vw,18rem)] shrink truncate text-[10px] text-rose-600 dark:text-rose-400 sm:max-w-[20rem]"
            title={globalError}
          >
            {globalError}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          title={t('header.refreshShortcut')}
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          {t('header.refresh')}
        </button>
        <button
          type="button"
          onClick={onDocs}
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          {t('header.openDocs')}
        </button>
        <ThemeSwitcher />
        <LanguageSwitcher />
      </div>
    </header>
  )
}
