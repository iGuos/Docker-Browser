import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { useModalEscape } from '@/hooks/useModalEscape'
import { base64ToUtf8, utf8ToBase64 } from '@/lib/utf8Base64'
import { alertEngineError } from '@/lib/alertMessage'

type Row = { Id: string; Names?: string[] }

/** 与后端 `TarListEntry` 对齐（`ls -l` 风格列） */
type Entry = {
  name: string
  type: 'file' | 'directory'
  size: number
  mode: string
  nlink: number
  user: string
  group: string
  mtime: number
}

const EM = '—'

/** 行首小图标：目录 / 文件，便于一眼区分 */
function RowKindIcon({ kind }: { kind: 'dir' | 'file' }) {
  if (kind === 'dir') {
    return (
      <svg
        className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
      </svg>
    )
  }
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

const STAT_GRID_CLASS =
  'grid shrink-0 grid-cols-[minmax(7rem,10ch)_2.5rem_minmax(3.5rem,5.5rem)_minmax(3.5rem,5.5rem)_minmax(4rem,7ch)_minmax(9.5rem,13ch)] gap-x-1.5 font-mono text-[10px] leading-tight text-zinc-600 dark:text-zinc-400'

function formatListSize(n: number, lng: string): string {
  if (!Number.isFinite(n)) return '0'
  return Math.floor(n).toLocaleString(lng.replace('_', '-'))
}

function formatListMtime(sec: number, lng: string): string {
  if (!sec) return EM
  const d = new Date(sec * 1000)
  const now = new Date()
  const loc = lng.replace('_', '-')
  return d.toLocaleString(loc, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(d.getFullYear() !== now.getFullYear() ? ({ year: 'numeric' } as const) : {}),
  })
}

function TreeListHeader({ t, indent }: { t: (k: string) => string; indent: number }) {
  return (
    <div
      className="sticky top-0 z-20 flex min-w-[42rem] items-center gap-1 border-b border-zinc-200 bg-zinc-100 py-1 text-[10px] font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
      style={{ paddingLeft: indent }}
      role="row"
    >
      <span className="inline-flex w-5 shrink-0 justify-center" aria-hidden title={t('files.colKind')}>
        <span className="text-zinc-400">◇</span>
      </span>
      <span className="min-w-0 flex-1 truncate">{t('files.colName')}</span>
      <div className={STAT_GRID_CLASS} role="presentation">
        <span>{t('files.colMode')}</span>
        <span className="text-right">{t('files.colNlink')}</span>
        <span className="truncate">{t('files.colUser')}</span>
        <span className="truncate">{t('files.colGroup')}</span>
        <span className="text-right">{t('files.colSize')}</span>
        <span>{t('files.colMtime')}</span>
      </div>
    </div>
  )
}

function shortId(id: string): string {
  return id.replace(/^sha256:/i, '').slice(0, 12)
}

function displayName(c: Row): string {
  const n = c.Names?.[0]
  if (n) return n.replace(/^\//, '')
  return shortId(c.Id)
}

function joinPath(cwd: string, name: string): string {
  const base = cwd.endsWith('/') ? cwd.slice(0, -1) || '/' : cwd
  if (base === '/') return `/${name}`
  return `${base}/${name}`
}

function dirnameFs(p: string): string {
  if (p === '/' || !p) return '/'
  const n = p.replace(/\/+$/, '')
  const i = n.lastIndexOf('/')
  if (i <= 0) return '/'
  return n.slice(0, i) || '/'
}

/** 本地路径（含 `\` 或 `/`）取文件名 */
function basenameFs(p: string): string {
  const n = p.replace(/[/\\]+$/, '')
  const i = Math.max(n.lastIndexOf('\\'), n.lastIndexOf('/'))
  return i >= 0 ? n.slice(i + 1) : n
}

/** 本地路径取父目录；无法解析时返回空串 */
function parentFolderFs(p: string): string {
  const n = p.replace(/[/\\]+$/, '')
  const i = Math.max(n.lastIndexOf('\\'), n.lastIndexOf('/'))
  if (i < 0) return ''
  if (i === 0 && n[0] === '/') return '/'
  return n.slice(0, i)
}

function summarizeFileNames(names: string[], max = 4): string {
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')}…`
}

type XferState =
  | { k: 'idle' }
  | { k: 'busy'; op: 'download' | 'upload' }
  | { k: 'dl_ok'; path: string }
  | { k: 'up_ok'; files: string[] }
  | { k: 'err'; message: string }

function normalizeRoot(initialPath: string): string {
  const s = (initialPath ?? '').trim() || '/'
  const n = s.startsWith('/') ? s : `/${s}`
  return n.replace(/\/+$/, '') || '/'
}

type Selected = { path: string; type: 'file' | 'directory' }

function TreeRows({
  parentPath,
  depth,
  entries,
  expanded,
  loadingDirs,
  childrenCache,
  selectedPath,
  onSelect,
  onToggleDir,
  t,
  lng,
}: {
  parentPath: string
  depth: number
  entries: Entry[]
  expanded: Set<string>
  loadingDirs: Set<string>
  childrenCache: Map<string, Entry[]>
  selectedPath: string | null
  onSelect: (path: string, type: 'file' | 'directory') => void
  onToggleDir: (fullPath: string) => void
  t: (k: string) => string
  lng: string
}) {
  const pad = 6 + depth * 14
  return (
    <>
      {entries.map((e) => {
        const full = joinPath(parentPath, e.name)
        const isDir = e.type === 'directory'
        const open = expanded.has(full)
        const loading = loadingDirs.has(full)
        const kids = childrenCache.get(full)
        const isSel = selectedPath === full
        return (
          <div key={full} role="treeitem" aria-expanded={isDir ? open : undefined}>
            <div
              className={`flex min-w-[42rem] cursor-pointer items-center gap-1 border-b border-zinc-100 py-0.5 text-[11px] hover:bg-sky-500/5 dark:border-zinc-800 dark:hover:bg-sky-500/10 ${
                isSel ? 'bg-sky-500/10 dark:bg-sky-500/15' : ''
              } ${isDir ? 'border-l-2 border-l-sky-500/35' : 'border-l-2 border-l-transparent'}`}
              style={{ paddingLeft: pad }}
              onClick={() => onSelect(full, e.type)}
              onDoubleClick={
                isDir
                  ? (ev) => {
                      ev.preventDefault()
                      onToggleDir(full)
                    }
                  : undefined
              }
            >
              {isDir ? (
                <button
                  type="button"
                  aria-expanded={open}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onToggleDir(full)
                  }}
                >
                  {loading ? '…' : open ? '▾' : '▸'}
                </button>
              ) : (
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden />
              )}
              <span className="inline-flex shrink-0 items-center justify-center" aria-hidden>
                <RowKindIcon kind={isDir ? 'dir' : 'file'} />
              </span>
              <span
                className={`min-w-0 flex-1 truncate font-mono ${
                  isDir ? 'font-semibold text-sky-900 dark:text-sky-100' : 'text-zinc-700 dark:text-zinc-300'
                }`}
              >
                {e.name}
              </span>
              <div className={STAT_GRID_CLASS}>
                <span className="truncate">{e.mode || EM}</span>
                <span className="text-right">{Number.isFinite(e.nlink) ? String(e.nlink) : EM}</span>
                <span className="truncate" title={e.user}>
                  {e.user || EM}
                </span>
                <span className="truncate" title={e.group}>
                  {e.group || EM}
                </span>
                <span className="text-right">{isDir ? EM : formatListSize(e.size, lng)}</span>
                <span className="truncate">{formatListMtime(e.mtime, lng)}</span>
              </div>
            </div>
            {isDir && open ? (
              loading && !kids ? (
                <div className="py-1 text-[10px] text-zinc-500" style={{ paddingLeft: pad + 18 }}>
                  {t('common.loading')}
                </div>
              ) : kids && kids.length === 0 ? (
                <div className="py-1 text-[10px] text-zinc-500" style={{ paddingLeft: pad + 18 }}>
                  {t('files.empty')}
                </div>
              ) : kids ? (
                <TreeRows
                  parentPath={full}
                  depth={depth + 1}
                  entries={kids}
                  expanded={expanded}
                  loadingDirs={loadingDirs}
                  childrenCache={childrenCache}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  onToggleDir={onToggleDir}
                  t={t}
                  lng={lng}
                />
              ) : null
            ) : null}
          </div>
        )
      })}
    </>
  )
}

export function ContainerFilesWindowApp({
  containerId,
  initialPath,
}: {
  containerId: string
  initialPath: string
}) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage ?? i18n.language
  const { alert, confirm } = useAppDialog()
  const rootPath = useMemo(() => normalizeRoot(initialPath), [initialPath])

  const [label, setLabel] = useState<string>(() => shortId(containerId))
  const [childrenCache, setChildrenCache] = useState<Map<string, Entry[]>>(() => new Map())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<Selected | null>(null)
  const [rootBootstrapped, setRootBootstrapped] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editPath, setEditPath] = useState('')
  const [editText, setEditText] = useState('')
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const [mkdirName, setMkdirName] = useState('')
  const [xfer, setXfer] = useState<XferState>(() => ({ k: 'idle' }))
  const [pathCopied, setPathCopied] = useState(false)

  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  useEffect(() => {
    void window.dockerDesktop.listContainers({ all: true }).then((res) => {
      if (!res.ok) return
      const list = res.data as Row[]
      const c =
        list.find((x) => x.Id === containerId) ??
        list.find((x) => x.Id.replace(/^sha256:/i, '') === containerId.replace(/^sha256:/i, ''))
      if (c) {
        const name = displayName(c)
        setLabel(name)
        document.title = `${name} · ${t('files.title')}`
      } else {
        document.title = `${shortId(containerId)} · ${t('files.title')}`
      }
    })
  }, [containerId, t])

  useEffect(() => {
    let cancelled = false
    setRootBootstrapped(false)
    setChildrenCache(new Map())
    setExpanded(new Set())
    setSelected(null)
    setXfer({ k: 'idle' })
    setLoadingDirs(new Set([rootPath]))
    void (async () => {
      const res = await window.dockerDesktop.containerFsList({ containerId, path: rootPath })
      if (cancelled) {
        setLoadingDirs(new Set())
        return
      }
      setLoadingDirs((d) => {
        const n = new Set(d)
        n.delete(rootPath)
        return n
      })
      if (!res.ok) {
        await alertEngineError(alert, t, res.error)
        setRootBootstrapped(true)
        return
      }
      setChildrenCache(new Map([[rootPath, res.data.entries]]))
      setExpanded(new Set([rootPath]))
      setRootBootstrapped(true)
    })()
    return () => {
      cancelled = true
    }
  }, [alert, containerId, rootPath])

  useEffect(() => {
    if (xfer.k !== 'dl_ok' && xfer.k !== 'up_ok') return
    const id = window.setTimeout(() => setXfer({ k: 'idle' }), 9000)
    return () => window.clearTimeout(id)
  }, [xfer])

  useEffect(() => {
    if (!pathCopied) return
    const id = window.setTimeout(() => setPathCopied(false), 2000)
    return () => window.clearTimeout(id)
  }, [pathCopied])

  const targetDir = useMemo(() => {
    if (!selected) return rootPath
    if (selected.type === 'directory') return selected.path
    return dirnameFs(selected.path)
  }, [selected, rootPath])

  const anyLoading = loadingDirs.size > 0
  const xferBusy = xfer.k === 'busy'

  const reloadExpanded = useCallback(async () => {
    const paths = [...expandedRef.current].sort(
      (a, b) => a.split('/').filter(Boolean).length - b.split('/').filter(Boolean).length,
    )
    for (const p of paths) {
      const res = await window.dockerDesktop.containerFsList({ containerId, path: p })
      if (!res.ok) {
        await alertEngineError(alert, t, res.error)
        return
      }
      setChildrenCache((c) => new Map(c).set(p, res.data.entries))
    }
  }, [alert, containerId])

  const toggleDirectory = useCallback(
    async (fullPath: string) => {
      if (expandedRef.current.has(fullPath)) {
        setExpanded((e) => {
          const n = new Set(e)
          n.delete(fullPath)
          return n
        })
        return
      }
      setLoadingDirs((d) => new Set(d).add(fullPath))
      try {
        const res = await window.dockerDesktop.containerFsList({ containerId, path: fullPath })
        if (!res.ok) {
          await alertEngineError(alert, t, res.error)
          return
        }
        setChildrenCache((c) => new Map(c).set(fullPath, res.data.entries))
        setExpanded((e) => new Set(e).add(fullPath))
      } finally {
        setLoadingDirs((d) => {
          const n = new Set(d)
          n.delete(fullPath)
          return n
        })
      }
    },
    [alert, containerId],
  )

  const onSelect = useCallback((path: string, type: 'file' | 'directory') => {
    setSelected({ path, type })
  }, [])

  const onDownload = async () => {
    if (!selected) return
    setXfer({ k: 'busy', op: 'download' })
    const res = await window.dockerDesktop.containerFsDownload({ containerId, path: selected.path })
    if (!res.ok) {
      if (res.error === 'cancelled') setXfer({ k: 'idle' })
      else setXfer({ k: 'err', message: res.error })
      return
    }
    setXfer({ k: 'dl_ok', path: res.data.filePath })
  }

  const onUpload = async () => {
    setXfer({ k: 'busy', op: 'upload' })
    const res = await window.dockerDesktop.containerFsUpload({ containerId, destDir: targetDir })
    if (!res.ok) {
      if (res.error === 'cancelled') setXfer({ k: 'idle' })
      else setXfer({ k: 'err', message: res.error })
      return
    }
    setXfer({ k: 'up_ok', files: res.data.files })
    void reloadExpanded()
  }

  const copySavePath = async (fullPath: string) => {
    try {
      await navigator.clipboard.writeText(fullPath)
      setPathCopied(true)
    } catch {
      await alert(t('files.copyPathFailed'))
    }
  }

  const openSaveFolder = async (fullPath: string) => {
    const dir = parentFolderFs(fullPath)
    if (!dir) {
      await alert(t('files.openFolderFailed'))
      return
    }
    const r = await window.dockerDesktop.openPathInExplorer(dir)
    if (!r.ok) await alertEngineError(alert, t, r.error)
  }

  const onEdit = async () => {
    if (!selected || selected.type !== 'file') {
      await alert(t('files.pickFileToEdit'))
      return
    }
    const res = await window.dockerDesktop.containerFsReadFile({ containerId, path: selected.path })
    if (!res.ok) {
      await alertEngineError(alert, t, res.error)
      return
    }
    try {
      setEditPath(selected.path)
      setEditText(base64ToUtf8(res.data.base64))
      setEditOpen(true)
    } catch {
      await alert(t('files.binaryNotEditable'))
    }
  }

  const saveEdit = async () => {
    if (!editPath) return
    const res = await window.dockerDesktop.containerFsWriteFile({
      containerId,
      path: editPath,
      base64: utf8ToBase64(editText),
    })
    if (!res.ok) await alertEngineError(alert, t, res.error)
    else {
      setEditOpen(false)
      void reloadExpanded()
    }
  }

  const onDelete = async () => {
    if (!selected) return
    if (!(await confirm(t('files.removeConfirm', { path: selected.path })))) return
    const res = await window.dockerDesktop.containerFsRm({ containerId, path: selected.path })
    if (!res.ok) await alertEngineError(alert, t, res.error)
    else {
      setSelected(null)
      void reloadExpanded()
    }
  }

  const submitMkdir = async () => {
    const n = mkdirName.trim().replace(/^\//, '').replace(/\/+/g, '')
    if (!n) return
    const target = joinPath(targetDir, n)
    const res = await window.dockerDesktop.containerFsMkdir({ containerId, path: target })
    if (!res.ok) await alertEngineError(alert, t, res.error)
    else {
      setMkdirOpen(false)
      setMkdirName('')
      void reloadExpanded()
    }
  }

  const requestCloseMkdir = async () => {
    if (mkdirName.trim() && !(await confirm(t('files.discardMkdirInput')))) return
    setMkdirOpen(false)
    setMkdirName('')
  }

  useModalEscape(mkdirOpen, () => {
    void requestCloseMkdir()
  })
  useModalEscape(editOpen, () => setEditOpen(false))

  const rootEntries = childrenCache.get(rootPath)
  const rootLoading = loadingDirs.has(rootPath)
  const showTree = rootBootstrapped && rootEntries !== undefined

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
        <header className="shrink-0 border-b border-zinc-200/80 bg-zinc-100/90 px-3 py-1.5 dark:border-white/[0.06] dark:bg-zinc-900/90">
          <h1 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{label}</h1>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{containerId}</p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-2 pb-2 pt-1 dark:border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="font-mono text-zinc-600 dark:text-zinc-400" title={t('files.treeTargetHint')}>
              {t('files.treeTarget')}: {targetDir}
            </span>
            <button
              type="button"
              disabled={anyLoading}
              onClick={() => void reloadExpanded()}
              className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600"
            >
              {t('files.refresh')}
            </button>
            <button
              type="button"
              disabled={anyLoading}
              onClick={() => setMkdirOpen(true)}
              className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600"
            >
              {t('files.newFolder')}
            </button>
            <button
              type="button"
              disabled={anyLoading || xferBusy}
              onClick={() => void onUpload()}
              className="rounded border border-sky-500/60 px-2 py-0.5 text-sky-900 dark:text-sky-100 disabled:opacity-50"
            >
              {xferBusy && xfer.op === 'upload' ? t('files.uploading') : t('files.upload')}
            </button>
            <button
              type="button"
              disabled={!selected || anyLoading || xferBusy}
              onClick={() => void onDownload()}
              className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 disabled:opacity-50"
            >
              {xferBusy && xfer.op === 'download' ? t('files.downloading') : t('files.download')}
            </button>
            <button
              type="button"
              disabled={!selected || anyLoading}
              onClick={() => void onEdit()}
              className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600"
            >
              {t('files.edit')}
            </button>
            <button
              type="button"
              disabled={!selected || anyLoading}
              onClick={() => void onDelete()}
              className="rounded border border-rose-400/70 px-2 py-0.5 text-rose-900 dark:text-rose-100"
            >
              {t('files.delete')}
            </button>
          </div>

          {xfer.k !== 'idle' ? (
            <div
              role="status"
              className={`flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-snug ${
                xfer.k === 'err'
                  ? 'border-rose-300/80 bg-rose-50 text-rose-950 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100'
                  : xfer.k === 'busy'
                    ? 'border-amber-200/90 bg-amber-50 text-amber-950 dark:border-amber-500/35 dark:bg-amber-950/35 dark:text-amber-50'
                    : 'border-emerald-200/90 bg-emerald-50 text-emerald-950 dark:border-emerald-500/35 dark:bg-emerald-950/35 dark:text-emerald-50'
              }`}
            >
              {xfer.k === 'busy' ? (
                <span>{xfer.op === 'download' ? t('files.downloading') : t('files.uploading')}</span>
              ) : xfer.k === 'dl_ok' ? (
                <>
                  <span className="min-w-0 flex-1 font-mono">
                    {t('files.downloadDone', { name: basenameFs(xfer.path) })}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-emerald-600/30 px-1.5 py-0.5 hover:bg-emerald-100/80 dark:border-emerald-400/30 dark:hover:bg-emerald-900/50"
                    onClick={() => void copySavePath(xfer.path)}
                  >
                    {pathCopied ? t('files.pathCopied') : t('files.copySavePath')}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-emerald-600/30 px-1.5 py-0.5 hover:bg-emerald-100/80 dark:border-emerald-400/30 dark:hover:bg-emerald-900/50"
                    onClick={() => void openSaveFolder(xfer.path)}
                  >
                    {t('files.openContainingFolder')}
                  </button>
                </>
              ) : xfer.k === 'up_ok' ? (
                <span className="min-w-0 flex-1">
                  {t('files.uploadDone', {
                    count: xfer.files.length,
                    list: summarizeFileNames(xfer.files),
                  })}
                </span>
              ) : (
                <span className="min-w-0 flex-1 break-words">{xfer.message}</span>
              )}
              {xfer.k !== 'busy' ? (
                <button
                  type="button"
                  className="ml-auto shrink-0 rounded border border-zinc-400/40 px-1.5 py-0.5 text-zinc-800 hover:bg-black/5 dark:border-zinc-500/40 dark:text-zinc-100 dark:hover:bg-white/10"
                  onClick={() => setXfer({ k: 'idle' })}
                >
                  {t('files.xferDismiss')}
                </button>
              ) : null}
            </div>
          ) : null}

          <div
            className="min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-200/80 bg-white/70 dark:border-white/[0.06] dark:bg-zinc-900/50"
            role="tree"
          >
            <div className="h-full min-h-0 max-h-full overflow-auto overscroll-y-contain">
            {!showTree && rootLoading ? (
              <div className="p-3 text-[11px] text-zinc-500">{t('common.loading')}</div>
            ) : !showTree ? (
              <div className="p-3 text-[11px] text-zinc-500">{t('files.empty')}</div>
            ) : (
              <>
                <TreeListHeader t={t} indent={6} />
                <div
                  className={`flex min-w-[42rem] cursor-pointer items-center gap-1 border-b border-l-2 border-zinc-100 border-l-sky-500/35 py-1 text-[11px] font-semibold dark:border-zinc-800 ${
                    selected?.path === rootPath ? 'bg-sky-500/10 dark:bg-sky-500/15' : ''
                  }`}
                  style={{ paddingLeft: 6 }}
                  onClick={() => onSelect(rootPath, 'directory')}
                  onDoubleClick={(ev) => {
                    ev.preventDefault()
                    void toggleDirectory(rootPath)
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={expanded.has(rootPath)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      void toggleDirectory(rootPath)
                    }}
                  >
                    {rootLoading ? '…' : expanded.has(rootPath) ? '▾' : '▸'}
                  </button>
                  <span className="inline-flex shrink-0 items-center justify-center" aria-hidden>
                    <RowKindIcon kind="dir" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono font-semibold text-sky-900 dark:text-sky-100">{rootPath}</span>
                  <div className={STAT_GRID_CLASS}>
                    <span>{EM}</span>
                    <span className="text-right">{EM}</span>
                    <span>{EM}</span>
                    <span>{EM}</span>
                    <span className="text-right">{EM}</span>
                    <span>{EM}</span>
                  </div>
                </div>
                {expanded.has(rootPath) && rootEntries ? (
                  <TreeRows
                    parentPath={rootPath}
                    depth={0}
                    entries={rootEntries}
                    expanded={expanded}
                    loadingDirs={loadingDirs}
                    childrenCache={childrenCache}
                    selectedPath={selected?.path ?? null}
                    onSelect={onSelect}
                    onToggleDir={(p) => void toggleDirectory(p)}
                    t={t}
                    lng={lng}
                  />
                ) : null}
              </>
            )}
            </div>
          </div>
          <p className="text-[9px] leading-relaxed text-zinc-500 dark:text-zinc-500">{t('files.hint')}</p>
        </div>
      </div>

      {mkdirOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 className="mb-2 text-xs font-semibold">{t('files.newFolder')}</h2>
            <p className="mb-2 font-mono text-[10px] text-zinc-500">{targetDir}</p>
            <input
              value={mkdirName}
              onChange={(ev) => setMkdirName(ev.target.value)}
              placeholder={t('files.newFolderPlaceholder')}
              className="mb-2 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void requestCloseMkdir()}
                className="rounded border border-zinc-300 px-2 py-1 text-[10px] dark:border-zinc-600"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void submitMkdir()}
                className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
              <h2 className="truncate font-mono text-xs font-semibold">{editPath}</h2>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="shrink-0 rounded px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('common.close')}
              </button>
            </div>
            <textarea
              value={editText}
              onChange={(ev) => setEditText(ev.target.value)}
              className="min-h-[240px] flex-1 resize-none border-0 bg-zinc-50 p-3 font-mono text-[11px] text-zinc-900 focus:outline-none dark:bg-black/30 dark:text-zinc-100"
              spellCheck={false}
            />
            <div className="flex justify-end gap-2 border-t border-zinc-200 p-2 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded border border-zinc-300 px-2 py-1 text-[10px] dark:border-zinc-600"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                className="rounded bg-sky-600 px-2 py-1 text-[10px] font-semibold text-white"
              >
                {t('files.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
