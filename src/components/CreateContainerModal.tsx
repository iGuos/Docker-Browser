import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalEscape } from '@/hooks/useModalEscape'
import { RestartPolicyField } from '@/components/RestartPolicyField'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { formatThrownEngineError } from '@/lib/alertMessage'
import type { RestartPolicyName } from '@shared/restartPolicy'

type Props = {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export function CreateContainerModal({ open, onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const { alert } = useAppDialog()
  const [image, setImage] = useState('nginx:alpine')
  const [name, setName] = useState('')
  const [envText, setEnvText] = useState('')
  const [publishText, setPublishText] = useState('')
  const [cmdText, setCmdText] = useState('')
  const [autoRemove, setAutoRemove] = useState(false)
  const [restartPolicy, setRestartPolicy] = useState<RestartPolicyName>('no')
  const [submitting, setSubmitting] = useState(false)

  useModalEscape(open, onClose)

  if (!open) return null

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await window.dockerDesktop.createRunContainer({
        image: image.trim(),
        name: name.trim() || undefined,
        envText,
        publishText,
        cmdText: cmdText.trim() || undefined,
        autoRemove,
        restartPolicy,
      })
      if (!res.ok) throw new Error(res.error)
      onCreated()
      onClose()
    } catch (e) {
      const text = formatThrownEngineError(t, e)
      if (text) await alert(text)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {t('create.title')}
        </h2>
        <p className="mb-3 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t('create.hint')}
        </p>
        <div className="flex flex-col gap-2.5">
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('create.image')} *
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('create.name')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create.namePlaceholder')}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('create.publish')}
            <input
              value={publishText}
              onChange={(e) => setPublishText(e.target.value)}
              placeholder="8080:80"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('create.env')}
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              rows={3}
              placeholder={t('create.envPlaceholder')}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('create.cmd')}
            <input
              value={cmdText}
              onChange={(e) => setCmdText(e.target.value)}
              placeholder={t('create.cmdPlaceholder')}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <RestartPolicyField
            value={restartPolicy}
            disabled={autoRemove}
            onChange={(v) => setRestartPolicy(v)}
          />
          <label className="flex items-center gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={autoRemove}
              onChange={(e) => {
                const on = e.target.checked
                setAutoRemove(on)
                if (on) setRestartPolicy('no')
              }}
            />
            {t('create.autoRemove')}
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-[11px] dark:border-zinc-600"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={submitting || !image.trim()}
            onClick={() => void submit()}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {submitting ? t('common.loading') : t('create.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
