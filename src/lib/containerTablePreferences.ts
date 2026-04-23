const LS_KEY = 'docker-browser:containers-table-cols'
const LS_WIDTHS_KEY = 'docker-browser:containers-col-widths'

export const MIN_COL_PX = 48
export const MAX_COL_PX = 720

export const DEFAULT_COL_WIDTHS: Record<ContainerTableColId, number> = {
  name: 140,
  id: 96,
  image: 200,
  ports: 160,
  state: 80,
  status: 180,
  memory: 96,
  health: 88,
}

export type ContainerTableColId = 'name' | 'id' | 'image' | 'ports' | 'state' | 'status' | 'memory' | 'health'

export const ALL_CONTAINER_COLS: ContainerTableColId[] = [
  'name',
  'id',
  'image',
  'ports',
  'state',
  'status',
  'memory',
  'health',
]

const DEFAULT_VISIBLE: Record<ContainerTableColId, boolean> = {
  name: true,
  id: true,
  image: true,
  ports: true,
  state: true,
  status: true,
  memory: true,
  health: false,
}

export function loadColVisibility(): Record<ContainerTableColId, boolean> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { ...DEFAULT_VISIBLE }
    const o = JSON.parse(raw) as Record<string, boolean>
    const out = { ...DEFAULT_VISIBLE }
    for (const id of ALL_CONTAINER_COLS) {
      if (typeof o[id] === 'boolean') out[id] = o[id]
    }
    return out
  } catch {
    return { ...DEFAULT_VISIBLE }
  }
}

export function saveColVisibility(v: Record<ContainerTableColId, boolean>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

function clampColWidth(n: number): number {
  if (!Number.isFinite(n)) return MIN_COL_PX
  return Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Math.round(n)))
}

export function loadColWidths(): Record<ContainerTableColId, number> {
  try {
    const raw = localStorage.getItem(LS_WIDTHS_KEY)
    if (!raw) return { ...DEFAULT_COL_WIDTHS }
    const o = JSON.parse(raw) as Record<string, unknown>
    const out = { ...DEFAULT_COL_WIDTHS }
    for (const id of ALL_CONTAINER_COLS) {
      const n = o[id]
      if (typeof n === 'number' && Number.isFinite(n)) out[id] = clampColWidth(n)
    }
    return out
  } catch {
    return { ...DEFAULT_COL_WIDTHS }
  }
}

export function saveColWidths(w: Record<ContainerTableColId, number>): void {
  try {
    const o: Record<string, number> = {}
    for (const id of ALL_CONTAINER_COLS) o[id] = clampColWidth(w[id])
    localStorage.setItem(LS_WIDTHS_KEY, JSON.stringify(o))
  } catch {
    /* ignore */
  }
}
