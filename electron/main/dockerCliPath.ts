import path from 'node:path'

/** Docker Desktop for Mac 自带的 CLI（不依赖 PATH） */
export const DOCKER_DESKTOP_MAC_CLI = '/Applications/Docker.app/Contents/Resources/bin/docker'

/**
 * 从 Finder / Dock / 安装包启动的 GUI 进程在 macOS 上常见 PATH 过短，找不到 Homebrew / Docker Desktop 的 `docker`。
 * 将这些目录前置到 PATH，便于子进程解析 `docker`。
 */
function dockerCliPathPrefixes(): string[] {
  if (process.platform === 'win32') return []
  if (process.platform === 'darwin') {
    return [
      path.dirname(DOCKER_DESKTOP_MAC_CLI),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ]
  }
  return ['/usr/local/bin', '/snap/bin']
}

export function envWithDockerCliInPath(): NodeJS.ProcessEnv {
  const prefixes = dockerCliPathPrefixes()
  if (prefixes.length === 0) return { ...process.env }
  const extra = prefixes.join(path.delimiter)
  const cur = process.env.PATH ?? ''
  const PATH = cur ? `${extra}${path.delimiter}${cur}` : extra
  return { ...process.env, PATH }
}
