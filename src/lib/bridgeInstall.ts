// 副作用模块：在 main.tsx 最先 import，确保 window.dockerDesktop/appTheme/appLocale
// 在 i18n、ThemeProvider 等模块求值前就绪（它们启动时会读取 window.appLocale/appTheme）。
import { installTauriBridge, isTauri } from '@/lib/backendBridge'

if (isTauri()) {
  installTauriBridge()
}
