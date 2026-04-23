import { useTranslation } from 'react-i18next'

export function LogWindowErrorView({ kind = 'logs' }: { kind?: 'logs' | 'files' | 'exec' }) {
  const { t } = useTranslation()
  const msg =
    kind === 'files' ? t('files.windowMissingId') : kind === 'exec' ? t('containers.execWindowMissingId') : t('logs.windowMissingId')
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-2 bg-zinc-50 p-4 text-center text-sm text-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
      <p>{msg}</p>
    </div>
  )
}
