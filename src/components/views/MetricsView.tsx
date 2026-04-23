import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostMetrics } from '@shared/hostMetrics'
import type { RunningContainersMemorySummary } from '@shared/dockerMemorySummary'
import { useDockerStore } from '@/stores/dockerStore'

const CARD =
  'rounded-xl border border-zinc-200/90 bg-white/95 p-4 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/70 dark:shadow-none'

const BTN_SECONDARY =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800'

const BTN_SKY =
  'rounded-md border border-sky-400 bg-white px-2.5 py-1.5 text-[11px] hover:bg-sky-50 disabled:pointer-events-none disabled:opacity-40 dark:border-sky-800 dark:bg-zinc-900 dark:hover:bg-sky-950/30'

const LS_AUTO = 'docker-browser.metrics.v1.autoRefresh'
const LS_INTERVAL = 'docker-browser.metrics.v1.intervalSec'

type IntervalSec = 2 | 5 | 10

function readStoredAuto(): boolean {
  try {
    const v = localStorage.getItem(LS_AUTO)
    if (v === '0' || v === 'false') return false
    if (v === '1' || v === 'true') return true
  } catch {
    /* ignore */
  }
  return true
}

function readStoredIntervalSec(): IntervalSec {
  try {
    const v = localStorage.getItem(LS_INTERVAL)
    const n = v ? Number(v) : NaN
    if (n === 2 || n === 5 || n === 10) return n
  } catch {
    /* ignore */
  }
  return 2
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

function formatUptime(sec: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const parts: string[] = []
  if (d > 0) parts.push(t('metrics.uptimePartDay', { n: d }))
  if (h > 0) parts.push(t('metrics.uptimePartHour', { n: h }))
  if (m > 0) parts.push(t('metrics.uptimePartMinute', { n: m }))
  if (s > 0 || parts.length === 0) parts.push(t('metrics.uptimePartSecond', { n: s }))
  return parts.join(' ')
}

function parseEngineResources(info: unknown): { ncpu: number | null; memTotal: number | null } {
  if (!info || typeof info !== 'object') return { ncpu: null, memTotal: null }
  const o = info as Record<string, unknown>
  const ncpu =
    typeof o.NCPU === 'number'
      ? o.NCPU
      : typeof o.CPUs === 'number'
        ? o.CPUs
        : typeof o.ncpu === 'number'
          ? o.ncpu
          : null
  const memTotal =
    typeof o.MemTotal === 'number'
      ? o.MemTotal
      : typeof o.TotalMemory === 'number'
        ? o.TotalMemory
        : typeof o.Memory === 'number'
          ? o.Memory
          : null
  return { ncpu, memTotal }
}

function parseDiskLayersSize(df: unknown): number | null {
  if (!df || typeof df !== 'object') return null
  const o = df as Record<string, unknown>
  if (typeof o.LayersSize === 'number' && Number.isFinite(o.LayersSize)) return o.LayersSize
  return null
}

function MeterBar({ value, ariaLabel }: { value: number; ariaLabel: string }) {
  const w = Math.min(100, Math.max(0, value))
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
      role="progressbar"
      aria-valuenow={w}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className="h-full rounded-full bg-sky-500 transition-[width] duration-300 dark:bg-sky-400"
        style={{ width: `${w}%` }}
      />
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-zinc-100 py-2 text-[11px] last:border-0 dark:border-zinc-800">
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="min-w-0 break-all text-right font-medium text-zinc-800 dark:text-zinc-100">{value}</span>
    </div>
  )
}

export function MetricsView() {
  const { t } = useTranslation()
  const connectionOk = useDockerStore((s) => s.connectionOk)
  const diskJson = useDockerStore((s) => s.diskJson)
  const metricsRefreshTick = useDockerStore((s) => s.metricsRefreshTick)
  const [host, setHost] = useState<HostMetrics | null>(null)
  const [hostErr, setHostErr] = useState<string | null>(null)
  const [engine, setEngine] = useState<{ ncpu: number | null; memTotal: number | null } | null>(null)
  const [engineErr, setEngineErr] = useState<string | null>(null)
  const [containersMem, setContainersMem] = useState<RunningContainersMemorySummary | null>(null)
  const [containersMemErr, setContainersMemErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(readStoredAuto)
  const [intervalSec, setIntervalSec] = useState<IntervalSec>(readStoredIntervalSec)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [docVisible, setDocVisible] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'visible',
  )
  const seqRef = useRef(0)

  const refreshMs = intervalSec * 1000
  const autoRefreshActive = autoRefresh && docVisible

  useEffect(() => {
    const onVis = () => setDocVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const setAutoRefreshPersist = (v: boolean) => {
    setAutoRefresh(v)
    try {
      localStorage.setItem(LS_AUTO, v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  const setIntervalSecPersist = (sec: IntervalSec) => {
    setIntervalSec(sec)
    try {
      localStorage.setItem(LS_INTERVAL, String(sec))
    } catch {
      /* ignore */
    }
  }

  const refreshAll = useCallback(
    async (opts?: { awaitContainerMem?: boolean }) => {
      const seq = ++seqRef.current
      const conn = connectionOk === true

      const hostP = window.dockerDesktop.getHostMetrics()
      const infoP = conn ? window.dockerDesktop.info() : Promise.resolve(null)

      const [hRes, infRes] = await Promise.all([hostP, infoP])
      if (seq !== seqRef.current) return

      if (hRes.ok) {
        setHost(hRes.data)
        setHostErr(null)
      } else {
        setHostErr(hRes.error)
      }

      if (conn && infRes) {
        if (infRes.ok) {
          setEngine(parseEngineResources(infRes.data))
          setEngineErr(null)
        } else {
          setEngine(null)
          setEngineErr(infRes.error)
        }
      } else {
        setEngine(null)
        setEngineErr(null)
      }

      setLastUpdated(Date.now())

      if (!conn) {
        setContainersMem(null)
        setContainersMemErr(null)
        return
      }

      const runSeq = seq
      const memP = window.dockerDesktop.runningContainersMemorySummary().then((memRes) => {
        if (runSeq !== seqRef.current) return
        if (memRes.ok) {
          setContainersMem(memRes.data)
          setContainersMemErr(null)
        } else {
          setContainersMem(null)
          setContainersMemErr(memRes.error)
        }
      })
      if (opts?.awaitContainerMem) await memP
    },
    [connectionOk],
  )

  useEffect(() => {
    void refreshAll()
  }, [refreshAll, metricsRefreshTick])

  useEffect(() => {
    if (!autoRefreshActive) return
    const id = window.setInterval(() => {
      void refreshAll()
    }, refreshMs)
    return () => window.clearInterval(id)
  }, [autoRefreshActive, refreshAll, refreshMs])

  const onManualRefresh = () => {
    setRefreshing(true)
    void refreshAll({ awaitContainerMem: true }).finally(() => setRefreshing(false))
  }

  const timeStr =
    lastUpdated != null
      ? new Date(lastUpdated).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '—'

  const usedMem = host ? host.memTotalBytes - host.memFreeBytes : 0
  const layersSize = parseDiskLayersSize(diskJson)
  const engineMemTotal = engine?.memTotal ?? null
  const dockerMemPct =
    containersMem != null && engineMemTotal != null && engineMemTotal > 0
      ? Math.min(100, Math.round((100 * containersMem.usedBytes) / engineMemTotal))
      : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <header className="shrink-0 space-y-1">
        <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{t('metrics.title')}</h1>
        <p className="max-w-2xl text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">{t('metrics.subtitle')}</p>
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN_SKY} disabled={refreshing} onClick={onManualRefresh}>
              {refreshing ? t('common.loading') : t('metrics.refresh')}
            </button>
            <button
              type="button"
              className={autoRefresh ? BTN_SKY : BTN_SECONDARY}
              onClick={() => setAutoRefreshPersist(!autoRefresh)}
              aria-pressed={autoRefresh}
            >
              {autoRefresh ? t('metrics.autoOn') : t('metrics.autoOff')}
            </button>
          </div>
          <label className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-600 dark:text-zinc-400">
            <span className="shrink-0">{t('metrics.intervalLabel')}</span>
            <select
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              value={intervalSec}
              onChange={(e) => setIntervalSecPersist(Number(e.target.value) as IntervalSec)}
              aria-label={t('metrics.intervalLabel')}
            >
              <option value={2}>{t('metrics.intervalOptionSec', { n: 2 })}</option>
              <option value={5}>{t('metrics.intervalOptionSec', { n: 5 })}</option>
              <option value={10}>{t('metrics.intervalOptionSec', { n: 10 })}</option>
            </select>
            <span className="text-zinc-400 dark:text-zinc-500">{t('metrics.lastUpdated', { time: timeStr })}</span>
          </label>
        </div>
        {autoRefresh && !docVisible ? (
          <p className="text-[10px] text-amber-800 dark:text-amber-200/90">{t('metrics.pausedHidden')}</p>
        ) : null}
      </header>

      {hostErr ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {t('metrics.hostError', { detail: hostErr })}
        </p>
      ) : null}

      <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t('metrics.samplingNote')}</p>

      <div className="grid min-h-0 shrink-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="metrics-host-heading">
          <h2 id="metrics-host-heading" className="mb-3 text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">
            {t('metrics.hostSection')}
          </h2>
          {!host ? (
            <p className="text-[11px] text-zinc-500">{t('common.loading')}</p>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-[10px] text-zinc-600 dark:text-zinc-400">
                  <span>{t('metrics.cpuUsage')}</span>
                  <span>{host.cpuUsagePercent}%</span>
                </div>
                <MeterBar value={host.cpuUsagePercent} ariaLabel={t('metrics.meterCpu', { pct: host.cpuUsagePercent })} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[10px] text-zinc-600 dark:text-zinc-400">
                  <span>{t('metrics.memUsage')}</span>
                  <span>
                    {t('metrics.memDetail', {
                      used: formatBytes(usedMem),
                      total: formatBytes(host.memTotalBytes),
                      pct: host.memUsedPercent,
                    })}
                  </span>
                </div>
                <MeterBar value={host.memUsedPercent} ariaLabel={t('metrics.meterMem', { pct: host.memUsedPercent })} />
              </div>
              <div className="pt-1">
                {host.loadavg ? (
                  <StatRow
                    label={t('metrics.loadavg')}
                    value={host.loadavg.map((x) => x.toFixed(2)).join(' / ')}
                  />
                ) : (
                  <StatRow label={t('metrics.loadavg')} value={t('metrics.loadavgNA')} />
                )}
                <StatRow label={t('metrics.uptimeHost')} value={formatUptime(host.uptimeSec, t)} />
                <StatRow label={t('metrics.hostname')} value={host.hostname} />
                <StatRow label={t('metrics.platform')} value={`${host.platform} (${host.arch})`} />
                <StatRow label={t('metrics.cores')} value={String(host.cpus)} />
                <StatRow label={t('metrics.model')} value={host.cpuModel} />
              </div>
            </div>
          )}
        </section>

        <section className={CARD} aria-labelledby="metrics-engine-heading">
          <h2 id="metrics-engine-heading" className="mb-3 text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">
            {t('metrics.engineSection')}
          </h2>
          {connectionOk !== true ? (
            <p className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[11px] text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              {t('metrics.engineUnavailable')}
            </p>
          ) : (
            <>
              {engineErr ? (
                <p className="mb-2 text-[11px] text-red-700 dark:text-red-300" role="alert">
                  {t('metrics.engineError', { detail: engineErr })}
                </p>
              ) : null}
              {!engine && !engineErr ? (
                <p className="text-[11px] text-zinc-500">{t('common.loading')}</p>
              ) : null}
              {engine ? (
                <div className="space-y-0">
                  <StatRow
                    label={t('metrics.engineNcpu')}
                    value={engine.ncpu != null ? String(engine.ncpu) : '—'}
                  />
                  <StatRow
                    label={t('metrics.engineMemory')}
                    value={engine.memTotal != null ? formatBytes(engine.memTotal) : '—'}
                  />
                  {layersSize != null ? (
                    <StatRow label={t('metrics.engineLayersSize')} value={formatBytes(layersSize)} />
                  ) : (
                    <p className="pt-2 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {t('metrics.engineDiskEmpty')}
                    </p>
                  )}
                </div>
              ) : null}

              {containersMemErr ? (
                <p className="mt-3 text-[11px] text-red-700 dark:text-red-300" role="alert">
                  {t('metrics.containersMemError', { detail: containersMemErr })}
                </p>
              ) : null}
              {containersMem ? (
                <div
                  className={`space-y-2 ${engine ? 'mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800' : 'mt-1'}`}
                >
                  <StatRow
                    label={t('metrics.engineContainersMem')}
                    value={t('metrics.engineContainersMemValue', {
                      used: formatBytes(containersMem.usedBytes),
                      n: containersMem.countedContainers,
                    })}
                  />
                  {dockerMemPct != null ? (
                    <div>
                      <div className="mb-1 flex justify-between text-[10px] text-zinc-600 dark:text-zinc-400">
                        <span>{t('metrics.engineContainersMemRatio')}</span>
                        <span>{dockerMemPct}%</span>
                      </div>
                      <MeterBar
                        value={dockerMemPct}
                        ariaLabel={t('metrics.meterDockerMem', { pct: dockerMemPct })}
                      />
                    </div>
                  ) : null}
                  <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {t('metrics.engineContainersMemFootnote')}
                  </p>
                  {containersMem.skippedContainers > 0 ? (
                    <p className="text-[10px] text-amber-800 dark:text-amber-200/90">
                      {t('metrics.engineContainersMemSkipped', { n: containersMem.skippedContainers })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
