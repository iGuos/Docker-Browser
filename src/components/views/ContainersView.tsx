import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { ContainerInspectModal } from '@/components/ContainerInspectModal'
import { CreateContainerModal } from '@/components/CreateContainerModal'
import { EditContainerConfigModal } from '@/components/EditContainerConfigModal'
import { EditContainerRuntimeModal } from '@/components/EditContainerRuntimeModal'
import { InspectJsonModal } from '@/components/InspectJsonModal'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { useDockerStore } from '@/stores/dockerStore'
import { unwrapIpc } from '@/lib/ipc'
import { alertEngineError, formatThrownEngineError } from '@/lib/alertMessage'
import { localizeContainerState, localizeContainerStatus } from '@/lib/containerDisplayI18n'
import type { ContainerPortRow } from '@/lib/containerPortsDisplay'
import { formatContainerPortsSummary } from '@/lib/containerPortsDisplay'
import {
  getComposeWorkingDirForGroup,
  groupContainersByComposeProject,
} from '@/lib/containerProjectGroup'
import {
  ALL_CONTAINER_COLS,
  loadColVisibility,
  saveColVisibility,
  loadColWidths,
  saveColWidths,
  MAX_COL_PX,
  MIN_COL_PX,
  type ContainerTableColId,
} from '@/lib/containerTablePreferences'
type Row = {
  Id: string
  Names?: string[]
  Image?: string
  State?: string
  Status?: string
  Ports?: ContainerPortRow[]
  Labels?: Record<string, string>
}

type SortKey = 'name' | 'id' | 'image' | 'ports' | 'state' | 'status' | 'memory' | 'health' | null

type FlatRow =
  | {
      kind: 'group'
      projectKey: string
      projectLabel: string
      count: number
      workdir: string | null
    }
  | { kind: 'container'; row: Row }

function shortId(id: string): string {
  return id.replace(/^sha256:/i, '').slice(0, 12)
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

function displayName(c: Row): string {
  const n = c.Names?.[0]
  if (n) return n.replace(/^\//, '')
  return shortId(c.Id)
}

function healthRank(status: string | undefined): number {
  const s = (status ?? '').toLowerCase()
  if (s.includes('(healthy)')) return 3
  if (s.includes('health: starting')) return 2
  if (s.includes('(unhealthy)')) return 1
  return 0
}

function healthLabel(
  status: string | undefined,
  t: (k: string) => string,
): { key: 'none' | 'healthy' | 'unhealthy' | 'starting'; text: string } {
  const s = (status ?? '').toLowerCase()
  if (s.includes('(healthy)')) return { key: 'healthy', text: t('containers.healthHealthy') }
  if (s.includes('(unhealthy)')) return { key: 'unhealthy', text: t('containers.healthUnhealthy') }
  if (s.includes('health: starting')) return { key: 'starting', text: t('containers.healthStarting') }
  return { key: 'none', text: '—' }
}

function sortRows(rows: Row[], key: SortKey, asc: boolean, memById: Record<string, number>): Row[] {
  if (!key) return rows
  const dir = asc ? 1 : -1
  const cmp = (a: Row, b: Row): number => {
    if (key === 'name') return dir * displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' })
    if (key === 'id') return dir * a.Id.localeCompare(b.Id)
    if (key === 'image')
      return dir * (a.Image ?? '').localeCompare(b.Image ?? '', undefined, { sensitivity: 'base' })
    if (key === 'ports')
      return dir *
        formatContainerPortsSummary(a.Ports).localeCompare(formatContainerPortsSummary(b.Ports), undefined, {
          sensitivity: 'base',
        })
    if (key === 'state')
      return dir * (a.State ?? '').localeCompare(b.State ?? '', undefined, { sensitivity: 'base' })
    if (key === 'status')
      return dir * (a.Status ?? '').localeCompare(b.Status ?? '', undefined, { sensitivity: 'base' })
    if (key === 'memory') {
      const av = isStrictRunning(a) ? (memById[a.Id] ?? -1) : -1
      const bv = isStrictRunning(b) ? (memById[b.Id] ?? -1) : -1
      if (av !== bv) return dir * (av - bv)
      return dir * displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' })
    }
    return dir * (healthRank(a.Status) - healthRank(b.Status))
  }
  return [...rows].sort(cmp)
}

function containerStateLower(c: Row | null | undefined): string {
  return (c?.State ?? '').toLowerCase()
}

/** 执行指令窗口、容器内文件、stats 快照等：仅「运行中」可用 */
function isStrictRunning(c: Row | null | undefined): boolean {
  if (!c) return false
  return containerStateLower(c) === 'running'
}

function canUseStart(c: Row | null | undefined): boolean {
  if (!c) return false
  const s = containerStateLower(c)
  return s !== 'running' && s !== 'restarting' && s !== 'paused' && s !== 'removing'
}

function canUseStop(c: Row | null | undefined): boolean {
  if (!c) return false
  const s = containerStateLower(c)
  return s === 'running' || s === 'restarting' || s === 'paused'
}

function canUseRestart(c: Row | null | undefined): boolean {
  if (!c) return false
  return containerStateLower(c) !== 'removing'
}

function canUseKill(c: Row | null | undefined): boolean {
  if (!c) return false
  const s = containerStateLower(c)
  return s === 'running' || s === 'restarting'
}

function canUsePause(c: Row | null | undefined): boolean {
  if (!c) return false
  return containerStateLower(c) === 'running'
}

function canUseUnpause(c: Row | null | undefined): boolean {
  if (!c) return false
  return containerStateLower(c) === 'paused'
}

const CTX_MENU_COUNT = 7

const BTN_DISABLED = 'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40'

export function ContainersView() {
  const { t, i18n } = useTranslation()
  const { alert, confirm } = useAppDialog()
  const [showCreate, setShowCreate] = useState(false)
  const [collapsedProjectKeys, setCollapsedProjectKeys] = useState<Set<string>>(() => new Set())
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  const ctxMenuIndexRef = useRef(0)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    containerId: string
    /** 行内 ⋯ 打开：居中对齐按钮并收紧与按钮的距离 */
    tight?: boolean
  } | null>(null)
  const [ctxMenuIndex, setCtxMenuIndex] = useState(0)
  const [runtimeConfigContainerId, setRuntimeConfigContainerId] = useState<string | null>(null)
  const [recreateConfigContainerId, setRecreateConfigContainerId] = useState<string | null>(null)
  const [inspectModal, setInspectModal] = useState<{ open: boolean; data: Record<string, unknown> | null }>({
    open: false,
    data: null,
  })
  const [statsModal, setStatsModal] = useState<{ open: boolean; title: string; text: string }>({
    open: false,
    title: '',
    text: '',
  })
  const [commitForId, setCommitForId] = useState<string | null>(null)
  const [commitRepo, setCommitRepo] = useState('my/snapshot')
  const [commitTag, setCommitTag] = useState('dev')
  const [bulkIds, setBulkIds] = useState<Set<string>>(() => new Set())
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [colVis, setColVis] = useState(loadColVisibility)
  const [colWidths, setColWidths] = useState(loadColWidths)
  const colWidthsRef = useRef(colWidths)
  colWidthsRef.current = colWidths
  const colResizeDrag = useRef<{ id: ContainerTableColId; startX: number; startW: number } | null>(null)
  const [memById, setMemById] = useState<Record<string, number>>({})
  const [colsMenuOpen, setColsMenuOpen] = useState(false)
  const colsMenuWrapRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedRowRef = useRef<HTMLDivElement | null>(null)
  const bulkHeaderCheckboxRef = useRef<HTMLInputElement>(null)

  const containers = useDockerStore((s) => s.containers) as Row[]
  const runningIdsSig = useMemo(() => {
    return containers
      .filter((c) => isStrictRunning(c))
      .map((c) => c.Id)
      .sort()
      .join('\0')
  }, [containers])
  const busy = useDockerStore((s) => s.busy)
  const selectedContainerId = useDockerStore((s) => s.selectedContainerId)
  const setSelectedContainerId = useDockerStore((s) => s.setSelectedContainerId)
  const afterMutation = useDockerStore((s) => s.afterMutation)

  const sel = containers.find((c) => c.Id === selectedContainerId) ?? null

  const ctxMenuRow = useMemo(
    () => (ctxMenu ? (containers.find((c) => c.Id === ctxMenu.containerId) ?? null) : null),
    [ctxMenu, containers],
  )
  const ctxMenuStrictRunning = isStrictRunning(ctxMenuRow)

  useEffect(() => {
    saveColVisibility(colVis)
  }, [colVis])

  useEffect(() => {
    saveColWidths(colWidths)
  }, [colWidths])

  useEffect(() => {
    if (!runningIdsSig) {
      setMemById({})
      return
    }
    const ids = runningIdsSig.split('\0')
    let cancelled = false
    void window.dockerDesktop.containersMemoryUsage(ids).then((res) => {
      if (cancelled || !res.ok) return
      setMemById(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [runningIdsSig])

  const grouped = useMemo(
    () => groupContainersByComposeProject(containers, t('containers.projectUngrouped')),
    [containers, t, i18n.language],
  )

  const sortedGrouped = useMemo(() => {
    if (!sortKey) return grouped
    return grouped.map((g) => ({
      ...g,
      items: sortRows(g.items, sortKey, sortAsc, memById),
    }))
  }, [grouped, sortKey, sortAsc, memById])

  const flatRows = useMemo((): FlatRow[] => {
    const out: FlatRow[] = []
    for (const g of sortedGrouped) {
      const workdir = getComposeWorkingDirForGroup(g.items)
      out.push({
        kind: 'group',
        projectKey: g.projectKey,
        projectLabel: g.projectLabel,
        count: g.items.length,
        workdir,
      })
      const open = !collapsedProjectKeys.has(g.projectKey)
      if (open) {
        for (const row of g.items) out.push({ kind: 'container', row })
      }
    }
    return out
  }, [sortedGrouped, collapsedProjectKeys])

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (flatRows[i]?.kind === 'group' ? 40 : 44),
    overscan: 12,
    measureElement:
      typeof window !== 'undefined' ? (el) => (el as HTMLElement).getBoundingClientRect().height : undefined,
  })

  const toggleProjectOpen = (projectKey: string) => {
    setCollapsedProjectKeys((prev) => {
      const next = new Set(prev)
      if (next.has(projectKey)) next.delete(projectKey)
      else next.add(projectKey)
      return next
    })
  }

  const toggleCol = (id: ContainerTableColId) => {
    setColVis((v) => {
      const next = { ...v, [id]: !v[id] }
      const visible = ALL_CONTAINER_COLS.filter((c) => next[c]).length
      if (visible === 0) return v
      return next
    })
  }

  useEffect(() => {
    if (!colsMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (colsMenuWrapRef.current?.contains(e.target as Node)) return
      setColsMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColsMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [colsMenuOpen])

  useEffect(() => {
    ctxMenuIndexRef.current = ctxMenuIndex
  }, [ctxMenuIndex])

  const toggleBulk = useCallback((id: string) => {
    setBulkIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const toggleGroupBulk = useCallback((items: Row[]) => {
    if (items.length === 0) return
    setBulkIds((prev) => {
      const n = new Set(prev)
      const allOn = items.every((c) => n.has(c.Id))
      if (allOn) for (const c of items) n.delete(c.Id)
      else for (const c of items) n.add(c.Id)
      return n
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setBulkIds((prev) => {
      if (containers.length === 0) return prev
      const allOn = containers.every((c) => prev.has(c.Id))
      if (allOn) return new Set()
      return new Set(containers.map((c) => c.Id))
    })
  }, [containers])

  const clearBulk = () => setBulkIds(new Set())

  const allBulkSelected = containers.length > 0 && containers.every((c) => bulkIds.has(c.Id))

  useEffect(() => {
    const el = bulkHeaderCheckboxRef.current
    if (!el) return
    el.indeterminate = bulkIds.size > 0 && !allBulkSelected
  }, [bulkIds, allBulkSelected])

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedContainerId, flatRows.length])

  const openComposeDir = async (path: string) => {
    const res = await window.dockerDesktop.openPathInExplorer(path)
    if (!res.ok) await alertEngineError(alert, t, res.error)
  }

  const openLogsWindow = useCallback((containerId: string) => {
    void window.dockerDesktop.openContainerLogsWindow(containerId).then(async (res) => {
      if (!res.ok) await alertEngineError(alert, t, res.error)
    })
  }, [alert, t])

  const openExecWindow = useCallback((containerId: string) => {
    void window.dockerDesktop.openContainerExecWindow(containerId).then(async (res) => {
      if (!res.ok) await alertEngineError(alert, t, res.error)
    })
  }, [alert, t])

  const openFilesWindow = useCallback((containerId: string) => {
    void window.dockerDesktop.openContainerFilesWindow(containerId, '/').then(async (res) => {
      if (!res.ok) await alertEngineError(alert, t, res.error)
    })
  }, [alert, t])

  const openInspect = useCallback(async (id: string) => {
    const res = await window.dockerDesktop.inspectContainer(id)
    if (!res.ok) {
      await alertEngineError(alert, t, res.error)
      return
    }
    setInspectModal({ open: true, data: res.data as Record<string, unknown> })
  }, [alert, t])

  const openStats = useCallback(async (id: string) => {
    const res = await window.dockerDesktop.containerStatsOnce(id)
    if (!res.ok) {
      await alertEngineError(alert, t, res.error)
      return
    }
    setStatsModal({
      open: true,
      title: t('containers.statsTitle'),
      text: JSON.stringify(res.data, null, 2),
    })
  }, [alert, t])

  const openContainerRowContextMenu = useCallback((e: ReactMouseEvent<HTMLButtonElement>, containerId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedContainerId(containerId)
    const btn = e.currentTarget as HTMLElement
    const r = btn.getBoundingClientRect()
    const menuW = 220
    // 7 行菜单约高（勿用过大的占位高度，否则「向上」时 y=r.top-300 会离按钮很远）
    const estMenuH = 232
    const pad = 4
    const overlap = 2
    // 水平：以 ⋯ 按钮中心为锚居中展开，避免宽菜单看起来离小按钮「橫向很远」
    const cx = r.left + r.width / 2
    let x = Math.round(cx - menuW / 2)
    if (x < pad) x = pad
    if (x + menuW > window.innerWidth - pad) x = window.innerWidth - menuW - pad
    // 垂直：下方时上沿与按钮下缘交叠 2px；改到「上方」时**下缘**与按钮**上**缘交叠 2px（与下方对称，避免悬在半空）
    let y = Math.floor(r.bottom) - overlap
    if (y + estMenuH > window.innerHeight - pad) {
      y = Math.floor(r.top) - estMenuH + overlap
    }
    y = Math.max(pad, y)
    setCtxMenu({ x, y, containerId, tight: true })
  }, [])

  useEffect(() => {
    if (!ctxMenu) return
    setCtxMenuIndex(0)
    ctxMenuIndexRef.current = 0
    let attached = false
    const onPointer = (e: PointerEvent) => {
      if (ctxMenuRef.current?.contains(e.target as Node)) return
      setCtxMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCtxMenu(null)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCtxMenuIndex((i) => {
          const n = Math.min(CTX_MENU_COUNT - 1, i + 1)
          ctxMenuIndexRef.current = n
          return n
        })
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCtxMenuIndex((i) => {
          const n = Math.max(0, i - 1)
          ctxMenuIndexRef.current = n
          return n
        })
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const id = ctxMenu.containerId
        const idx = ctxMenuIndexRef.current
        const row = containers.find((c) => c.Id === id)
        const strictRunning = isStrictRunning(row ?? null)
        if (idx === 0 && !strictRunning) return
        if (idx === 2 && !strictRunning) return
        if (idx === 6 && !strictRunning) return
        setCtxMenu(null)
        if (idx === 0) openExecWindow(id)
        else if (idx === 1) openLogsWindow(id)
        else if (idx === 2) openFilesWindow(id)
        else if (idx === 3) setRuntimeConfigContainerId(id)
        else if (idx === 4) setRecreateConfigContainerId(id)
        else if (idx === 5) void openInspect(id)
        else if (idx === 6) void openStats(id)
      }
    }
    const raf = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', onPointer, true)
      attached = true
    })
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      if (attached) document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [ctxMenu, containers, openExecWindow, openFilesWindow, openInspect, openLogsWindow, openStats])

  const exportTar = async (id: string) => {
    if (!(await confirm(t('containers.exportTarConfirm')))) return
    void run(async () => {
      const res = await window.dockerDesktop.exportContainerTar({ containerId: id })
      if (!res.ok) throw new Error(res.error)
    })
  }

  const submitCommit = () => {
    if (!commitForId) return
    const repo = commitRepo.trim()
    if (!repo) return
    void run(async () => {
      await unwrapIpc(
        window.dockerDesktop.commitContainer({
          containerId: commitForId,
          repo,
          tag: commitTag.trim() || 'latest',
        }),
      )
      setCommitForId(null)
    })
  }

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn()
      await afterMutation()
    } catch (e) {
      const text = formatThrownEngineError(t, e)
      if (text) await alert(text)
    }
  }

  const onRemove = async () => {
    if (!sel) return
    if (!(await confirm(t('containers.removeConfirm')))) return
    const running = (sel.State ?? '').toLowerCase() === 'running'
    void run(async () => {
      await unwrapIpc(
        window.dockerDesktop.removeContainer({
          id: sel.Id,
          force: running,
        }),
      )
      setSelectedContainerId(null)
      clearBulk()
    })
  }

  const onBatchRemove = async () => {
    if (bulkIds.size === 0) return
    if (!(await confirm(t('containers.batchRemoveConfirm', { count: bulkIds.size })))) return
    void run(async () => {
      for (const id of bulkIds) {
        const c = containers.find((x) => x.Id === id)
        const running = (c?.State ?? '').toLowerCase() === 'running'
        await unwrapIpc(window.dockerDesktop.removeContainer({ id, force: running }))
      }
      clearBulk()
      setSelectedContainerId(null)
    })
  }

  const onBatchStart = () => {
    if (bulkIds.size === 0) return
    void run(async () => {
      for (const id of bulkIds) {
        await unwrapIpc(window.dockerDesktop.startContainer(id))
      }
    })
  }

  const onBatchStop = () => {
    if (bulkIds.size === 0) return
    void run(async () => {
      for (const id of bulkIds) {
        await unwrapIpc(window.dockerDesktop.stopContainer(id))
      }
    })
  }

  const onHeaderSort = (key: Exclude<SortKey, null>) => {
    if (sortKey === key) setSortAsc((a) => !a)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const visibleCols = ALL_CONTAINER_COLS.filter((c) => colVis[c])
  /** 首列复选框 + 次列展开；数据列用 fr 按 colWidths 比例分配宽度，总宽始终贴满容器，避免横向滚动条 */
  const gridTemplate = `28px 22px ${visibleCols.map((id) => `minmax(0, ${colWidths[id]}fr)`).join(' ')} 2.25rem 2rem`

  /** 仅改变 `id` 对应列的 `colWidths[id]`，其它列宽度不变（在 window 上跟指针，避免表头/sticky 丢事件） */
  const startColResize = useCallback((id: ContainerTableColId, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const pointerId = e.pointerId
    const startX = e.clientX
    const startW = colWidthsRef.current[id]
    colResizeDrag.current = { id, startX, startW }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const d = colResizeDrag.current
      if (!d) return
      const nw = Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, d.startW + ev.clientX - d.startX))
      setColWidths((w) => (w[d.id] === nw ? w : { ...w, [d.id]: nw }))
    }
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      colResizeDrag.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }, [])

  const renderHeaderCell = (id: ContainerTableColId, label: string) => {
    if (!colVis[id]) return null
    const active = sortKey === id
    return (
      <div
        key={id}
        className="relative z-0 flex min-w-0 overflow-visible border-b border-zinc-200 dark:border-zinc-800"
      >
        <button
          type="button"
          onClick={() => onHeaderSort(id)}
          className={`relative z-0 min-w-0 flex-1 truncate py-2 pl-1.5 pr-5 text-left text-[11px] font-medium hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 ${
            active ? 'text-sky-700 dark:text-sky-300' : ''
          }`}
        >
          {label}
          {active ? (sortAsc ? ' ↑' : ' ↓') : ''}
        </button>
        {/* 拖条必须完全落在本格内；先前 -translate-x-1/2 会伸进右邻格，邻格叠在上面导致无法命中 */}
        <div
          className="absolute right-0 top-0 z-20 h-full w-3 shrink-0 cursor-col-resize touch-none select-none hover:bg-sky-500/25 dark:hover:bg-sky-400/20"
          title={t('containers.colResizeHint')}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('containers.colResizeAria', { column: label })}
          onPointerDown={(ev) => startColResize(id, ev)}
        />
      </div>
    )
  }

  const renderDataCells = (c: Row) => {
    const active = c.Id === selectedContainerId
    const portsText = formatContainerPortsSummary(c.Ports)
    const h = healthLabel(c.Status, t)
    const cells: ReactNode[] = []
    if (colVis.name)
      cells.push(
        <div key="n" className="flex min-w-0 items-start gap-1 px-1.5 py-1 font-medium">
          <span className="inline-block w-2 shrink-0 self-stretch border-l-2 border-sky-500/35" aria-hidden />
          <span className="min-w-0 flex-1 cursor-text select-text break-words" title={displayName(c)}>
            {displayName(c)}
          </span>
        </div>,
      )
    if (colVis.id)
      cells.push(
        <div key="i" className="flex items-center gap-0.5 px-1.5 py-1 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
          <span className="truncate" title={c.Id}>
            {shortId(c.Id)}
          </span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            title={t('containers.copyIdTitle')}
            aria-label={t('containers.copyIdTitle')}
            onClick={(e) => {
              e.stopPropagation()
              void navigator.clipboard.writeText(c.Id).catch(() => void alert(t('containers.copyIdFailed')))
            }}
          >
            ⧉
          </button>
        </div>,
      )
    if (colVis.image)
      cells.push(
        <div
          key="im"
          className="min-w-0 cursor-text select-text break-words px-1.5 py-1 text-zinc-700 dark:text-zinc-300"
          title={c.Image ?? ''}
        >
          {c.Image ?? '—'}
        </div>,
      )
    if (colVis.ports)
      cells.push(
        <div
          key="p"
          className="max-h-10 overflow-hidden whitespace-pre-line px-1.5 py-1 font-mono text-[10px] leading-tight"
          title={portsText || t('containers.portsNone')}
        >
          {portsText || '—'}
        </div>,
      )
    if (colVis.state)
      cells.push(
        <div key="st" className="px-1.5 py-1" title={c.State ?? undefined}>
          {localizeContainerState(c.State, t)}
        </div>,
      )
    if (colVis.status)
      cells.push(
        <div key="su" className="truncate px-1.5 py-1 text-zinc-600 dark:text-zinc-400" title={c.Status ?? undefined}>
          {localizeContainerStatus(c.Status, t, i18n.resolvedLanguage ?? i18n.language)}
        </div>,
      )
    if (colVis.memory)
      cells.push(
        <div
          key="mem"
          className="whitespace-nowrap px-1.5 py-1 font-mono text-[10px] text-zinc-700 tabular-nums dark:text-zinc-300"
          title={
            isStrictRunning(c) && memById[c.Id] != null ? `${formatBytes(memById[c.Id])} · ${t('containers.memColHint')}` : undefined
          }
        >
          {isStrictRunning(c) && memById[c.Id] != null ? formatBytes(memById[c.Id]) : '—'}
        </div>,
      )
    if (colVis.health)
      cells.push(
        <div
          key="h"
          className={`truncate px-1.5 py-1 text-[11px] ${
            h.key === 'healthy'
              ? 'text-emerald-700 dark:text-emerald-300'
              : h.key === 'unhealthy'
                ? 'text-rose-700 dark:text-rose-300'
                : h.key === 'starting'
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-zinc-500'
          }`}
        >
          {h.text}
        </div>,
      )
    return (
      <div
        key={c.Id}
        ref={active ? selectedRowRef : undefined}
        role="row"
        onClick={() => {
          const sel = typeof window !== 'undefined' ? (window.getSelection()?.toString() ?? '') : ''
          if (sel.length > 0) return
          setSelectedContainerId(c.Id)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setSelectedContainerId(c.Id)
          setCtxMenu({ x: e.clientX, y: e.clientY, containerId: c.Id })
        }}
        className={`grid w-full min-w-0 cursor-pointer items-center border-b border-zinc-100 text-[11px] hover:bg-sky-500/5 dark:border-zinc-800/80 dark:hover:bg-sky-500/10 ${
          active ? 'bg-sky-500/10 dark:bg-sky-500/15' : ''
        }`}
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="flex items-center justify-center px-0.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={bulkIds.has(c.Id)}
            onChange={() => toggleBulk(c.Id)}
            aria-label={t('containers.bulkSelect')}
          />
        </div>
        <div className="min-w-0" aria-hidden />
        {cells}
        <div className="min-w-0 border-b border-zinc-100 dark:border-zinc-800/80" aria-hidden />
        <div
          className="relative flex items-center justify-center border-b border-zinc-100 py-0.5 dark:border-zinc-800/80"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-base leading-none text-zinc-500 hover:bg-zinc-200/80 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title={t('containers.rowContextMenu')}
            aria-label={t('containers.rowContextMenu')}
            aria-haspopup="menu"
            onClick={(e) => openContainerRowContextMenu(e, c.Id)}
          >
            ⋯
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <ContainerInspectModal
        open={inspectModal.open}
        title={t('containers.inspect')}
        data={inspectModal.data}
        onClose={() => setInspectModal({ open: false, data: null })}
      />
      <InspectJsonModal
        open={statsModal.open}
        title={statsModal.title}
        jsonText={statsModal.text}
        onClose={() => setStatsModal({ open: false, title: '', text: '' })}
      />
      <CreateContainerModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => void afterMutation()}
      />
      <EditContainerRuntimeModal
        open={runtimeConfigContainerId !== null}
        containerId={runtimeConfigContainerId ?? ''}
        onClose={() => setRuntimeConfigContainerId(null)}
        onSaved={() => void afterMutation()}
      />
      <EditContainerConfigModal
        open={recreateConfigContainerId !== null}
        containerId={recreateConfigContainerId ?? ''}
        onClose={() => setRecreateConfigContainerId(null)}
        onRecreated={(newId) => {
          setSelectedContainerId(newId)
          void afterMutation()
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="text-sm font-semibold">{t('containers.title')}</h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowCreate(true)}
            className="shrink-0 rounded-md border border-emerald-600 bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40 dark:border-emerald-500"
            title={t('containers.createRun')}
          >
            {t('containers.addContainer')}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!sel || busy || !canUseStart(sel)}
            title={sel && !busy && !canUseStart(sel) ? t('containers.hintStartDisabled') : undefined}
            onClick={() => sel && void run(async () => unwrapIpc(window.dockerDesktop.startContainer(sel.Id)))}
            className={`rounded-md bg-zinc-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white ${BTN_DISABLED}`}
          >
            {t('containers.start')}
          </button>
          <button
            type="button"
            disabled={!sel || busy || !canUseStop(sel)}
            title={sel && !busy && !canUseStop(sel) ? t('containers.hintStopDisabled') : undefined}
            onClick={() => sel && void run(async () => unwrapIpc(window.dockerDesktop.stopContainer(sel.Id)))}
            className={`rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${BTN_DISABLED}`}
          >
            {t('containers.stop')}
          </button>
          <button
            type="button"
            disabled={!sel || busy || !canUseRestart(sel)}
            onClick={() => sel && void run(async () => unwrapIpc(window.dockerDesktop.restartContainer(sel.Id)))}
            className={`rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${BTN_DISABLED}`}
          >
            {t('containers.restart')}
          </button>
          <button
            type="button"
            disabled={!sel || busy || !canUseKill(sel)}
            title={sel && !busy && !canUseKill(sel) ? t('containers.hintKillPauseDisabled') : undefined}
            onClick={() => sel && void run(async () => unwrapIpc(window.dockerDesktop.killContainer(sel.Id)))}
            className={`rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-900 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100 dark:hover:bg-rose-950/60 ${BTN_DISABLED}`}
          >
            {t('containers.kill')}
          </button>
          <button
            type="button"
            disabled={!sel || busy || !canUsePause(sel)}
            title={sel && !busy && !canUsePause(sel) ? t('containers.hintPauseDisabled') : undefined}
            onClick={() => sel && void run(async () => unwrapIpc(window.dockerDesktop.pauseContainer(sel.Id)))}
            className={`rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${BTN_DISABLED}`}
          >
            {t('containers.pause')}
          </button>
          <button
            type="button"
            disabled={!sel || busy || !canUseUnpause(sel)}
            title={sel && !busy && !canUseUnpause(sel) ? t('containers.hintUnpauseDisabled') : undefined}
            onClick={() => sel && void run(async () => unwrapIpc(window.dockerDesktop.unpauseContainer(sel.Id)))}
            className={`rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${BTN_DISABLED}`}
          >
            {t('containers.unpause')}
          </button>
          <button
            type="button"
            disabled={!sel || busy || containerStateLower(sel) === 'removing'}
            onClick={() => void onRemove()}
            className={`rounded-md border border-rose-400 px-2 py-1 text-[11px] text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-950/30 ${BTN_DISABLED}`}
          >
            {t('containers.remove')}
          </button>
        </div>
      </div>

      {bulkIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-2 py-1.5 text-[11px] dark:border-amber-900/50 dark:bg-amber-950/30">
          <span className="font-medium text-amber-950 dark:text-amber-100">
            {t('containers.bulkBar', { count: bulkIds.size })}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onBatchStart()}
            className="rounded border border-zinc-300 bg-white px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-900"
          >
            {t('containers.bulkStart')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onBatchStop()}
            className="rounded border border-zinc-300 bg-white px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-900"
          >
            {t('containers.bulkStop')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onBatchRemove()}
            className="rounded border border-rose-400 bg-white px-2 py-0.5 text-rose-800 dark:border-rose-700 dark:bg-zinc-900 dark:text-rose-200"
          >
            {t('containers.bulkRemove')}
          </button>
          <button type="button" onClick={() => clearBulk()} className="text-[10px] text-zinc-600 underline dark:text-zinc-400">
            {t('containers.bulkClear')}
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto rounded-lg border border-zinc-200/80 dark:border-white/[0.06]"
      >
        <div
          className="sticky top-0 z-20 grid w-full min-w-0 border-b border-zinc-200 bg-zinc-100/95 text-zinc-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-400"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div
            className="flex items-center justify-center border-b border-zinc-200 py-2 dark:border-zinc-800"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={bulkHeaderCheckboxRef}
              type="checkbox"
              disabled={containers.length === 0}
              checked={allBulkSelected}
              onChange={() => toggleSelectAll()}
              title={t('containers.bulkSelectAll')}
              aria-label={t('containers.bulkSelectAll')}
            />
          </div>
          <div className="border-b border-zinc-200 py-2 dark:border-zinc-800" aria-hidden />
          {renderHeaderCell('name', t('common.name'))}
          {renderHeaderCell('id', t('common.id'))}
          {renderHeaderCell('image', t('common.image'))}
          {renderHeaderCell('ports', t('containers.portsColumnTitle'))}
          {renderHeaderCell('state', t('common.state'))}
          {renderHeaderCell('status', t('common.status'))}
          {renderHeaderCell('memory', t('containers.col_memory'))}
          {renderHeaderCell('health', t('containers.healthCol'))}
          <div className="border-b border-zinc-200 dark:border-zinc-800" aria-hidden />
          <div
            ref={colsMenuWrapRef}
            className="relative flex items-center justify-center border-b border-zinc-200 py-1 dark:border-zinc-800"
          >
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-base leading-none text-zinc-500 hover:bg-zinc-200/80 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-expanded={colsMenuOpen}
              aria-haspopup="true"
              title={t('containers.columnsMenu')}
              aria-label={t('containers.columnsMenu')}
              onClick={() => setColsMenuOpen((o) => !o)}
            >
              ⋯
            </button>
            {colsMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-0.5 min-w-[11rem] rounded-md border border-zinc-200 bg-white py-1.5 text-[11px] shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {ALL_CONTAINER_COLS.map((id) => (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-2 px-2.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <input type="checkbox" checked={colVis[id]} onChange={() => toggleCol(id)} />
                    <span>{t(`containers.col_${id}`)}</span>
                  </label>
                ))}
                <div className="mt-1 border-t border-zinc-100 px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  {t('containers.columns')}
                </div>
                <p className="px-2.5 pb-1 text-[9px] leading-snug text-zinc-400 dark:text-zinc-500">
                  {t('containers.virtualHint')}
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <div
          className="relative w-full min-w-0"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
          }}
        >
          {virtualizer.getVirtualItems().map((v) => {
            const fr = flatRows[v.index]
            if (!fr) return null
            if (fr.kind === 'group') {
              const open = !collapsedProjectKeys.has(fr.projectKey)
              const groupItems = sortedGrouped.find((x) => x.projectKey === fr.projectKey)?.items ?? []
              const allInGroup = groupItems.length > 0 && groupItems.every((c) => bulkIds.has(c.Id))
              return (
                <div
                  key={`g-${fr.projectKey}`}
                  ref={virtualizer.measureElement}
                  data-index={v.index}
                  role="row"
                  className="absolute left-0 right-0 top-0 grid w-full items-center border-b border-zinc-200 bg-zinc-200/90 text-[12px] font-semibold dark:border-zinc-700 dark:bg-zinc-800/90"
                  style={{
                    transform: `translateY(${v.start}px)`,
                    gridTemplateColumns: gridTemplate,
                  }}
                >
                  <div className="flex items-center justify-center px-0.5" onMouseDown={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      ref={(el) => {
                        if (!el || groupItems.length === 0) return
                        const n = groupItems.filter((c) => bulkIds.has(c.Id)).length
                        el.indeterminate = n > 0 && n < groupItems.length
                      }}
                      checked={allInGroup}
                      onChange={() => toggleGroupBulk(groupItems)}
                      title={t('containers.selectGroup')}
                      aria-label={t('containers.selectGroup')}
                    />
                  </div>
                  <div className="flex items-center justify-center px-0.5" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-400/60 bg-white/80 text-[11px] dark:border-zinc-600 dark:bg-zinc-900/80"
                      aria-expanded={open}
                      title={open ? t('containers.treeCollapseHint', { name: fr.projectLabel }) : t('containers.treeExpandHint', { name: fr.projectLabel })}
                      aria-label={open ? t('containers.treeCollapseHint', { name: fr.projectLabel }) : t('containers.treeExpandHint', { name: fr.projectLabel })}
                      onClick={() => toggleProjectOpen(fr.projectKey)}
                    >
                      {open ? '▼' : '▶'}
                    </button>
                  </div>
                  <div className="flex min-h-0 min-w-0 items-center gap-2 px-2 py-1.5" style={{ gridColumn: '3 / -3' }}>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 truncate text-left font-semibold"
                      onClick={() => toggleProjectOpen(fr.projectKey)}
                    >
                      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{t('containers.projectGroup')}</span>
                      <span className="truncate font-mono text-zinc-900 dark:text-zinc-50">{fr.projectLabel}</span>
                      <span className="shrink-0 font-normal text-zinc-500">({fr.count})</span>
                    </button>
                    {fr.workdir ? (
                      <button
                        type="button"
                        className="shrink-0 rounded border border-sky-400/60 px-1.5 py-0.5 text-[11px] font-normal text-sky-900 dark:border-sky-800 dark:text-sky-100"
                        title={fr.workdir}
                        onClick={() => void openComposeDir(fr.workdir!)}
                      >
                        {t('containers.openComposeDir')}
                      </button>
                    ) : null}
                  </div>
                  <div className="min-w-0 border-b border-zinc-200 dark:border-zinc-700" aria-hidden />
                  <div className="min-w-0" aria-hidden />
                </div>
              )
            }
            return (
              <div
                key={fr.row.Id}
                ref={virtualizer.measureElement}
                data-index={v.index}
                style={{
                  transform: `translateY(${v.start}px)`,
                }}
                className="absolute left-0 right-0 top-0 w-full"
              >
                {renderDataCells(fr.row)}
              </div>
            )
          })}
        </div>
      </div>

      {sel ? (
        <div
          className="shrink-0 rounded-lg border border-zinc-200/80 bg-white/60 p-3 dark:border-white/[0.06] dark:bg-zinc-900/40"
          onContextMenu={(e) => {
            e.preventDefault()
            setCtxMenu({ x: e.clientX, y: e.clientY, containerId: sel.Id })
          }}
        >
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void exportTar(sel.Id)}
              className="rounded-md border border-zinc-300 px-2 py-1 text-[10px] dark:border-zinc-600"
            >
              {t('containers.exportTar')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setCommitForId(sel.Id)}
              className="rounded-md border border-emerald-400 px-2 py-1 text-[10px] text-emerald-900 dark:border-emerald-800 dark:text-emerald-100"
            >
              {t('containers.commitImage')}
            </button>
          </div>
          {commitForId === sel.Id ? (
            <div className="mb-3 rounded-md border border-amber-200/80 bg-amber-50/80 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="mb-2 text-[10px] font-semibold text-amber-950 dark:text-amber-100">
                {t('containers.commitImage')}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-0.5 text-[10px]">
                  <span className="text-zinc-600 dark:text-zinc-400">{t('containers.commitRepo')}</span>
                  <input
                    value={commitRepo}
                    onChange={(e) => setCommitRepo(e.target.value)}
                    className="w-44 rounded border border-zinc-300 bg-white px-2 py-1 font-mono dark:border-zinc-600 dark:bg-zinc-950"
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[10px]">
                  <span className="text-zinc-600 dark:text-zinc-400">{t('containers.commitTag')}</span>
                  <input
                    value={commitTag}
                    onChange={(e) => setCommitTag(e.target.value)}
                    className="w-28 rounded border border-zinc-300 bg-white px-2 py-1 font-mono dark:border-zinc-600 dark:bg-zinc-950"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !commitRepo.trim()}
                  onClick={() => void submitCommit()}
                  className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-40"
                >
                  {t('common.confirm')}
                </button>
                <button
                  type="button"
                  onClick={() => setCommitForId(null)}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-[10px] dark:border-zinc-600"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {ctxMenu ? (
        <div
          ref={ctxMenuRef}
          role="menu"
          className={`fixed z-[100] min-w-[11rem] rounded-md border border-zinc-200 bg-white py-1 text-[11px] shadow-lg dark:border-zinc-600 dark:bg-zinc-900 ${
            ctxMenu.tight ? '-translate-y-px' : ''
          }`}
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!ctxMenuStrictRunning}
            title={!ctxMenuStrictRunning ? t('containers.hintNeedsRunning') : undefined}
            className={`block w-full px-3 py-2 text-left enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800 ${ctxMenuIndex === 0 ? 'bg-zinc-100 dark:bg-zinc-800' : ''} ${BTN_DISABLED}`}
            onMouseEnter={() => {
              ctxMenuIndexRef.current = 0
              setCtxMenuIndex(0)
            }}
            onClick={() => {
              if (!ctxMenuStrictRunning) return
              openExecWindow(ctxMenu.containerId)
              setCtxMenu(null)
            }}
          >
            {t('containers.contextExec')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`block w-full px-3 py-2 text-left enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800 ${ctxMenuIndex === 1 ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
            onMouseEnter={() => {
              ctxMenuIndexRef.current = 1
              setCtxMenuIndex(1)
            }}
            onClick={() => {
              openLogsWindow(ctxMenu.containerId)
              setCtxMenu(null)
            }}
          >
            {t('logs.title')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!ctxMenuStrictRunning}
            title={!ctxMenuStrictRunning ? t('containers.hintNeedsRunning') : undefined}
            className={`block w-full px-3 py-2 text-left enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800 ${ctxMenuIndex === 2 ? 'bg-zinc-100 dark:bg-zinc-800' : ''} ${BTN_DISABLED}`}
            onMouseEnter={() => {
              ctxMenuIndexRef.current = 2
              setCtxMenuIndex(2)
            }}
            onClick={() => {
              if (!ctxMenuStrictRunning) return
              openFilesWindow(ctxMenu.containerId)
              setCtxMenu(null)
            }}
          >
            {t('files.title')}
          </button>
          <button
            type="button"
            role="menuitem"
            title={t('containers.contextConfigInPlaceHint')}
            className={`block w-full px-3 py-2 text-left enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800 ${ctxMenuIndex === 3 ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
            onMouseEnter={() => {
              ctxMenuIndexRef.current = 3
              setCtxMenuIndex(3)
            }}
            onClick={() => {
              setRuntimeConfigContainerId(ctxMenu.containerId)
              setCtxMenu(null)
            }}
          >
            {t('containers.contextConfigInPlace')}
          </button>
          <button
            type="button"
            role="menuitem"
            title={t('containers.contextConfigRecreateHint')}
            className={`block w-full px-3 py-2 text-left enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800 ${ctxMenuIndex === 4 ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
            onMouseEnter={() => {
              ctxMenuIndexRef.current = 4
              setCtxMenuIndex(4)
            }}
            onClick={() => {
              setRecreateConfigContainerId(ctxMenu.containerId)
              setCtxMenu(null)
            }}
          >
            {t('containers.contextConfigRecreate')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`block w-full px-3 py-2 text-left enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800 ${ctxMenuIndex === 5 ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
            onMouseEnter={() => {
              ctxMenuIndexRef.current = 5
              setCtxMenuIndex(5)
            }}
            onClick={() => {
              void openInspect(ctxMenu.containerId)
              setCtxMenu(null)
            }}
          >
            {t('containers.inspect')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!ctxMenuStrictRunning}
            title={!ctxMenuStrictRunning ? t('containers.hintNeedsRunning') : undefined}
            className={`block w-full px-3 py-2 text-left enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800 ${ctxMenuIndex === 6 ? 'bg-zinc-100 dark:bg-zinc-800' : ''} ${BTN_DISABLED}`}
            onMouseEnter={() => {
              ctxMenuIndexRef.current = 6
              setCtxMenuIndex(6)
            }}
            onClick={() => {
              if (!ctxMenuStrictRunning) return
              void openStats(ctxMenu.containerId)
              setCtxMenu(null)
            }}
          >
            {t('containers.statsOnce')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
