/**
 * Windows：从 public/icon.png 生成 build/icon.ico，供 NSIS / exe 嵌入（多尺寸 .ico 比单 PNG 转换更稳）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pngPath = path.join(root, 'public', 'icon.png')
const buildDir = path.join(root, 'build')
const icoPath = path.join(buildDir, 'icon.ico')

if (!fs.existsSync(pngPath)) {
  console.error(`gen-icon-ico: missing ${pngPath}`)
  process.exit(1)
}

fs.mkdirSync(buildDir, { recursive: true })
const buf = await pngToIco(fs.readFileSync(pngPath))
fs.writeFileSync(icoPath, buf)
console.log(`gen-icon-ico: wrote ${icoPath}`)
