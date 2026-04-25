/**
 * 将 package.json 的 version 设为 Git tag 对应的 semver（去掉前导 v）。
 * - CI：依赖环境变量 GITHUB_REF_NAME（Actions 在 tag 推送时为 v0.1.0）
 * - 本地：node scripts/sync-version-from-tag.mjs v0.1.0
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = path.join(root, 'package.json')

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
  console.error(`sync-version-from-tag: 非法版本 "${input}"，请使用 v1 / v1.2 / v1.2.3（可含 -rc.1 / +build）`)
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.version = version
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`sync-version-from-tag: package.json version -> ${version}`)
