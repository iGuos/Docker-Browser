/** 主进程 → 渲染进程：PTY 输出（含 ANSI） */
export type DockerExecPtyData = { subscriptionId: string; data: string }

/** 主进程 → 渲染进程：docker / shell 进程已退出 */
export type DockerExecPtyExit = {
  subscriptionId: string
  exitCode: number
  signal?: number
}
