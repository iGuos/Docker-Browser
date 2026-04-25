import { useTranslation } from 'react-i18next'

type Props = {
  checking: boolean
  starting: boolean
  dockerInstalled: boolean
  engineReachable: boolean
  canStartEngine: boolean
  errorText: string | null
  onRefresh: () => void
  onStartEngine: () => void
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
      aria-hidden
    />
  )
}

export function EngineBootstrapView(props: Props) {
  const { t } = useTranslation()
  const {
    checking,
    starting,
    dockerInstalled,
    engineReachable,
    canStartEngine,
    errorText,
    onRefresh,
    onStartEngine,
  } = props

  const engineStatusText = checking
    ? t('bootstrap.checking')
    : engineReachable
      ? t('bootstrap.engineRunning')
      : dockerInstalled
        ? t('bootstrap.engineStopped')
        : t('bootstrap.engineUnknown')

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <section className="w-full max-w-2xl rounded-2xl border border-zinc-200/90 bg-white/90 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('bootstrap.title')}</h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t('bootstrap.subtitle')}</p>

        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between rounded-lg border border-zinc-200/80 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/60">
            <span className="text-xs text-zinc-700 dark:text-zinc-300">{t('bootstrap.dockerInstalled')}</span>
            <span className="inline-flex items-center gap-2 text-xs font-medium">
              <Dot ok={dockerInstalled} />
              {dockerInstalled ? t('bootstrap.yes') : t('bootstrap.no')}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-zinc-200/80 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/60">
            <span className="text-xs text-zinc-700 dark:text-zinc-300">{t('bootstrap.engineStatus')}</span>
            <span className="inline-flex items-center gap-2 text-xs font-medium">
              <Dot ok={engineReachable} />
              {engineStatusText}
            </span>
          </div>
        </div>

        {errorText ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            {errorText}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={checking || starting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            {checking ? t('bootstrap.checking') : t('bootstrap.recheck')}
          </button>
          {canStartEngine ? (
            <button
              type="button"
              onClick={onStartEngine}
              disabled={starting}
              className="rounded-lg border border-sky-600 bg-sky-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-sky-700 disabled:opacity-50"
            >
              {starting ? t('bootstrap.starting') : t('bootstrap.startEngine')}
            </button>
          ) : null}
        </div>

        {!dockerInstalled ? (
          <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">{t('bootstrap.installHint')}</p>
        ) : null}
      </section>
    </div>
  )
}
