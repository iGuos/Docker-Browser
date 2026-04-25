import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { builtinModules, createRequire } from 'node:module'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = path.join(root, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

const defaultAsarPath = path.join(root, 'release', pkg.version, 'win-unpacked', 'resources', 'app.asar')
const asarPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultAsarPath

if (!process.argv[2] && process.platform !== 'win32') {
  console.log('[verify-packaged-modules] skip on non-win32 without explicit asar path')
  process.exit(0)
}

if (!fs.existsSync(asarPath)) {
  console.error(`[verify-packaged-modules] app.asar not found: ${asarPath}`)
  process.exit(1)
}

const pinnedModules = ['dockerode', 'node-pty', 'electron-updater']

function normalizePackageName(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null
  if (/^[A-Za-z]:[\\/]/.test(specifier)) return null
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return scope && name ? `${scope}/${name}` : null
  }
  return specifier.split('/')[0] || null
}

function extractExternalModulesFromMainBundle() {
  const mainBundle = path.join(root, 'dist-electron', 'main', 'index.js')
  if (!fs.existsSync(mainBundle)) return []

  const code = fs.readFileSync(mainBundle, 'utf8')
  const specifiers = new Set()
  const patterns = [
    /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    let m
    while ((m = pattern.exec(code)) !== null) {
      const name = normalizePackageName(m[1])
      if (name) specifiers.add(name)
    }
  }
  return [...specifiers]
}

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => m.replace(/^node:/, ''))])
const runtimeProvidedModules = new Set(['electron'])
const autoModules = extractExternalModulesFromMainBundle().filter((m) => !builtins.has(m) && !runtimeProvidedModules.has(m))
const requiredModules = [...new Set([...autoModules, ...pinnedModules])].sort()
const req = createRequire(import.meta.url)
const electronCli = req.resolve('electron/cli.js')
const nodeBin = process.execPath

if (!fs.existsSync(electronCli)) {
  console.error(`[verify-packaged-modules] electron cli not found: ${electronCli}`)
  process.exit(1)
}

const probeCode = `
const path = require('node:path')
const { createRequire } = require('node:module')
const asarPath = process.argv[1]
const modules = JSON.parse(process.argv[2])
const entry = path.join(asarPath, 'dist-electron', 'main', 'index.js')
const req = createRequire(entry)

for (const mod of modules) {
  const resolved = req.resolve(mod)
  const isBuiltin = resolved === mod
  if (!isBuiltin && !resolved.startsWith(asarPath + path.sep)) {
    throw new Error(\`resolved outside app.asar: \${mod} -> \${resolved}\`)
  }
  req(mod)
  console.log(\`\${mod}=>\${resolved}\`)
}
`

const run = spawnSync(nodeBin, [electronCli, '-e', probeCode, asarPath, JSON.stringify(requiredModules)], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})

if (run.status !== 0) {
  const details = `${run.stdout || ''}\n${run.stderr || ''}`.trim()
  console.error('[verify-packaged-modules] verification failed')
  if (details) console.error(details)
  process.exit(run.status ?? 1)
}

for (const line of (run.stdout || '').split(/\r?\n/)) {
  if (!line.trim()) continue
  const [mod, resolved] = line.split('=>')
  if (!mod || !resolved) continue
  console.log(`[verify-packaged-modules] ok: ${mod} -> ${resolved}`)
}

console.log('\n[verify-packaged-modules] all required modules are resolvable in app.asar')
