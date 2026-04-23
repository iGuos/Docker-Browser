/** 运行中容器内存汇总（单次 stats 快照之和）。 */
export type RunningContainersMemorySummary = {
  /** 各容器 memory_stats.usage 之和（无法读取的容器不计入） */
  usedBytes: number
  /** 成功读到 usage 的运行中容器数 */
  countedContainers: number
  /** stats 失败或缺少 usage 的运行中容器数 */
  skippedContainers: number
}
