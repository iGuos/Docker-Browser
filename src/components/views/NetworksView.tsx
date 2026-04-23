import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { useDockerStore } from '@/stores/dockerStore'
import { unwrapIpc } from '@/lib/ipc'
import { formatThrownEngineError } from '@/lib/alertMessage'

type Row = {
  Id: string
  Name?: string
  Driver?: string
  Scope?: string
}

function shortId(id: string): string {
  return id.slice(0, 12)
}

export function NetworksView() {
  const { t } = useTranslation()
  const { alert, confirm } = useAppDialog()
  const networks = useDockerStore((s) => s.networks) as Row[]
  const busy = useDockerStore((s) => s.busy)
  const selectedNetworkId = useDockerStore((s) => s.selectedNetworkId)
  const setSelectedNetworkId = useDockerStore((s) => s.setSelectedNetworkId)
  const afterMutation = useDockerStore((s) => s.afterMutation)
  const containers = useDockerStore((s) => s.containers) as { Id: string; Names?: string[] }[]

  const sel = networks.find((n) => n.Id === selectedNetworkId) ?? null
  const [netName, setNetName] = useState('')
  const [netDriver, setNetDriver] = useState('bridge')
  const [connectCid, setConnectCid] = useState('')
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCheckedIds((prev) => {
      const valid = new Set(networks.map((n) => n.Id))
      const next = new Set<string>()
      for (const id of prev) if (valid.has(id)) next.add(id)
      return next
    })
  }, [networks])

  const allSelected = useMemo(
    () => networks.length > 0 && networks.every((n) => checkedIds.has(n.Id)),
    [networks, checkedIds],
  )

  useEffect(() => {
    const el = headerCheckboxRef.current
    if (!el) return
    el.indeterminate = checkedIds.size > 0 && !allSelected
  }, [checkedIds, allSelected])

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn()
      await afterMutation()
    } catch (e) {
      const text = formatThrownEngineError(t, e)
      if (text) await alert(text)
    }
  }

  const onRemoveSelected = async () => {
    if (checkedIds.size === 0) return
    if (!(await confirm(t('networks.removeBulkConfirm', { count: checkedIds.size })))) return
    const ids = [...checkedIds]
    const primary = selectedNetworkId
    void run(async () => {
      const failures: string[] = []
      let okCount = 0
      for (const id of ids) {
        const row = networks.find((x) => x.Id === id)
        if (!row) continue
        try {
          await unwrapIpc(window.dockerDesktop.removeNetwork(row.Id))
          okCount++
        } catch {
          failures.push(row.Name ?? shortId(row.Id))
        }
      }
      setCheckedIds(new Set())
      if (primary && ids.includes(primary)) setSelectedNetworkId(null)
      if (failures.length) {
        await alert(
          t('networks.removePartialResult', {
            ok: okCount,
            failed: failures.length,
            names: failures.slice(0, 12).join(', '),
          }),
        )
      }
    })
  }

  const onCreate = () => {
    const name = netName.trim()
    if (!name) return
    void run(async () => {
      await unwrapIpc(
        window.dockerDesktop.createNetwork({ name, driver: netDriver.trim() || 'bridge' }),
      )
      setNetName('')
    })
  }

  const onConnect = () => {
    if (!sel) return
    const containerId = connectCid.trim()
    if (!containerId) return
    void run(async () => {
      await unwrapIpc(window.dockerDesktop.networkConnect({ networkId: sel.Id, containerId }))
    })
  }

  const toggleChecked = (id: string, next: boolean) => {
    setCheckedIds((prev) => {
      const n = new Set(prev)
      if (next) n.add(id)
      else n.delete(id)
      return n
    })
  }

  const toggleSelectAll = () => {
    if (allSelected) setCheckedIds(new Set())
    else setCheckedIds(new Set(networks.map((n) => n.Id)))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('networks.title')}</h2>
          <p className="mt-0.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{t('networks.selectionHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={netName}
            onChange={(e) => setNetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              if (busy || !netName.trim()) return
              e.preventDefault()
              onCreate()
            }}
            placeholder={t('networks.createName')}
            title={t('networks.createName')}
            aria-label={t('networks.createNameAria')}
            className="w-48 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] dark:border-zinc-600 dark:bg-zinc-900"
          />
          <input
            value={netDriver}
            onChange={(e) => setNetDriver(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              if (busy || !netName.trim()) return
              e.preventDefault()
              onCreate()
            }}
            placeholder={t('networks.createDriver')}
            title={t('networks.createDriver')}
            aria-label={t('networks.createDriverAria')}
            className="w-32 shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={busy || !netName.trim()}
            onClick={() => void onCreate()}
            className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:pointer-events-none disabled:opacity-40"
          >
            {t('networks.createSubmit')}
          </button>
          <button
            type="button"
            disabled={checkedIds.size === 0 || busy}
            onClick={() => void onRemoveSelected()}
            className="rounded-md border border-rose-400 px-2 py-1 text-[11px] text-rose-800 hover:bg-rose-50 disabled:pointer-events-none disabled:opacity-40 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-950/30"
          >
            {t('networks.removeSelected')}
          </button>
        </div>
      </div>
      {sel ? (
        <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-x-2 gap-y-1 overflow-x-auto rounded-lg border border-zinc-200/70 bg-zinc-50/80 px-2 py-1.5 text-[11px] dark:border-white/[0.06] dark:bg-zinc-900/50">
          <span className="shrink-0 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{t('networks.connect')}</span>
          <select
            value={connectCid}
            onChange={(e) => setConnectCid(e.target.value)}
            aria-label={t('networks.connectSelectAria')}
            className="max-w-[min(42vw,14rem)] shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-[10px] dark:border-zinc-600 dark:bg-zinc-950"
          >
            <option value="">{t('networks.connectPick')}</option>
            {containers.map((c) => (
              <option key={c.Id} value={c.Id}>
                {(c.Names?.[0] ?? c.Id).replace(/^\//, '')} · {shortId(c.Id)}
              </option>
            ))}
          </select>
          <span className="min-w-0 flex-1" aria-hidden />
          <button
            type="button"
            disabled={busy || !connectCid}
            onClick={() => void onConnect()}
            className="shrink-0 rounded-md bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:pointer-events-none disabled:opacity-40"
          >
            {t('networks.connectRun')}
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200/80 dark:border-white/[0.06]">
        <table className="w-full min-w-[560px] border-collapse text-left text-[11px]">
          <thead className="sticky top-0 z-10 bg-zinc-100/95 text-zinc-600 backdrop-blur dark:bg-zinc-900/95 dark:text-zinc-400">
            <tr>
              <th className="w-9 border-b border-zinc-200 px-1 py-2 dark:border-zinc-800">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  className="align-middle"
                  disabled={networks.length === 0}
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  title={t('common.selectAll')}
                  aria-label={t('common.selectAll')}
                />
              </th>
              <th className="border-b border-zinc-200 px-2 py-2 font-medium dark:border-zinc-800">
                {t('common.name')}
              </th>
              <th className="border-b border-zinc-200 px-2 py-2 font-medium dark:border-zinc-800">
                {t('common.id')}
              </th>
              <th className="border-b border-zinc-200 px-2 py-2 font-medium dark:border-zinc-800">
                {t('common.driver')}
              </th>
              <th className="border-b border-zinc-200 px-2 py-2 font-medium dark:border-zinc-800">
                {t('common.scope')}
              </th>
            </tr>
          </thead>
          <tbody>
            {networks.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-10 text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400"
                >
                  {t('networks.emptyTable')}
                </td>
              </tr>
            ) : (
              networks.map((n) => {
                const active = n.Id === selectedNetworkId
                const checked = checkedIds.has(n.Id)
                return (
                  <tr
                    key={n.Id}
                    onClick={() => setSelectedNetworkId(n.Id)}
                    className={`cursor-pointer border-b border-zinc-100 hover:bg-sky-500/5 dark:border-zinc-800/80 dark:hover:bg-sky-500/10 ${
                      active ? 'bg-sky-500/10 dark:bg-sky-500/15' : ''
                    }`}
                  >
                    <td className="px-1 py-1.5 align-middle" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="align-middle"
                        checked={checked}
                        onChange={(e) => {
                          e.stopPropagation()
                          toggleChecked(n.Id, e.target.checked)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={n.Name ?? shortId(n.Id)}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle font-medium text-zinc-900 dark:text-zinc-100">
                      {n.Name ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 align-middle font-mono text-zinc-600 dark:text-zinc-400">{shortId(n.Id)}</td>
                    <td className="px-2 py-1.5 align-middle">{n.Driver ?? '—'}</td>
                    <td className="px-2 py-1.5 align-middle">{n.Scope ?? '—'}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
