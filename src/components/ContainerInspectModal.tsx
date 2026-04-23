import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalEscape } from '@/hooks/useModalEscape'
import {
  extractInspectLabels,
  extractInspectMounts,
  extractInspectNetworkNames,
} from '@shared/inspectContainerSummary'

type Props = {
  open: boolean
  title: string
  data: Record<string, unknown> | null
  onClose: () => void
}

export function ContainerInspectModal({ open, title, data, onClose }: Props) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'summary' | 'json'>('summary')

  useEffect(() => {
    if (open) setTab('summary')
  }, [open])

  useModalEscape(open, onClose)

  const mounts = useMemo(() => (data ? extractInspectMounts(data) : []), [data])
  const nets = useMemo(() => (data ? extractInspectNetworkNames(data) : []), [data])
  const labels = useMemo(() => (data ? extractInspectLabels(data) : []), [data])
  const jsonText = useMemo(() => (data ? JSON.stringify(data, null, 2) : ''), [data])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="container-inspect-title"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <h2 id="container-inspect-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('common.close')}
          </button>
        </div>
        <div className="flex gap-1 border-b border-zinc-200 px-2 pt-2 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => setTab('summary')}
            className={`rounded-t px-3 py-1.5 text-[11px] font-medium ${
              tab === 'summary'
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
            }`}
          >
            {t('containers.inspectTabSummary')}
          </button>
          <button
            type="button"
            onClick={() => setTab('json')}
            className={`rounded-t px-3 py-1.5 text-[11px] font-medium ${
              tab === 'json'
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
            }`}
          >
            {t('containers.inspectTabJson')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {tab === 'summary' ? (
            <div className="flex flex-col gap-4 text-[11px]">
              <section>
                <h3 className="mb-1.5 font-semibold text-zinc-800 dark:text-zinc-200">
                  {t('containers.inspectNetworks')}
                </h3>
                {nets.length ? (
                  <ul className="list-inside list-disc font-mono text-[10px] text-zinc-700 dark:text-zinc-300">
                    {nets.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-zinc-500">—</p>
                )}
              </section>
              <section>
                <h3 className="mb-1.5 font-semibold text-zinc-800 dark:text-zinc-200">
                  {t('containers.inspectMounts')}
                </h3>
                {mounts.length ? (
                  <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-700">
                    <table className="w-full border-collapse text-left text-[10px]">
                      <thead className="bg-zinc-50 dark:bg-zinc-950/80">
                        <tr>
                          <th className="border-b border-zinc-200 px-2 py-1 dark:border-zinc-700">
                            {t('containers.inspectMountType')}
                          </th>
                          <th className="border-b border-zinc-200 px-2 py-1 dark:border-zinc-700">
                            {t('containers.inspectMountName')}
                          </th>
                          <th className="border-b border-zinc-200 px-2 py-1 dark:border-zinc-700">
                            {t('containers.inspectMountSource')}
                          </th>
                          <th className="border-b border-zinc-200 px-2 py-1 dark:border-zinc-700">
                            {t('containers.inspectMountDest')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {mounts.map((m, i) => (
                          <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                            <td className="px-2 py-1">{m.type ?? '—'}</td>
                            <td className="px-2 py-1 font-mono">{m.name ?? '—'}</td>
                            <td className="max-w-[180px] truncate px-2 py-1 font-mono" title={m.source}>
                              {m.source ?? '—'}
                            </td>
                            <td className="max-w-[180px] truncate px-2 py-1 font-mono" title={m.destination}>
                              {m.destination ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-zinc-500">—</p>
                )}
              </section>
              <section>
                <h3 className="mb-1.5 font-semibold text-zinc-800 dark:text-zinc-200">
                  {t('containers.inspectLabels')}
                </h3>
                {labels.length ? (
                  <div className="max-h-48 overflow-auto rounded border border-zinc-200 dark:border-zinc-700">
                    <table className="w-full border-collapse text-left text-[10px]">
                      <tbody>
                        {labels.slice(0, 200).map((row) => (
                          <tr key={row.key} className="border-b border-zinc-100 dark:border-zinc-800">
                            <td className="whitespace-nowrap px-2 py-0.5 font-mono text-zinc-600 dark:text-zinc-400">
                              {row.key}
                            </td>
                            <td className="break-all px-2 py-0.5 font-mono text-zinc-800 dark:text-zinc-200">
                              {row.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-zinc-500">—</p>
                )}
              </section>
            </div>
          ) : (
            <pre className="font-mono text-[10px] leading-relaxed text-zinc-800 dark:text-zinc-200">
              {jsonText}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
