/**
 * 将 Git tag 对应的 semver 同步到三处版本字段：
 *   - package.json
 *   - src-tauri/Cargo.toml
 *   - src-tauri/tauri.conf.json
 *
 * 用法：
 *   - CI：依赖环境变量 GITHUB_REF_NAME（Actions 在 tag 推送时为 v0.1.0）
 *   - 本地：node scripts/sync-version-from-tag.mjs v0.1.0
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = path.join(root, 'package.json')
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml')
const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json')

const raw = process.env.GITHUB_REF_NAME?.trim() || process.argv[2]?.trim()
if (!raw) {
  console.error(
    'sync-version-from-tag: 请设置 GITHUB_REF_NAME，或传入 tag，例如：node scripts/sync-version-from-tag.mjs v0.1.0',
  )
  process.exit(1)
}

const input = raw.startsWith('v') ? raw.slice(1) : raw
if (!input) {
  console.error('sync-version-from-tag: 空版本')
  process.exit(1)
}

/** 允许 v1 / v1.2 / v1.2.3，并规范化为合法 semver。 */
function normalizeSemver(v) {
  const s = v.trim()
  if (/^\d+$/.test(s)) return `${s}.0.0`
  if (/^\d+\.\d+$/.test(s)) return `${s}.0`
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(s)) return s
  return null
}

const version = normalizeSemver(input)
if (!version) {
  console.error(`sync-version-from-tag: 非法版本 "${input}"`)
  process.exit(1)
}

// 1. package.json
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.version = version
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`package.json -> ${version}`)

// 2. src-tauri/Cargo.toml  ([package] 块中的 version 字段，只替换首处)
const cargo = fs.readFileSync(cargoPath, 'utf8')
const newCargo = cargo.replace(
  /(\[package\][^\[]*?\nversion\s*=\s*)"[^"]*"/,
  `$1"${version}"`,
)
if (newCargo === cargo) {
  console.error('sync-version-from-tag: 未在 Cargo.toml 中找到 [package].version')
  process.exit(1)
}
fs.writeFileSync(cargoPath, newCargo)
console.log(`src-tauri/Cargo.toml -> ${version}`)

// 3. src-tauri/tauri.conf.json
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'))
tauriConf.version = version
fs.writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`)
console.log(`src-tauri/tauri.conf.json -> ${version}`)
