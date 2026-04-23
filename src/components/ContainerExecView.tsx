import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useAppDialog } from '@/dialog/AppDialogContext'
import '@xterm/xterm/css/xterm.css'

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

  const wrapRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const subIdRef = useRef('')

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
    if (!sel.trim()) {
      await alert(t('containers.execTerminalCopyEmpty'))
      return
    }
    try {
      await navigator.clipboard.writeText(sel)
    } catch {
      await alert(t('containers.copyIdFailed'))
    }
  }, [alert, t])

  const clearScreen = useCallback(() => {
    termRef.current?.clear()
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
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

    const ro = new ResizeObserver(() => {
      fit.fit()
      const sid = subIdRef.current
      if (sid && term.cols > 0 && term.rows > 0) {
        void window.dockerDesktop.execPtyResize({ subscriptionId: sid, cols: term.cols, rows: term.rows })
      }
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
      if (term.cols > 0 && term.rows > 0) {
        void window.dockerDesktop.execPtyResize({ subscriptionId: sid, cols: term.cols, rows: term.rows })
      }
      queueMicrotask(() => term.focus())

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
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10px]">
        <span className="text-zinc-600 dark:text-zinc-300">
          {connecting
            ? t('containers.execStreamConnecting')
            : connected
              ? t('containers.execStreamConnected')
              : t('containers.execStreamDisconnected')}
        </span>
        <button
          type="button"
          disabled={connecting || !connected}
          onClick={() => void disconnect()}
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          {t('containers.execDisconnect')}
        </button>
        <button
          type="button"
          disabled={connecting || connected}
          onClick={reconnect}
          className="shrink-0 rounded-md bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('containers.execReconnect')}
        </button>
        <button
          type="button"
          onClick={clearScreen}
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          {t('containers.execClearOut')}
        </button>
        <button
          type="button"
          onClick={() => void copySelection()}
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          {t('containers.execCopy')}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-zinc-700 bg-[#0c0c0c] dark:border-zinc-600">
        <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden p-1" />
      </div>
      <p className="shrink-0 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{t('containers.execTerminalFootnote')}</p>
    </div>
  )
}
