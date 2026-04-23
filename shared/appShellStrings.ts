import type { AppLanguage } from './locale'

export const DOCKER_BROWSER_REPOSITORY_URL = 'https://github.com/unicorngithub/Docker-Browser'

export function interpolateTemplate(template: string, vars: Record<string, string>): string {
  let s = template
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{{${k}}}`).join(v)
  }
  return s
}

export type AppShellStrings = {
  file: string
  closeWindow: string
  /** 退出应用（Windows / Linux 文件菜单；macOS 应用菜单） */
  quit: string
  edit: string
  undo: string
  redo: string
  cut: string
  copy: string
  paste: string
  view: string
  reload: string
  actualSize: string
  zoomIn: string
  zoomOut: string
  toggleFullscreen: string
  settings: string
  appearance: string
  themeLight: string
  themeDark: string
  themeSystem: string
  languageLabel: string
  languageEnglish: string
  languageZhCN: string
  window: string
  minimize: string
  zoom: string
  bringAllToFront: string
  help: string
  menuCheckForUpdates: string
  menuRestartToInstall: string
  dockerEngineDocs: string
  helpOpenSourceRepository: string
  aboutAppMenu: string
  macHideOthers: string
  macShowAll: string
  macAboutApp: string
  macHideApp: string
  aboutPanelCopyright: string
  aboutDialogTitle: string
  /** 关于对话框正文（纯文本，支持 {{version}}、{{repoUrl}}） */
  aboutDialogBodyPlain: string
  dialogOk: string
}

const ZH: AppShellStrings = {
  file: '文件',
  closeWindow: '关闭窗口',
  quit: '退出 Docker Browser',
  edit: '编辑',
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  view: '显示',
  reload: '刷新界面',
  actualSize: '实际大小',
  zoomIn: '放大',
  zoomOut: '缩小',
  toggleFullscreen: '全屏',
  settings: '设置',
  appearance: '外观',
  themeLight: '浅色',
  themeDark: '深色',
  themeSystem: '跟随系统',
  languageLabel: '语言',
  languageEnglish: 'English',
  languageZhCN: '简体中文',
  window: '窗口',
  minimize: '最小化',
  zoom: '缩放',
  bringAllToFront: '前置全部窗口',
  help: '帮助',
  menuCheckForUpdates: '检查应用更新…',
  menuRestartToInstall: '重启并完成更新',
  dockerEngineDocs: 'Docker Engine API 文档',
  helpOpenSourceRepository: '源代码仓库（GitHub）',
  aboutAppMenu: '关于 Docker Browser',
  macHideOthers: '隐藏其他',
  macShowAll: '显示全部',
  macAboutApp: '关于 {{appName}}',
  macHideApp: '隐藏 {{appName}}',
  aboutPanelCopyright: "Copyright © Guo's\nMIT License — see LICENSE",
  aboutDialogTitle: '关于 Docker Browser',
  aboutDialogBodyPlain:
    '版本 {{version}}\n\n本地 Docker Engine 管理客户端。\n许可条款见 LICENSE。\n\n{{repoUrl}}',
  dialogOk: '确定',
}

const EN: AppShellStrings = {
  file: 'File',
  closeWindow: 'Close Window',
  quit: 'Quit Docker Browser',
  edit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  view: 'View',
  reload: 'Reload',
  actualSize: 'Actual Size',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  toggleFullscreen: 'Toggle Full Screen',
  settings: 'Settings',
  appearance: 'Appearance',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'Match System',
  languageLabel: 'Language',
  languageEnglish: 'English',
  languageZhCN: 'Chinese (Simplified)',
  window: 'Window',
  minimize: 'Minimize',
  zoom: 'Zoom',
  bringAllToFront: 'Bring All to Front',
  help: 'Help',
  menuCheckForUpdates: 'Check for App Updates…',
  menuRestartToInstall: 'Restart to Install Update',
  dockerEngineDocs: 'Docker Engine API docs',
  helpOpenSourceRepository: 'Source repository (GitHub)',
  aboutAppMenu: 'About Docker Browser',
  macHideOthers: 'Hide Others',
  macShowAll: 'Show All',
  macAboutApp: 'About {{appName}}',
  macHideApp: 'Hide {{appName}}',
  aboutPanelCopyright: "Copyright © Guo's\nMIT License — see LICENSE",
  aboutDialogTitle: 'About Docker Browser',
  aboutDialogBodyPlain:
    'Version {{version}}\n\nDesktop client for your local Docker Engine.\nSee LICENSE for licensing.\n\n{{repoUrl}}',
  dialogOk: 'OK',
}

export function getAppShellStrings(lng: AppLanguage): AppShellStrings {
  return lng === 'en' ? EN : ZH
}

export function formatAboutDialogBodyPlain(s: AppShellStrings, version: string): string {
  return interpolateTemplate(s.aboutDialogBodyPlain, {
    version,
    repoUrl: DOCKER_BROWSER_REPOSITORY_URL,
  })
}
