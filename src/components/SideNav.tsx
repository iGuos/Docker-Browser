import { useTranslation } from 'react-i18next'
import { useDockerStore, type TabId } from '@/stores/dockerStore'

const tabs: { id: TabId; labelKey: string }[] = [
  { id: 'containers', labelKey: 'nav.containers' },
  { id: 'images', labelKey: 'nav.images' },
  { id: 'networks', labelKey: 'nav.networks' },
  { id: 'volumes', labelKey: 'nav.volumes' },
  { id: 'metrics', labelKey: 'nav.metrics' },
  { id: 'events', labelKey: 'nav.events' },
  { id: 'system', labelKey: 'nav.system' },
]

export function SideNav() {
  const { t } = useTranslation()
  const tab = useDockerStore((s) => s.tab)
  const busy = useDockerStore((s) => s.busy)
  const setTab = useDockerStore((s) => s.setTab)

  return (
    <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-zinc-200/80 bg-zinc-50/90 p-2 dark:border-white/[0.06] dark:bg-zinc-950/80">
      {tabs.map(({ id, labelKey }) => (
        <button
          key={id}
          type="button"
          disabled={busy}
          title={busy ? t('nav.switchWhenReady') : undefined}
          onClick={() => setTab(id)}
          className={`rounded-lg px-3 py-2 text-left text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
            tab === id
              ? 'bg-sky-600 text-white shadow-sm dark:bg-sky-700'
              : 'text-zinc-700 hover:bg-zinc-200/80 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
          }`}
        >
          {t(labelKey)}
        </button>
      ))}
    </nav>
  )
}
