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
import type { AppAlertOptions } from '@/lib/alertMessage'

type Visual =
  | { kind: 'alert'; message: string; copyable?: boolean }
  | { kind: 'confirm'; message: string }
  | { kind: 'prompt'; message: string; placeholder?: string; initialValue?: string }

type Pending =
  | { kind: 'alert'; resolve: () => void }
  | { kind: 'confirm'; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; resolve: (value: string | null) => void }

export type { AppAlertOptions }

export type AppDialogApi = {
  alert: (message: string, options?: AppAlertOptions) => Promise<void>
  confirm: (message: string) => Promise<boolean>
  prompt: (message: string, options?: { placeholder?: string; initialValue?: string }) => Promise<string | null>
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
  const copyableTextareaRef = useRef<HTMLTextAreaElement>(null)
  const promptInputRef = useRef<HTMLInputElement>(null)
  const [promptValue, setPromptValue] = useState('')

  const finish = useCallback((result?: boolean | string) => {
    const p = pendingRef.current
    pendingRef.current = null
    setVisual(null)
    setPromptValue('')
    if (!p) return
    if (p.kind === 'alert') p.resolve()
    else if (p.kind === 'confirm') p.resolve(result === true)
    else p.resolve(typeof result === 'string' ? result : null)
  }, [])

  useEffect(() => {
    if (!visual) return
    const id = window.requestAnimationFrame(() => {
      if (visual.kind === 'alert' && visual.copyable) copyableTextareaRef.current?.focus()
      else if (visual.kind === 'prompt') promptInputRef.current?.focus()
      else primaryBtnRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [visual])

  useEffect(() => {
    if (!visual) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (visual.kind === 'confirm') finish(false)
        else if (visual.kind === 'prompt') finish()
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

  const alert = useCallback((message: string, options?: AppAlertOptions) => {
    return new Promise<void>((resolve) => {
      pendingRef.current = { kind: 'alert', resolve }
      setVisual({ kind: 'alert', message, copyable: options?.copyable })
    })
  }, [])

  const confirm = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current = { kind: 'confirm', resolve }
      setVisual({ kind: 'confirm', message })
    })
  }, [])

  const prompt = useCallback(
    (message: string, options?: { placeholder?: string; initialValue?: string }) => {
      return new Promise<string | null>((resolve) => {
        pendingRef.current = { kind: 'prompt', resolve }
        setPromptValue(options?.initialValue ?? '')
        setVisual({
          kind: 'prompt',
          message,
          placeholder: options?.placeholder,
          initialValue: options?.initialValue,
        })
      })
    },
    [],
  )

  const value = useMemo(() => ({ alert, confirm, prompt }), [alert, confirm, prompt])

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
            className={
              visual.kind === 'alert' && visual.copyable
                ? 'w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-4 shadow-xl outline-none dark:border-zinc-700 dark:bg-zinc-900'
                : 'w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl outline-none dark:border-zinc-700 dark:bg-zinc-900'
            }
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trapTab}
          >
            <h2
              id="app-dialog-title"
              className="mb-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100"
            >
              {visual.kind === 'confirm' ? t('common.dialogConfirmTitle') : t('common.dialogNoticeTitle')}
            </h2>
            {visual.kind === 'alert' && visual.copyable ? (
              <textarea
                ref={copyableTextareaRef}
                id="app-dialog-desc"
                readOnly
                value={visual.message}
                rows={8}
                spellCheck={false}
                className="max-h-[50vh] min-h-[5.5rem] w-full resize-y select-text rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-800 outline-none dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200"
              />
            ) : (
              <p
                id="app-dialog-desc"
                className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-700 select-text dark:text-zinc-300"
              >
                {visual.message}
              </p>
            )}
            {visual.kind === 'prompt' ? (
              <input
                ref={promptInputRef}
                type="text"
                value={promptValue}
                placeholder={visual.placeholder}
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    finish(promptValue)
                  }
                }}
                className="mt-3 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[12px] text-zinc-800 outline-none ring-sky-500 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              />
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              {visual.kind === 'confirm' || visual.kind === 'prompt' ? (
                <button
                  type="button"
                  onClick={() => (visual.kind === 'confirm' ? finish(false) : finish())}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-[11px] dark:border-zinc-600"
                >
                  {t('common.cancel')}
                </button>
              ) : null}
              <button
                ref={primaryBtnRef}
                type="button"
                onClick={() => {
                  if (visual.kind === 'confirm') finish(true)
                  else if (visual.kind === 'prompt') finish(promptValue)
                  else finish()
                }}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-500"
              >
                {visual.kind === 'confirm' || visual.kind === 'prompt' ? t('common.confirm') : t('common.ok')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppDialogContext.Provider>
  )
}
