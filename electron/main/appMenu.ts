import { app, BrowserWindow, dialog, Menu, nativeTheme, shell } from 'electron'
import { checkForUpdatesFromMenu, menuCanQuitAndInstall, quitInstallFromMenu } from './updater'
import type { MenuItemConstructorOptions } from 'electron'
import { openExternalUrlIfAllowed } from './openExternalPolicy'
import {
  DOCKER_BROWSER_REPOSITORY_URL,
  formatAboutDialogBodyPlain,
  getAppShellStrings,
  interpolateTemplate,
  type AppShellStrings,
} from '../../shared/appShellStrings'
import type { AppLanguage } from '../../shared/locale'
import { getDefaultAppLanguage } from '../../shared/locale'
import type { ThemePreference } from '../../shared/theme'

export function syncNativeThemeSource(pref: ThemePreference): void {
  nativeTheme.themeSource = pref === 'system' ? 'system' : pref
}

let menuTheme: ThemePreference = 'system'
let menuLang: AppLanguage = getDefaultAppLanguage()

/** 与原生菜单、Electron 文件对话框文案同步 */
export function getAppMenuLanguage(): AppLanguage {
  return menuLang
}

/** 供 updater 在下载完成后重建菜单，以刷新「重启并完成更新」可用态 */
export function rebuildApplicationMenu(): void {
  installAppMenu(menuTheme, menuLang)
}

function shellStrings(): AppShellStrings {
  return getAppShellStrings(menuLang)
}

function sendThemeToRenderer(pref: ThemePreference): void {
  const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (w && !w.isDestroyed()) w.webContents.send('app-menu:theme', pref)
}

function openDockerEngineDocs(): void {
  void shell.openExternal('https://docs.docker.com/engine/api/latest/')
}

function openSourceRepository(): void {
  void shell.openExternal(DOCKER_BROWSER_REPOSITORY_URL)
}

function showAboutNativeDialog(): void {
  const s = shellStrings()
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  void dialog.showMessageBox(parent ?? undefined, {
    type: 'info',
    title: s.aboutDialogTitle,
    message: formatAboutDialogBodyPlain(s, app.getVersion()),
    buttons: [s.dialogOk],
    defaultId: 0,
    noLink: true,
  })
}

function showAbout(): void {
  if (process.platform === 'darwin') {
    app.showAboutPanel()
    return
  }
  showAboutNativeDialog()
}

function broadcastAppLanguage(lng: AppLanguage): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('app-menu:language', lng)
  }
}

export function installAppMenu(themePref?: ThemePreference, language?: AppLanguage): void {
  if (themePref !== undefined) menuTheme = themePref
  if (language !== undefined) menuLang = language

  const s = shellStrings()
  const isMac = process.platform === 'darwin'

  app.setAboutPanelOptions({
    applicationName: 'Docker Browser',
    applicationVersion: app.getVersion(),
    copyright: s.aboutPanelCopyright,
    website: DOCKER_BROWSER_REPOSITORY_URL,
  })

  const macAppMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about', label: interpolateTemplate(s.macAboutApp, { appName: app.name }) },
      { type: 'separator' },
      { role: 'hide', label: interpolateTemplate(s.macHideApp, { appName: app.name }) },
      { role: 'hideOthers', label: s.macHideOthers },
      { role: 'unhide', label: s.macShowAll },
      { type: 'separator' },
      { role: 'quit', label: s.quit },
    ],
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    {
      label: s.file,
      submenu: [
        isMac
          ? { label: s.closeWindow, role: 'close', accelerator: 'Cmd+W' }
          : { label: s.quit, role: 'quit', accelerator: 'Ctrl+Q' },
      ],
    },
    {
      label: s.edit,
      submenu: [
        { label: s.undo, role: 'undo', accelerator: 'CmdOrCtrl+Z' },
        { label: s.redo, role: 'redo', accelerator: 'Shift+CmdOrCtrl+Z' },
        { type: 'separator' },
        { label: s.cut, role: 'cut', accelerator: 'CmdOrCtrl+X' },
        { label: s.copy, role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { label: s.paste, role: 'paste', accelerator: 'CmdOrCtrl+V' },
      ],
    },
    {
      label: s.view,
      submenu: [
        { label: s.reload, role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { type: 'separator' },
        { label: s.actualSize, role: 'resetZoom' },
        { label: s.zoomIn, role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { label: s.zoomOut, role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
        { type: 'separator' },
        {
          label: s.toggleFullscreen,
          role: 'togglefullscreen',
          accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11',
        },
      ],
    },
    {
      label: s.settings,
      submenu: [
        {
          label: s.appearance,
          submenu: [
            {
              label: s.themeLight,
              type: 'radio',
              checked: menuTheme === 'light',
              click: () => {
                syncNativeThemeSource('light')
                installAppMenu('light')
                sendThemeToRenderer('light')
              },
            },
            {
              label: s.themeDark,
              type: 'radio',
              checked: menuTheme === 'dark',
              click: () => {
                syncNativeThemeSource('dark')
                installAppMenu('dark')
                sendThemeToRenderer('dark')
              },
            },
            {
              label: s.themeSystem,
              type: 'radio',
              checked: menuTheme === 'system',
              click: () => {
                syncNativeThemeSource('system')
                installAppMenu('system')
                sendThemeToRenderer('system')
              },
            },
          ],
        },
        {
          label: s.languageLabel,
          submenu: [
            {
              label: s.languageEnglish,
              type: 'radio',
              checked: menuLang === 'en',
              click: () => {
                installAppMenu(menuTheme, 'en')
                broadcastAppLanguage('en')
              },
            },
            {
              label: s.languageZhCN,
              type: 'radio',
              checked: menuLang === 'zh-CN',
              click: () => {
                installAppMenu(menuTheme, 'zh-CN')
                broadcastAppLanguage('zh-CN')
              },
            },
          ],
        },
      ],
    },
    ...(isMac
      ? [
          {
            label: s.window,
            submenu: [
              { label: s.minimize, role: 'minimize', accelerator: 'Cmd+M' },
              { label: s.zoom, role: 'zoom' },
              { type: 'separator' as const },
              { role: 'front' as const, label: s.bringAllToFront },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: s.help,
      submenu: [
        {
          label: s.menuCheckForUpdates,
          enabled: app.isPackaged,
          click: () => checkForUpdatesFromMenu(),
        },
        {
          label: s.menuRestartToInstall,
          enabled: menuCanQuitAndInstall(),
          click: () => quitInstallFromMenu(),
        },
        { type: 'separator' },
        { label: s.dockerEngineDocs, click: openDockerEngineDocs },
        { type: 'separator' },
        { label: s.helpOpenSourceRepository, click: openSourceRepository },
        { type: 'separator' },
        ...(!isMac ? [{ label: s.aboutAppMenu, click: showAbout }] : []),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
