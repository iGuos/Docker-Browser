/** 主进程采集的本机资源快照（Electron 所在机器，非容器内）。 */
export type HostMetrics = {
  hostname: string
  platform: string
  arch: string
  uptimeSec: number
  cpus: number
  cpuModel: string
  /** 约 100ms 采样窗口内估算的全局 CPU 占用 0–100 */
  cpuUsagePercent: number
  memTotalBytes: number
  memFreeBytes: number
  /** 基于 free/total 的已用比例 0–100 */
  memUsedPercent: number
  /** 非 Unix 为 null */
  loadavg: [number, number, number] | null
}
