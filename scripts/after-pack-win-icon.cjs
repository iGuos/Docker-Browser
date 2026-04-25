/**
 * signAndEditExecutable=false 时，electron-builder 不会给主 exe 写入图标/版本资源。
 * 这里在 afterPack 阶段用 rcedit 手动修正主程序 exe，避免安装后仍显示默认图标。
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

module.exports = async function afterPackWinIcon(context) {
  if (context.electronPlatformName !== 'win32') return

  const repoRoot = path.join(__dirname, '..')
  const iconPath = path.resolve(repoRoot, 'build', 'icon.ico')
  if (!fs.existsSync(iconPath)) {
    console.warn('[after-pack-win-icon] Missing build/icon.ico, skip')
    return
  }

  const appInfo = context.packager.appInfo
  const name = appInfo.productFilename
  const exePath = path.resolve(context.appOutDir, `${name}.exe`)
  if (!fs.existsSync(exePath)) {
    console.warn('[after-pack-win-icon] Exe not found:', exePath)
    return
  }

  const rceditBin = path.join(repoRoot, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')
  if (!fs.existsSync(rceditBin)) {
    throw new Error(`[after-pack-win-icon] Missing ${rceditBin}`)
  }

  const fileVer = appInfo.shortVersion || appInfo.buildVersion || '0.0.0'
  let productVer = fileVer
  try {
    if (typeof appInfo.getVersionInWeirdWindowsForm === 'function') {
      productVer = appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm()
    }
  } catch {
    /* ignore */
  }

  const internal = path.basename(name, '.exe')
  const args = [
    exePath,
    '--set-version-string',
    'FileDescription',
    appInfo.productName,
    '--set-version-string',
    'ProductName',
    appInfo.productName,
    '--set-version-string',
    'LegalCopyright',
    appInfo.copyright || '',
    '--set-file-version',
    fileVer,
    '--set-product-version',
    productVer,
    '--set-version-string',
    'InternalName',
    internal,
    '--set-version-string',
    'OriginalFilename',
    '',
    '--set-icon',
    iconPath,
  ]

  execFileSync(rceditBin, args, { stdio: 'inherit' })
  console.log('[after-pack-win-icon] Patched exe resources:', exePath)
}
