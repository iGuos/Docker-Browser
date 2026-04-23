/** 主进程 → 渲染进程：docker CLI 执行过程中的文本块（与 requestId 配对） */
export type DockerCliProgressPayload = { requestId: string; text: string }
