import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const CLI_LOG_MAX = 16000

function emitProgress(onProgress: ((chunk: string) => void) | undefined, chunk: string): void {
  if (!onProgress || !chunk) return
  try {
    onProgress(chunk)
  } catch {
    /* 渲染进程可能已关闭 */
  }
}

/** 单行 shell 命令（如 docker run …），流式输出；返回 stdout */
function runShellCommand(
  command: string,
  opts: { cwd: string; onProgress?: (chunk: string) => void },
): Promise<string> {
  const { cwd, onProgress } = opts
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdoutAcc = ''
    const emitChunk = (b: Buffer) => {
      const t = b.toString('utf8')
      if (t.length > CLI_LOG_MAX) emitProgress(onProgress, `${t.slice(0, CLI_LOG_MAX)}…\n`)
      else emitProgress(onProgress, t)
    }
    child.stdout?.on('data', (b: Buffer) => {
      stdoutAcc += b.toString('utf8')
      emitChunk(b)
    })
    child.stderr?.on('data', (b: Buffer) => {
      const t = b.toString('utf8')
      stderr += t
      emitChunk(b)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdoutAcc.trim())
      else reject(new Error(stderr.trim() || `Process exited with code ${code}`))
    })
  })
}

/** docker 子进程，参数化 argv，流式输出；返回 stdout */
function runDockerArgv(
  argv: string[],
  opts: { cwd?: string; onProgress?: (chunk: string) => void },
): Promise<string> {
  const { cwd, onProgress } = opts
  return new Promise((resolve, reject) => {
    const child = spawn('docker', argv, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdoutAcc = ''
    const emitChunk = (b: Buffer) => {
      const t = b.toString('utf8')
      if (t.length > CLI_LOG_MAX) emitProgress(onProgress, `${t.slice(0, CLI_LOG_MAX)}…\n`)
      else emitProgress(onProgress, t)
    }
    child.stdout?.on('data', (b: Buffer) => {
      stdoutAcc += b.toString('utf8')
      emitChunk(b)
    })
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
      emitChunk(b)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdoutAcc.trim())
      else reject(new Error(stderr.trim() || `docker exited with code ${code}`))
    })
  })
}

/** 主进程 cwd 下的二级目录，供 shell 执行 docker run 时使用，避免落在仓库/安装目录根下 */
const CLI_WORKDIR_PARTS = ['docker-browser', 'cli-workdir'] as const

async function resolveDockerCliExecCwd(): Promise<string> {
  const base = process.cwd()
  const dir = path.join(base, ...CLI_WORKDIR_PARTS)
  try {
    await fs.mkdir(dir, { recursive: true })
    return dir
  } catch {
    return base
  }
}

/** 折叠换行与反斜杠续行，便于校验与执行 */
export function normalizeDockerCliInput(raw: string): string {
  return raw
    .trim()
    .replace(/\\\r?\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseDockerRunContainerName(line: string): string | undefined {
  const s = normalizeDockerCliInput(line)
  const m = /--name(?:=|\s+)([^\s]+)/i.exec(s)
  return m?.[1]
}

export function assertDockerRunCommand(line: string): string {
  const s = normalizeDockerCliInput(line)
  if (!s) throw new Error('Command is empty.')
  if (!/^docker\s+run(\s|$)/i.test(s)) throw new Error('Command must start with docker run.')
  return s
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 是否后台运行（含 -d、-dit、--detach 等） */
function isDetachedDockerRun(normalized: string): boolean {
  const s = normalizeDockerCliInput(normalized)
  const m = /^docker\s+run\s+/i.exec(s)
  if (!m) return false
  const rest = s.slice(m[0].length)
  const tokens = rest.split(/\s+/).filter(Boolean)
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i] ?? ''
    if (!tok.startsWith('-')) break
    if (tok === '--') break
    if (tok.startsWith('--')) {
      if (/^--detach$/i.test(tok)) return true
      i += 1
      continue
    }
    if (tok.slice(1).includes('d')) return true
    i += 1
  }
  return false
}

function parseContainerIdFromDockerRunStdout(out: string): string | undefined {
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (/^[0-9a-f]{64}$/i.test(line)) return line
    if (/^[0-9a-f]{12,63}$/i.test(line)) return line
  }
  return undefined
}

/** detach 成功后轮询 inspect，确认容器处于 Running */
async function assertContainerRunning(nameOrId: string, onProgress?: (chunk: string) => void): Promise<void> {
  const maxAttempts = 80
  const delayMs = 250
  emitProgress(onProgress, `\n$ docker inspect (wait until running) ${nameOrId}\n`)
  for (let j = 0; j < maxAttempts; j++) {
    try {
      const { stdout } = await execFileAsync('docker', ['inspect', '-f', '{{.State.Running}}', nameOrId], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      })
      if (stdout.trim().toLowerCase() === 'true') {
        emitProgress(onProgress, 'State.Running=true OK\n')
        return
      }
    } catch {
      /* 容器尚未可 inspect 时重试 */
    }
    await sleep(delayMs)
  }
  let detail = 'inspect timeout'
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['inspect', '-f', '{{.State.Status}} exit={{.State.ExitCode}}', nameOrId],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    detail = stdout.trim() || detail
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e)
  }
  throw new Error(`Container did not reach running state (${detail}).`)
}

/** 镜像标签：仅允许常见安全字符（供 execFile 传参，避免 shell） */
export function assertSafeImageTag(raw: string): string {
  const t = raw.trim()
  if (!t) throw new Error('Image tag is required.')
  if (t.length > 200) throw new Error('Image tag is too long.')
  if (!/^[\w./-]+(:[\w.-]+)?$/i.test(t)) {
    throw new Error('Invalid image tag. Use letters, digits, ._-/ and optional :tag.')
  }
  return t
}

/** 由镜像名生成合法容器名（与 docker run --name 规则一致） */
export function containerNameFromImageTag(tag: string): string {
  const base = (tag.includes('/') ? tag.split('/').pop() : tag) ?? 'app'
  const noColon = base.includes(':') ? base.slice(0, base.indexOf(':')) : base
  let n = noColon.replace(/[^a-zA-Z0-9_.-]/g, '-')
  if (!n.length) n = 'app'
  if (!/^[a-zA-Z0-9]/.test(n)) n = `a${n}`
  return n.slice(0, 120)
}

/**
 * 在本机 shell 执行整行 docker run（不自动删除同名容器，与手动在终端执行一致）。
 * onProgress 收到引擎 stdout/stderr 片段（含 docker pull 进度）。
 */
export async function createAndRestartFromDockerRunCli(
  line: string,
  onProgress?: (chunk: string) => void,
): Promise<void> {
  const normalized = assertDockerRunCommand(line)
  const name = parseDockerRunContainerName(normalized)
  const cwd = await resolveDockerCliExecCwd()
  emitProgress(onProgress, `$ ${normalized}\n\n`)
  const runOut = await runShellCommand(normalized, { cwd, onProgress })
  if (isDetachedDockerRun(normalized)) {
    const ref = name ?? parseContainerIdFromDockerRunStdout(runOut)
    if (!ref) {
      throw new Error(
        'Detached docker run finished but cannot verify: add --name <name> or ensure the engine prints the container ID on stdout.',
      )
    }
    await assertContainerRunning(ref, onProgress)
  }
}

export async function buildAndRunFromDockerfile(
  dockerfile: string,
  imageTag: string,
  onProgress?: (chunk: string) => void,
): Promise<void> {
  const tag = assertSafeImageTag(imageTag)
  const df = dockerfile.trim()
  if (!df) throw new Error('Dockerfile is empty.')

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dbrowser-df-'))
  try {
    await fs.writeFile(path.join(tmp, 'Dockerfile'), df, 'utf8')
    emitProgress(onProgress, `$ docker build -t ${tag} .\n(workdir: temp)\n\n`)
    await runDockerArgv(['build', '-t', tag, '.'], { cwd: tmp, onProgress })
    emitProgress(onProgress, '\n')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }

  const cname = containerNameFromImageTag(tag)

  emitProgress(onProgress, `$ docker run -d --name ${cname} ${tag}\n\n`)
  await runDockerArgv(['run', '-d', '--name', cname, tag], { onProgress })
  await assertContainerRunning(cname, onProgress)
}

/** Compose 项目名（传给 `docker compose -p`），空则省略 */
export function normalizeOptionalComposeProjectName(raw: string | undefined): string | undefined {
  const t = (raw ?? '').trim()
  if (!t) return undefined
  if (t.length > 200) throw new Error('Project name is too long.')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(t)) {
    throw new Error('Invalid project name. Use letters, digits, ._- and start with a letter or digit.')
  }
  return t
}

/**
 * 将 Compose 文件写入临时目录后执行 `docker compose up -d`（流式输出）。
 * 仅含单文件 compose；含 build.context 时若上下文不在该目录可能失败，与 Dockerfile 页同理。
 */
export async function composeUpFromYaml(
  composeYaml: string,
  projectNameRaw: string | undefined,
  onProgress?: (chunk: string) => void,
): Promise<void> {
  const yml = composeYaml.trim()
  if (!yml) throw new Error('Compose file is empty.')
  const project = normalizeOptionalComposeProjectName(projectNameRaw)

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dbrowser-compose-'))
  try {
    await fs.writeFile(path.join(tmp, 'compose.yaml'), yml, 'utf8')
    const argv = project
      ? ['compose', '-p', project, '-f', 'compose.yaml', 'up', '-d']
      : ['compose', '-f', 'compose.yaml', 'up', '-d']
    emitProgress(onProgress, `$ docker ${argv.join(' ')}\n(workdir: temp)\n\n`)
    await runDockerArgv(argv, { cwd: tmp, onProgress })
    emitProgress(onProgress, '\n')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
