import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalEscape } from '@/hooks/useModalEscape'
import { inspectJsonToPublishText } from '@shared/inspectPorts'
import { normalizeRestartPolicyName, type RestartPolicyName } from '@shared/restartPolicy'
import { RestartPolicyField } from '@/components/RestartPolicyField'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { formatThrownEngineError } from '@/lib/alertMessage'

type Props = {
  open: boolean
  containerId: string
  onClose: () => void
  onRecreated: (newId: string) => void
}

export function EditContainerConfigModal({ open, containerId, onClose, onRecreated }: Props) {
  const { t } = useTranslation()
  const { alert, confirm } = useAppDialog()
  const [image, setImage] = useState('')
  const [name, setName] = useState('')
  const [envText, setEnvText] = useState('')
  const [publishText, setPublishText] = useState('')
  const [cmdText, setCmdText] = useState('')
  const [autoRemove, setAutoRemove] = useState(false)
  const [restartPolicy, setRestartPolicy] = useState<RestartPolicyName>('no')
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open || !containerId) return
    setLoadErr(null)
    setSubmitting(false)
    void window.dockerDesktop.inspectContainer(containerId).then((res) => {
      if (!res.ok) {
        setLoadErr(res.error)
        return
      }
      const ins = res.data as Record<string, unknown>
      const cfg = ins.Config as Record<string, unknown> | undefined
      const hc = ins.HostConfig as Record<string, unknown> | undefined
      setImage(typeof cfg?.Image === 'string' ? cfg.Image : '')
      setName(typeof ins.Name === 'string' ? ins.Name.replace(/^\//, '') : '')
      const env = cfg?.Env
      setEnvText(Array.isArray(env) ? (env as string[]).join('\n') : '')
      setPublishText(inspectJsonToPublishText(ins))
      const cmd = cfg?.Cmd
      setCmdText(Array.isArray(cmd) ? (cmd as string[]).join(' ') : '')
      setAutoRemove(hc?.AutoRemove === true)
      const rp = hc?.RestartPolicy as { Name?: string } | undefined
      setRestartPolicy(normalizeRestartPolicyName(typeof rp?.Name === 'string' ? rp.Name : undefined))
    })
  }, [open, containerId])

  useModalEscape(open, onClose)

  if (!open) return null

  const submit = async () => {
    if (!(await confirm(t('containers.configRecreateConfirm')))) return
    if (!image.trim()) {
      await alert(t('containers.configImageRequired'))
      return
    }
    setSubmitting(true)
    try {
      const res = await window.dockerDesktop.recreateContainer({
        containerId,
        image: image.trim(),
        name: name.trim() || undefined,
        envText,
        publishText,
        cmdText: cmdText.trim() || undefined,
        autoRemove,
        restartPolicy,
      })
      if (!res.ok) throw new Error(res.error)
      onRecreated(res.data.id)
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
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-container-config-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-container-config-title" className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {t('containers.configRecreateTitle')}
        </h2>
        <p className="mb-3 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200/90">
          {t('containers.configHint')}
        </p>
        {loadErr ? (
          <p className="mb-3 text-[11px] text-rose-700 dark:text-rose-300">{loadErr}</p>
        ) : null}
        <div className="flex flex-col gap-2.5">
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('create.image')} *
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              disabled={!!loadErr}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('create.name')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!loadErr}
              placeholder={t('create.namePlaceholder')}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('create.publish')}
            <input
              value={publishText}
              onChange={(e) => setPublishText(e.target.value)}
              disabled={!!loadErr}
              placeholder="8080:80"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('create.env')}
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              disabled={!!loadErr}
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
              disabled={!!loadErr}
              placeholder={t('create.cmdPlaceholder')}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <RestartPolicyField
            value={restartPolicy}
            disabled={!!loadErr || autoRemove}
            onChange={(v) => setRestartPolicy(v)}
          />
          <label className="flex items-center gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={autoRemove}
              disabled={!!loadErr}
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
            disabled={submitting || !!loadErr || !image.trim()}
            onClick={() => void submit()}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {submitting ? t('common.loading') : t('containers.configSubmit')}
          </button>
        </div>
      </div>
    </div>
  )
}
