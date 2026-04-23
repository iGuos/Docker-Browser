import { create } from 'zustand'
import { unwrapIpc } from '@/lib/ipc'

export type TabId = 'containers' | 'images' | 'networks' | 'volumes' | 'metrics' | 'system' | 'events'

type DockerState = {
  tab: TabId
  setTab: (t: TabId) => void
  /** 顶栏/F5 在资源页触发刷新时递增，供 MetricsView 订阅 */
  metricsRefreshTick: number
  bumpMetricsRefresh: () => void
  connectionOk: boolean | null
  globalError: string | null
  busy: boolean
  containers: unknown[]
  images: unknown[]
  networks: unknown[]
  volumeList: unknown[]
  systemInfo: unknown | null
  versionJson: unknown | null
  diskJson: unknown | null
  selectedContainerId: string | null
  setSelectedContainerId: (id: string | null) => void
  selectedImageRef: string | null
  setSelectedImageRef: (id: string | null) => void
  selectedNetworkId: string | null
  setSelectedNetworkId: (id: string | null) => void
  selectedVolumeName: string | null
  setSelectedVolumeName: (n: string | null) => void
  ping: () => Promise<void>
  loadTab: (t: TabId) => Promise<void>
  afterMutation: () => Promise<void>
}

export const useDockerStore = create<DockerState>((set, get) => ({
  tab: 'containers',
  setTab: (t) => {
    set({ tab: t })
    void get().loadTab(t)
  },
  metricsRefreshTick: 0,
  bumpMetricsRefresh: () => set((s) => ({ metricsRefreshTick: s.metricsRefreshTick + 1 })),
  connectionOk: null,
  globalError: null,
  busy: false,
  containers: [],
  images: [],
  networks: [],
  volumeList: [],
  systemInfo: null,
  versionJson: null,
  diskJson: null,
  selectedContainerId: null,
  setSelectedContainerId: (id) => set({ selectedContainerId: id }),
  selectedImageRef: null,
  setSelectedImageRef: (id) => set({ selectedImageRef: id }),
  selectedNetworkId: null,
  setSelectedNetworkId: (id) => set({ selectedNetworkId: id }),
  selectedVolumeName: null,
  setSelectedVolumeName: (n) => set({ selectedVolumeName: n }),

  ping: async () => {
    set({ globalError: null })
    try {
      await unwrapIpc(window.dockerDesktop.ping())
      set({ connectionOk: true })
    } catch (e) {
      set({
        connectionOk: false,
        globalError: e instanceof Error ? e.message : String(e),
      })
    }
  },

  loadTab: async (t) => {
    const dk = window.dockerDesktop
    set({ busy: true, globalError: null })
    try {
      if (t === 'metrics') {
        await get().ping()
      } else if (get().connectionOk !== true) {
        await get().ping()
        if (get().connectionOk !== true) return
      }
      if (t === 'containers') {
        const list = await unwrapIpc(dk.listContainers({ all: true }))
        set({ containers: list })
      } else if (t === 'images') {
        const list = await unwrapIpc(dk.listImages())
        set({ images: list })
      } else if (t === 'networks') {
        const [list, ctr] = await Promise.all([
          unwrapIpc(dk.listNetworks()),
          unwrapIpc(dk.listContainers({ all: true })),
        ])
        set({ networks: list, containers: ctr })
      } else if (t === 'volumes') {
        const res = (await unwrapIpc(dk.listVolumes())) as { Volumes?: unknown[] }
        set({ volumeList: res.Volumes ?? [] })
      } else if (t === 'system') {
        const [info, ver, df] = await Promise.all([
          unwrapIpc(dk.info()),
          unwrapIpc(dk.version()),
          unwrapIpc(dk.df()),
        ])
        set({ systemInfo: info, versionJson: ver, diskJson: df })
      } else if (t === 'metrics') {
        /* 资源页：主机指标由 IPC 拉取；引擎信息在页面内按需请求 */
      } else if (t === 'events') {
        /* 事件页数据由订阅流推送，此处仅确保连接可用 */
      }
    } catch (e) {
      set({
        globalError: e instanceof Error ? e.message : String(e),
        connectionOk: false,
      })
    } finally {
      set({ busy: false })
    }
  },

  afterMutation: async () => {
    const { tab, loadTab, ping } = get()
    await ping()
    await loadTab(tab)
  },
}))
