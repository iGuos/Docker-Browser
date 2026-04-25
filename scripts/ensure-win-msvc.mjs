/**
 * Windows：在 electron-rebuild（node-pty）前检测是否已安装 MSVC（VC++ 工具集）。
 * 未安装时给出明确指引并退出 1，避免只看到冗长的 node-gyp 堆栈。
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

if (process.platform !== 'win32') {
  process.exit(0)
}

const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
const vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')

const hint = `
----------------------------------------------------------------------
Docker-Browser：本机缺少用于编译 node-pty 的 Visual Studio C++ 工具链
----------------------------------------------------------------------

electron-rebuild 需要 MSVC（与 node-gyp 相同）。请任选其一：

【方式 A】图形界面安装（推荐）
  1. 打开：https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/
  2. 安装「生成工具」，在工作负载中勾选「使用 C++ 的桌面开发」
  3. 安装完成后重新打开终端，再执行：pnpm dist

【方式 B】命令行（PowerShell，需 winget；可能弹出 UAC）
  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

若已安装但仍报错：在「Visual Studio Installer」里点「修改」，确认已勾选上述 C++ 工作负载。

不在本机打包时，可使用 GitHub Actions Release 产物（已含正确重编的 node-pty）。
----------------------------------------------------------------------
`

if (!existsSync(vswhere)) {
  console.error(hint)
  process.exit(1)
}

const r = spawnSync(
  vswhere,
  [
    '-latest',
    '-products',
    '*',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property',
    'installationPath',
  ],
  { encoding: 'utf8' },
)

const installPath = (r.stdout || '').trim()
if (r.status !== 0 || !installPath) {
  console.error(hint)
  console.error(
    '（检测到 vswhere，但未找到 VC++ x64 工具组件 Microsoft.VisualStudio.Component.VC.Tools.x86.x64。请在 Installer 中补充安装。）\n',
  )
  process.exit(1)
}

console.log(`[ensure-win-msvc] VC++ 工具链: ${installPath}`)
