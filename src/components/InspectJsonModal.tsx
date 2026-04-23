import { useTranslation } from 'react-i18next'
import { useModalEscape } from '@/hooks/useModalEscape'

type Props = {
  open: boolean
  title: string
  jsonText: string
  onClose: () => void
}

export function InspectJsonModal({ open, title, jsonText, onClose }: Props) {
  const { t } = useTranslation()
  useModalEscape(open, onClose)
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inspect-json-title"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <h2 id="inspect-json-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('common.close')}
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[10px] leading-relaxed text-zinc-800 dark:text-zinc-200">
          {jsonText}
        </pre>
      </div>
    </div>
  )
}
