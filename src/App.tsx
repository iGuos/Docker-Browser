import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { HeaderBar } from '@/components/HeaderBar'
import { SideNav } from '@/components/SideNav'
import { ContainersView } from '@/components/views/ContainersView'
import { ImagesView } from '@/components/views/ImagesView'
import { NetworksView } from '@/components/views/NetworksView'
import { VolumesView } from '@/components/views/VolumesView'
import { SystemView } from '@/components/views/SystemView'
import { EventsView } from '@/components/views/EventsView'
import { MetricsView } from '@/components/views/MetricsView'
import { useDockerStore } from '@/stores/dockerStore'
import { setAppLanguage } from '@/i18n/i18n'

export default function App() {
  const { t } = useTranslation()
  const tab = useDockerStore((s) => s.tab)
  const busy = useDockerStore((s) => s.busy)
  const ping = useDockerStore((s) => s.ping)
  const loadTab = useDockerStore((s) => s.loadTab)

  useEffect(() => {
    void ping().then(() => loadTab('containers'))
  }, [ping, loadTab])

  useEffect(() => {
    const unsub = window.appLocale?.onMenuLanguageSelect?.((lng) => {
      setAppLanguage(lng)
    })
    return () => {
      unsub?.()
    }
  }, [])

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div
        className="pointer-events-none absolute inset-0 opacity-30 dark:opacity-40"
        aria-hidden
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(14, 165, 233, 0.12), transparent), radial-gradient(ellipse 60% 40% at 100% 50%, rgba(34, 211, 238, 0.06), transparent)',
        }}
      />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <HeaderBar />
        <div className="flex min-h-0 flex-1">
          <SideNav />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              {busy && tab !== 'system' && tab !== 'events' && tab !== 'metrics' ? (
                <div
                  className="absolute inset-0 z-20 flex cursor-wait items-center justify-center bg-white/50 text-xs dark:bg-zinc-950/50"
                  role="status"
                  aria-live="polite"
                  aria-busy="true"
                >
                  {t('common.loading')}
                </div>
              ) : null}
              {tab === 'containers' ? <ContainersView /> : null}
              {tab === 'images' ? <ImagesView /> : null}
              {tab === 'networks' ? <NetworksView /> : null}
              {tab === 'volumes' ? <VolumesView /> : null}
              {tab === 'metrics' ? <MetricsView /> : null}
              {tab === 'events' ? <EventsView /> : null}
              {tab === 'system' ? <SystemView /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
