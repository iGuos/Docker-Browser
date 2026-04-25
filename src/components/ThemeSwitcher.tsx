import { useTranslation } from 'react-i18next'
import { useTheme } from '@/theme/ThemeProvider'
import type { ThemePreference } from '@shared/theme'

export function ThemeSwitcher() {
  const { preference, setPreference } = useTheme()
  const { t } = useTranslation()

  const btn = (p: ThemePreference, label: string) => (
    <button
      key={p}
      type="button"
      onClick={() => setPreference(p)}
      className={`rounded-md px-2 py-1 text-[10px] font-semibold transition ${
        preference === p
          ? 'bg-white text-sky-800 shadow-sm dark:bg-zinc-800 dark:text-sky-200'
          : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300'
      }`}
      aria-pressed={preference === p}
    >
      {label}
    </button>
  )

  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-zinc-200/90 bg-zinc-100/80 p-0.5 dark:border-white/[0.08] dark:bg-zinc-900/50"
      role="group"
      aria-label={t('theme.groupAria')}
    >
      {btn('light', t('theme.light'))}
      {btn('dark', t('theme.dark'))}
      {btn('system', t('theme.system'))}
    </div>
  )
}
