import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 纯前端 Vite 配置；桌面外壳由 Tauri（src-tauri/）提供。
// 固定端口 1420 与 src-tauri/tauri.conf.json 的 devUrl 对齐，strictPort 避免漂移导致白屏。
export default defineConfig(() => {
  return {
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src'),
        '@shared': path.join(__dirname, 'shared'),
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      host: '127.0.0.1',
    },
    clearScreen: false,
  }
})
