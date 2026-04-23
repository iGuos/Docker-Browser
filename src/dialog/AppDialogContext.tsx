import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

type Visual =
  | { kind: 'alert'; message: string }
  | { kind: 'confirm'; message: string }

type Pending =
  | { kind: 'alert'; resolve: () => void }
  | { kind: 'confirm'; resolve: (ok: boolean) => void }

export type AppDialogApi = {
  alert: (message: string) => Promise<void>
  confirm: (message: string) => Promise<boolean>
}

const AppDialogContext = createContext<AppDialogApi | null>(null)

export function useAppDialog(): AppDialogApi {
  const ctx = useContext(AppDialogContext)
  if (!ctx) throw new Error('useAppDialog must be used within AppDialogProvider')
  return ctx
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [visual, setVisual] = useState<Visual | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const primaryBtnRef = useRef<HTMLButtonElement>(null)

  const finish = useCallback((result?: boolean) => {
    const p = pendingRef.current
    pendingRef.current = null
    setVisual(null)
    if (!p) return
    if (p.kind === 'alert') p.resolve()
    else p.resolve(result === true)
  }, [])

  useEffect(() => {
    if (!visual) return
    const id = window.requestAnimationFrame(() => {
      primaryBtnRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [visual])

  useEffect(() => {
    if (!visual) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (visual.kind === 'confirm') finish(false)
        else finish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visual, finish])

  const trapTab = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return
      const sel =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(sel)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (nodes.length < 2) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [],
  )

  const alert = useCallback((message: string) => {
    return new Promise<void>((resolve) => {
      pendingRef.current = { kind: 'alert', resolve }
      setVisual({ kind: 'alert', message })
    })
  }, [])

  const confirm = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current = { kind: 'confirm', resolve }
      setVisual({ kind: 'confirm', message })
    })
  }, [])

  const value = useMemo(() => ({ alert, confirm }), [alert, confirm])

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      {visual ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          data-app-dialog-overlay=""
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            aria-describedby="app-dialog-desc"
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl outline-none dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trapTab}
          >
            <h2
              id="app-dialog-title"
              className="mb-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100"
            >
              {visual.kind === 'confirm' ? t('common.dialogConfirmTitle') : t('common.dialogNoticeTitle')}
            </h2>
            <p
              id="app-dialog-desc"
              className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300"
            >
              {visual.message}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              {visual.kind === 'confirm' ? (
                <button
                  type="button"
                  onClick={() => finish(false)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-[11px] dark:border-zinc-600"
                >
                  {t('common.cancel')}
                </button>
              ) : null}
              <button
                ref={primaryBtnRef}
                type="button"
                onClick={() => (visual.kind === 'confirm' ? finish(true) : finish())}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-500"
              >
                {visual.kind === 'confirm' ? t('common.confirm') : t('common.ok')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppDialogContext.Provider>
  )
}
