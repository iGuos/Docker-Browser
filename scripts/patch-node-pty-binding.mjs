import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  path.join(root, 'node_modules', 'node-pty', 'binding.gyp'),
  path.join(root, 'node_modules', 'node-pty', 'deps', 'winpty', 'src', 'winpty.gyp'),
]

const before = "'SpectreMitigation': 'Spectre'"
let patchedCount = 0

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.warn(`[patch-node-pty-binding] missing: ${file}`)
    continue
  }
  const text = fs.readFileSync(file, 'utf8')
  if (!text.includes(before)) continue
  const next = text.split(before).join("'SpectreMitigation': 'false'")
  fs.writeFileSync(file, next, 'utf8')
  patchedCount += 1
  console.log(`[patch-node-pty-binding] patched: ${file}`)
}

if (patchedCount === 0) {
  console.log('[patch-node-pty-binding] SpectreMitigation already patched or not present')
}
