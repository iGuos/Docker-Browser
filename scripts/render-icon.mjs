/**
 * Rasterize public/favicon.svg → public/icon.png (512×512) for Electron / PWA.
 * Run after editing the SVG: pnpm run icon:render
 */
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const svgPath = path.join(root, 'public', 'favicon.svg')
const outPath = path.join(root, 'public', 'icon.png')

const buf = readFileSync(svgPath)
await sharp(buf).resize(512, 512, { fit: 'fill' }).png({ compressionLevel: 9 }).toFile(outPath)
console.log('Wrote', outPath)
