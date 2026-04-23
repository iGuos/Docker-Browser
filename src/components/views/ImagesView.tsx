import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InspectJsonModal } from '@/components/InspectJsonModal'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { useDockerStore } from '@/stores/dockerStore'
import { unwrapIpc } from '@/lib/ipc'
import { formatThrownEngineError } from '@/lib/alertMessage'

type Row = {
  Id: string
  RepoTags?: string[] | null
  Size?: number
  Created?: number
}

function shortId(id: string): string {
  return id.replace(/^sha256:/, '').slice(0, 12)
}

function imageApiName(im: Row): string {
  const t = im.RepoTags?.filter(Boolean)
  return t?.[0] ?? im.Id
}

function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}

export function ImagesView() {
  const { t } = useTranslation()
  const { alert, confirm } = useAppDialog()
  const images = useDockerStore((s) => s.images) as Row[]
  const busy = useDockerStore((s) => s.busy)
  const selectedImageRef = useDockerStore((s) => s.selectedImageRef)
  const setSelectedImageRef = useDockerStore((s) => s.setSelectedImageRef)
  const afterMutation = useDockerStore((s) => s.afterMutation)
  const [pullTag, setPullTag] = useState('nginx:latest')
  const [pulling, setPulling] = useState(false)
  const [tagRepo, setTagRepo] = useState('my-app')
  const [tagTag, setTagTag] = useState('latest')
  const [tagging, setTagging] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyText, setHistoryText] = useState('[]')
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const sel = images.find((im) => im.Id === selectedImageRef) ?? null
  const imageNameForApi = sel ? imageApiName(sel) : ''

  useEffect(() => {
    setCheckedIds((prev) => {
      const valid = new Set(images.map((i) => i.Id))
      const next = new Set<string>()
      for (const id of prev) if (valid.has(id)) next.add(id)
      return next
    })
  }, [images])

  const allSelected = useMemo(
    () => images.length > 0 && images.every((i) => checkedIds.has(i.Id)),
    [images, checkedIds],
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

  const onPull = () => {
    const tag = pullTag.trim()
    if (!tag) return
    void run(async () => {
      setPulling(true)
      try {
        await unwrapIpc(window.dockerDesktop.pullImage(tag))
      } finally {
        setPulling(false)
      }
    })
  }

  const onRemoveSelected = async () => {
    if (checkedIds.size === 0) return
    if (!(await confirm(t('images.removeBulkConfirm', { count: checkedIds.size })))) return
    const ids = [...checkedIds]
    const primary = selectedImageRef
    void run(async () => {
      const failures: string[] = []
      let okCount = 0
      for (const id of ids) {
        const im = images.find((x) => x.Id === id)
        if (!im) continue
        try {
          await unwrapIpc(window.dockerDesktop.removeImage({ name: imageApiName(im), force: false }))
          okCount++
        } catch {
          failures.push(imageApiName(im))
        }
      }
      setCheckedIds(new Set())
      if (primary && ids.includes(primary)) setSelectedImageRef(null)
      if (failures.length) {
        await alert(
          t('images.removePartialResult', {
            ok: okCount,
            failed: failures.length,
            names: failures.slice(0, 12).join(', '),
          }),
        )
      }
    })
  }

  const onTag = () => {
    if (!sel || !imageNameForApi) return
    const repo = tagRepo.trim()
    if (!repo) return
    void run(async () => {
      setTagging(true)
      try {
        await unwrapIpc(
          window.dockerDesktop.tagImage({
            source: imageNameForApi,
            repo,
            tag: tagTag.trim() || 'latest',
          }),
        )
      } finally {
        setTagging(false)
      }
    })
  }

  const onSaveTar = () => {
    if (!imageNameForApi) return
    void run(async () => {
      await unwrapIpc(window.dockerDesktop.saveImageTar({ name: imageNameForApi }))
    })
  }

  const onLoadTar = () => {
    void run(async () => {
      await unwrapIpc(window.dockerDesktop.loadImageTar())
    })
  }

  const onHistory = () => {
    if (!imageNameForApi) return
    void run(async () => {
      const res = await window.dockerDesktop.imageHistory(imageNameForApi)
      if (!res.ok) throw new Error(res.error)
      setHistoryText(JSON.stringify(res.data, null, 2))
      setHistoryOpen(true)
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
    else setCheckedIds(new Set(images.map((i) => i.Id)))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <InspectJsonModal
        open={historyOpen}
        title={t('images.historyTitle')}
        jsonText={historyText}
        onClose={() => setHistoryOpen(false)}
      />
      <div className="flex shrink-0 flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('images.title')}</h2>
          <p className="mt-0.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{t('images.selectionHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={pullTag}
            onChange={(e) => setPullTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              if (busy || pulling || !pullTag.trim()) return
              e.preventDefault()
              onPull()
            }}
            placeholder={t('images.pullPlaceholder')}
            aria-label={t('images.pullInputAria')}
            className="w-48 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] dark:border-zinc-600 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={busy || pulling || !pullTag.trim()}
            onClick={onPull}
            className="rounded-md bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:pointer-events-none disabled:opacity-40"
          >
            {pulling ? t('images.pulling') : t('images.pull')}
          </button>
          <button
            type="button"
            disabled={checkedIds.size === 0 || busy}
            onClick={() => void onRemoveSelected()}
            className="rounded-md border border-rose-400 px-2 py-1 text-[11px] text-rose-800 hover:bg-rose-50 disabled:pointer-events-none disabled:opacity-40 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-950/30"
          >
            {t('images.removeSelected')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onLoadTar()}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {t('images.loadTar')}
          </button>
        </div>
      </div>
      {sel && imageNameForApi ? (
        <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-x-2 gap-y-1 overflow-x-auto rounded-lg border border-zinc-200/70 bg-zinc-50/80 px-2 py-1.5 text-[11px] dark:border-white/[0.06] dark:bg-zinc-900/50">
          <span className="shrink-0 whitespace-nowrap text-zinc-500">{t('images.tagSource')}</span>
          <code
            className="max-w-[min(42vw,14rem)] shrink truncate rounded bg-zinc-200/80 px-1 py-0.5 font-mono text-[10px] dark:bg-zinc-800"
            title={imageNameForApi}
          >
            {imageNameForApi}
          </code>
          <span className="shrink-0 whitespace-nowrap text-zinc-500">{t('images.tagRepo')}</span>
          <input
            value={tagRepo}
            onChange={(e) => setTagRepo(e.target.value)}
            aria-label={t('images.tagRepo')}
            className="w-36 shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
          />
          <span className="shrink-0 whitespace-nowrap text-zinc-500">{t('images.tagLabel')}</span>
          <input
            value={tagTag}
            onChange={(e) => setTagTag(e.target.value)}
            aria-label={t('images.tagLabel')}
            className="w-24 shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
          />
          <button
            type="button"
            disabled={busy || tagging || !tagRepo.trim()}
            onClick={onTag}
            className="shrink-0 rounded-md border border-zinc-400 bg-white px-2 py-1 font-medium hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-500 dark:bg-zinc-800 dark:hover:bg-zinc-700/80"
          >
            {tagging ? t('common.loading') : t('images.tagAction')}
          </button>
          <span className="min-w-0 flex-1" aria-hidden />
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={!imageNameForApi || busy}
              onClick={() => void onHistory()}
              className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              {t('images.history')}
            </button>
            <button
              type="button"
              disabled={!imageNameForApi || busy}
              onClick={() => void onSaveTar()}
              className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              {t('images.saveTar')}
            </button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200/80 dark:border-white/[0.06]">
        <table className="w-full min-w-[640px] border-collapse text-left text-[11px]">
          <thead className="sticky top-0 z-10 bg-zinc-100/95 text-zinc-600 backdrop-blur dark:bg-zinc-900/95 dark:text-zinc-400">
            <tr>
              <th className="w-9 border-b border-zinc-200 px-1 py-2 dark:border-zinc-800">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  className="align-middle"
                  disabled={images.length === 0}
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  title={t('common.selectAll')}
                  aria-label={t('common.selectAll')}
                />
              </th>
              <th className="border-b border-zinc-200 px-2 py-2 font-medium dark:border-zinc-800">
                {t('common.tags')}
              </th>
              <th className="border-b border-zinc-200 px-2 py-2 font-medium dark:border-zinc-800">
                {t('common.id')}
              </th>
              <th className="border-b border-zinc-200 px-2 py-2 font-medium dark:border-zinc-800">
                {t('common.size')}
              </th>
            </tr>
          </thead>
          <tbody>
            {images.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-10 text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400"
                >
                  {t('images.emptyTable')}
                </td>
              </tr>
            ) : (
              images.map((im) => {
                const active = im.Id === selectedImageRef
                const tags = im.RepoTags?.filter(Boolean).join(', ') || `<${shortId(im.Id)}>`
                const checked = checkedIds.has(im.Id)
                return (
                  <tr
                    key={im.Id}
                    onClick={() => setSelectedImageRef(im.Id)}
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
                          toggleChecked(im.Id, e.target.checked)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={tags}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle text-zinc-900 dark:text-zinc-100">{tags}</td>
                    <td className="px-2 py-1.5 align-middle font-mono text-zinc-600 dark:text-zinc-400">
                      {shortId(im.Id)}
                    </td>
                    <td className="px-2 py-1.5 align-middle">{formatBytes(im.Size)}</td>
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
