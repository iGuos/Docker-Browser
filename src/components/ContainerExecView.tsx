import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { imageRefFromInspect, matchImageHints } from '@/lib/execContainerImageHints'
import '@xterm/xterm/css/xterm.css'

const RESIZE_DEBOUNCE_MS = 100

type Props = {
  containerId: string
  className?: string
}

export function ContainerExecView({ containerId, className = '' }: Props) {
  const { t, i18n } = useTranslation()
  const { alert } = useAppDialog()
  const [connecting, setConnecting] = useState(true)
  const [connected, setConnected] = useState(false)
  const [reconnectToken, setReconnectToken] = useState(0)
  const [imageRef, setImageRef] = useState('')
  const [hintAfterPaste, setHintAfterPaste] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [hintEditText, setHintEditText] = useState('')
  const [presetListOpen, setPresetListOpen] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const subIdRef = useRef('')
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hintPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const presetComboRef = useRef<HTMLDivElement>(null)
  const presetListDomId = useId()

  const imageHints = useMemo(() => matchImageHints(imageRef), [imageRef])

  useEffect(() => {
    if (!imageHints?.suggestions.length) {
      setHintEditText('')
      return
    }
    setHintEditText(imageHints.suggestions[0]?.command ?? '')
  }, [imageHints])

  useEffect(() => {
    setPresetListOpen(false)
  }, [imageHints])

  useEffect(() => {
    if (!presetListOpen) return
    const onDocMouseDown = (ev: globalThis.MouseEvent) => {
      if (presetComboRef.current?.contains(ev.target as Node)) return
      setPresetListOpen(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setPresetListOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [presetListOpen])

  useEffect(() => {
    let cancelled = false
    setImageRef('')
    setHintAfterPaste(false)
    void window.dockerDesktop.inspectContainer(containerId).then((res) => {
      if (cancelled || !res.ok) return
      setImageRef(imageRefFromInspect(res.data))
    })
    return () => {
      cancelled = true
    }
  }, [containerId])

  useEffect(() => {
    if (reconnectToken === 0) return
    let cancelled = false
    void window.dockerDesktop.inspectContainer(containerId).then((res) => {
      if (cancelled || !res.ok) return
      setImageRef(imageRefFromInspect(res.data))
    })
    return () => {
      cancelled = true
    }
  }, [reconnectToken])

  useEffect(() => {
    return () => {
      if (hintPulseTimerRef.current) {
        clearTimeout(hintPulseTimerRef.current)
        hintPulseTimerRef.current = null
      }
    }
  }, [])

  const disconnect = useCallback(async () => {
    const sid = subIdRef.current
    subIdRef.current = ''
    if (sid) await window.dockerDesktop.execPtyStop(sid)
    setConnected(false)
  }, [])

  const reconnect = useCallback(() => {
    setReconnectToken((n) => n + 1)
  }, [])

  const copySelection = useCallback(async () => {
    const term = termRef.current
    const sel = term?.getSelection() ?? ''
    if (!sel.trim()) return
    try {
      await navigator.clipboard.writeText(sel)
    } catch {
      await alert(t('containers.copyIdFailed'))
    }
  }, [alert, t])

  const copyAllBuffer = useCallback(async () => {
    const term = termRef.current
    if (!term) return
    term.selectAll()
    const text = term.getSelection()
    term.clearSelection()
    if (!text.trim()) {
      await alert(t('containers.execTerminalCopyAllEmpty'))
      return
    }
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      await alert(t('containers.copyIdFailed'))
    }
  }, [alert, t])

  const pasteFromClipboard = useCallback(async () => {
    const term = termRef.current
    if (!term || !subIdRef.current) {
      await alert(t('containers.execTerminalPasteNeedConnection'))
      return
    }
    try {
      const text = await navigator.clipboard.readText()
      if (!text) {
        await alert(t('containers.execTerminalPasteEmpty'))
        return
      }
      term.paste(text)
      const h = matchImageHints(imageRef)
      if (h?.suggestions.length) {
        setHintAfterPaste(true)
        if (hintPulseTimerRef.current) clearTimeout(hintPulseTimerRef.current)
        hintPulseTimerRef.current = setTimeout(() => {
          hintPulseTimerRef.current = null
          setHintAfterPaste(false)
        }, 6000)
      }
    } catch {
      await alert(t('containers.execTerminalPasteDenied'))
    }
  }, [alert, imageRef, t])

  const insertImageHintCommand = useCallback((command: string, execute: boolean) => {
    const term = termRef.current
    if (!term || !command) return
    term.paste(command)
    queueMicrotask(() => term.focus())
    if (!execute) return
    // paste() 使用括号粘贴时，不能把 \r 拼在字符串里——回车会落在粘贴块内，shell 不会执行。
    // 在下一轮事件后再单独写入 CR，交给 PTY 作为一次真实按键。
    const sid = subIdRef.current
    if (!sid) return
    window.setTimeout(() => {
      if (subIdRef.current !== sid) return
      void window.dockerDesktop.execPtyWrite({ subscriptionId: sid, data: '\r' })
    }, 30)
  }, [])

  const clearScreen = useCallback(() => {
    termRef.current?.clear()
  }, [])

  const focusTerminal = useCallback(() => {
    termRef.current?.focus()
  }, [])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  const openExecCtxMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const pad = 8
    const menuW = 240
    const menuH = 176
    setCtxMenu({
      x: Math.max(pad, Math.min(e.clientX, window.innerWidth - menuW - pad)),
      y: Math.max(pad, Math.min(e.clientY, window.innerHeight - menuH - pad)),
    })
  }, [])

  useEffect(() => {
    if (!ctxMenu) return
    const onDocMouseDown = (ev: globalThis.MouseEvent) => {
      if (ctxMenuRef.current?.contains(ev.target as Node)) return
      setCtxMenu(null)
    }
    const onDocContextMenu = (ev: globalThis.MouseEvent) => {
      if (ctxMenuRef.current?.contains(ev.target as Node)) return
      setCtxMenu(null)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setCtxMenu(null)
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    document.addEventListener('contextmenu', onDocContextMenu, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true)
      document.removeEventListener('contextmenu', onDocContextMenu, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [ctxMenu])

  useEffect(() => {
    const onWinFocus = () => {
      if (subIdRef.current) queueMicrotask(() => termRef.current?.focus())
    }
    window.addEventListener('focus', onWinFocus)
    return () => window.removeEventListener('focus', onWinFocus)
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      convertEol: true,
      scrollback: 10_000,
      fontSize: 13,
      fontFamily: 'Consolas, "Cascadia Code", "Courier New", monospace',
      theme: {
        background: '#0c0c0c',
        foreground: '#e4e4e7',
        cursor: '#22c55e',
        selectionBackground: '#3f3f46',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(wrap)
    termRef.current = term
    fitRef.current = fit

    const dataDisp = term.onData((data) => {
      const sid = subIdRef.current
      if (!sid) return
      void window.dockerDesktop.execPtyWrite({ subscriptionId: sid, data })
    })

    const scheduleResize = () => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null
        fit.fit()
        const sid = subIdRef.current
        if (sid && term.cols > 0 && term.rows > 0) {
          void window.dockerDesktop.execPtyResize({ subscriptionId: sid, cols: term.cols, rows: term.rows })
        }
      }, RESIZE_DEBOUNCE_MS)
    }

    const ro = new ResizeObserver(() => {
      scheduleResize()
    })
    ro.observe(wrap)
    queueMicrotask(() => {
      fit.fit()
    })

    let offData: (() => void) | null = null
    let offExit: (() => void) | null = null
    let cancelled = false

    void (async () => {
      setConnecting(true)
      setConnected(false)
      subIdRef.current = ''
      term.reset()
      term.writeln(`\x1b[90m${t('containers.execStreamConnecting')}\x1b[0m`)

      const cols = Math.max(term.cols || 80, 40)
      const rows = Math.max(term.rows || 24, 8)
      const res = await window.dockerDesktop.execPtyStart({ containerId, cols, rows })
      if (cancelled) {
        if (res.ok) void window.dockerDesktop.execPtyStop(res.data.subscriptionId)
        return
      }
      if (!res.ok) {
        setConnecting(false)
        term.reset()
        term.writeln(`\x1b[31m${res.error}\x1b[0m`)
        return
      }
      const sid = res.data.subscriptionId
      subIdRef.current = sid
      setConnecting(false)
      setConnected(true)
      term.reset()
      fit.fit()
      requestAnimationFrame(() => {
        fit.fit()
        if (term.cols > 0 && term.rows > 0) {
          void window.dockerDesktop.execPtyResize({ subscriptionId: sid, cols: term.cols, rows: term.rows })
        }
        requestAnimationFrame(() => {
          fit.fit()
          if (term.cols > 0 && term.rows > 0) {
            void window.dockerDesktop.execPtyResize({ subscriptionId: sid, cols: term.cols, rows: term.rows })
          }
          term.focus()
        })
      })

      offData = window.dockerDesktop.onExecPtyData((msg) => {
        if (msg.subscriptionId !== sid) return
        term.write(msg.data)
      })
      offExit = window.dockerDesktop.onExecPtyExit((msg) => {
        if (msg.subscriptionId !== sid) return
        subIdRef.current = ''
        setConnected(false)
        term.writeln('')
        term.writeln(
          `\x1b[33m${i18n.t('containers.execSessionClosed')}` +
            (typeof msg.exitCode === 'number' ? ` (exit ${msg.exitCode})` : '') +
            `\x1b[0m`,
        )
      })
    })()

    return () => {
      cancelled = true
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
      offData?.()
      offExit?.()
      const sid = subIdRef.current
      subIdRef.current = ''
      if (sid) void window.dockerDesktop.execPtyStop(sid)
      dataDisp.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [containerId, reconnectToken, t, i18n])

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3 ${className}`}>
      <h2 className="shrink-0 text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">{t('containers.execTitle')}</h2>
      <p className="shrink-0 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{t('containers.execHint')}</p>

      <div className="flex shrink-0 flex-wrap items-center justify-start gap-x-2 gap-y-1.5 text-[10px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                connecting ? 'bg-amber-400' : connected ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-500'
              }`}
              aria-hidden
            />
            <span className="text-zinc-600 dark:text-zinc-300">
              {connecting
                ? t('containers.execStreamConnecting')
                : connected
                  ? t('containers.execStreamConnected')
                  : t('containers.execStreamDisconnected')}
            </span>
          </div>
          <span className="hidden h-4 w-px shrink-0 bg-zinc-300 sm:inline dark:bg-zinc-600" aria-hidden />
          <button
            type="button"
            disabled={connecting || !connected}
            title={t('containers.execTerminalTipDisconnect')}
            onClick={() => void disconnect()}
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {t('containers.execDisconnect')}
          </button>
        </div>

        <button
          type="button"
          disabled={connecting || connected}
          title={t('containers.execTerminalTipReconnect')}
          onClick={reconnect}
          className="shrink-0 rounded-md bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('containers.execReconnect')}
        </button>

        {imageHints && connected && imageHints.suggestions.length > 0 ? (
          <div
            className={`flex min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-shadow ${
              hintAfterPaste
                ? 'border-amber-400/70 bg-amber-50/90 ring-2 ring-amber-400/50 dark:border-amber-500/40 dark:bg-amber-950/40 dark:ring-amber-400/30'
                : 'border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/80'
            }`}
            role="status"
            title={hintAfterPaste ? t('containers.execImageHintPulseTitle') : undefined}
          >
            <span className="shrink-0 text-left font-medium text-zinc-600 dark:text-zinc-300">
              {t('containers.execImageHintLabel')}
            </span>
            <div ref={presetComboRef} className="relative min-w-[18rem] max-w-[min(100%,52rem)] flex-1 sm:min-w-[24rem]">
              <input
                type="text"
                value={hintEditText}
                onChange={(e) => setHintEditText(e.target.value)}
                spellCheck={false}
                aria-label={t('containers.execImageHintComboAria')}
                aria-expanded={presetListOpen}
                aria-controls={presetListOpen ? presetListDomId : undefined}
                className="w-full rounded border border-zinc-300 bg-white py-1 pl-2 pr-7 text-left font-mono text-[10px] text-zinc-800 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <button
                type="button"
                aria-expanded={presetListOpen}
                aria-controls={presetListDomId}
                title={t('containers.execImageHintExpandPresets')}
                className="absolute right-0.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setPresetListOpen((o) => !o)}
              >
                <span className="text-[10px] leading-none" aria-hidden>
                  ▼
                </span>
              </button>
              {presetListOpen ? (
                <ul
                  id={presetListDomId}
                  role="listbox"
                  className="absolute left-0 top-full z-30 mt-0.5 max-h-60 w-full min-w-[18rem] overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 text-left shadow-lg dark:border-zinc-600 dark:bg-zinc-900 sm:min-w-[24rem]"
                >
                  {imageHints.suggestions.map((row, i) => (
                    <li key={`${imageHints.kind}-${row.id}-${i}`} role="presentation">
                      <button
                        type="button"
                        role="option"
                        className="w-full whitespace-pre-wrap break-words px-2 py-1.5 text-left font-mono text-[10px] leading-snug text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                        onClick={() => {
                          setHintEditText(row.command)
                          setPresetListOpen(false)
                        }}
                      >
                        {row.command}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <button
                type="button"
                title={t('containers.execImageHintInsertTip')}
                onClick={() => insertImageHintCommand(hintEditText.trim(), false)}
                className="rounded-md bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 dark:bg-sky-600 dark:hover:bg-sky-500"
              >
                {t('containers.execImageHintInsert')}
              </button>
              <button
                type="button"
                title={t('containers.execImageHintInsertRunTip')}
                onClick={() => insertImageHintCommand(hintEditText.trim(), true)}
                className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {t('containers.execImageHintInsertRun')}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-zinc-700 bg-[#0c0c0c] ring-offset-2 ring-offset-zinc-50 focus-within:ring-2 focus-within:ring-sky-500/40 dark:border-zinc-600 dark:ring-offset-zinc-950"
        role="region"
        aria-label={t('containers.execTerminalRegionAria')}
        onContextMenuCapture={openExecCtxMenu}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          focusTerminal()
        }}
      >
        <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden px-1 pb-1 pt-0.5" />
      </div>

      {ctxMenu ? (
        <div
          ref={ctxMenuRef}
          role="menu"
          aria-label={t('containers.execTerminalCtxMenuAria')}
          className="fixed z-[10000] min-w-[11rem] rounded-md border border-zinc-200 bg-white py-1 text-[11px] shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            title={t('containers.execTerminalTipCopy')}
            className="block w-full px-3 py-2 text-left text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              void copySelection().finally(() => {
                closeCtxMenu()
                queueMicrotask(() => termRef.current?.focus())
              })
            }}
          >
            {t('containers.execCopy')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!connected}
            title={!connected ? t('containers.execTerminalPasteNeedConnection') : t('containers.execTerminalTipPaste')}
            className="block w-full px-3 py-2 text-left text-zinc-800 enabled:hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-100 dark:enabled:hover:bg-zinc-800"
            onClick={() => {
              void pasteFromClipboard().finally(() => {
                closeCtxMenu()
                queueMicrotask(() => termRef.current?.focus())
              })
            }}
          >
            {t('containers.execTerminalPaste')}
          </button>
          <button
            type="button"
            role="menuitem"
            title={t('containers.execTerminalTipCopyAll')}
            className="block w-full px-3 py-2 text-left text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              void copyAllBuffer().finally(() => {
                closeCtxMenu()
                queueMicrotask(() => termRef.current?.focus())
              })
            }}
          >
            {t('containers.execTerminalCopyAll')}
          </button>
          <button
            type="button"
            role="menuitem"
            title={t('containers.execTerminalTipClear')}
            className="block w-full px-3 py-2 text-left text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              clearScreen()
              closeCtxMenu()
              queueMicrotask(() => termRef.current?.focus())
            }}
          >
            {t('containers.execClearOut')}
          </button>
        </div>
      ) : null}
      <p className="shrink-0 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{t('containers.execTerminalFootnote')}</p>
    </div>
  )
}
