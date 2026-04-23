import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContainerExecView } from '@/components/ContainerExecView'

type Row = { Id: string; Names?: string[] }

function shortId(id: string): string {
  return id.replace(/^sha256:/i, '').slice(0, 12)
}

function displayName(c: Row): string {
  const n = c.Names?.[0]
  if (n) return n.replace(/^\//, '')
  return shortId(c.Id)
}

export function ContainerExecWindowApp({ containerId }: { containerId: string }) {
  const { t } = useTranslation()
  const [label, setLabel] = useState<string>(() => shortId(containerId))
  const [listError, setListError] = useState<string | null>(null)

  useEffect(() => {
    setListError(null)
    void window.dockerDesktop.listContainers({ all: true }).then((res) => {
      if (!res.ok) {
        setListError(res.error)
        return
      }
      const list = res.data as Row[]
      const c =
        list.find((x) => x.Id === containerId) ??
        list.find((x) => x.Id.replace(/^sha256:/i, '') === containerId.replace(/^sha256:/i, ''))
      if (c) {
        const name = displayName(c)
        setLabel(name)
        document.title = `${name} · ${t('containers.contextExec')}`
      } else {
        document.title = `${shortId(containerId)} · ${t('containers.contextExec')}`
      }
    })
  }, [containerId, t])

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div
        className="pointer-events-none absolute inset-0 opacity-30 dark:opacity-40"
        aria-hidden
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(14, 165, 233, 0.12), transparent), radial-gradient(ellipse 60% 40% at 100% 50%, rgba(34, 211, 238, 0.06), transparent)',
        }}
      />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-zinc-200/80 bg-zinc-100/90 px-3 py-2 dark:border-white/[0.06] dark:bg-zinc-900/90">
          <h1 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{label}</h1>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{containerId}</p>
          {listError ? (
            <p className="mt-1 rounded border border-amber-300/80 bg-amber-50 px-2 py-1 text-[10px] text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
              {t('logs.listContainersFailed', { detail: listError })}
            </p>
          ) : null}
        </header>
        <ContainerExecView containerId={containerId} className="min-h-0 flex-1 border-t-0" />
      </div>
    </div>
  )
}
