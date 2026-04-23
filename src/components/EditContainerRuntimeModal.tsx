import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalEscape } from '@/hooks/useModalEscape'
import { normalizeRestartPolicyName, type RestartPolicyName } from '@shared/restartPolicy'
import { RestartPolicyField } from '@/components/RestartPolicyField'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { formatThrownEngineError } from '@/lib/alertMessage'

type Props = {
  open: boolean
  containerId: string
  onClose: () => void
  onSaved: () => void
}

export function EditContainerRuntimeModal({ open, containerId, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const { alert } = useAppDialog()
  const [name, setName] = useState('')
  const [autoRemove, setAutoRemove] = useState(false)
  const [restartPolicy, setRestartPolicy] = useState<RestartPolicyName>('no')
  const [memoryMbStr, setMemoryMbStr] = useState('')
  const [cpusStr, setCpusStr] = useState('')
  const [pidsStr, setPidsStr] = useState('')
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
      const hc = ins.HostConfig as Record<string, unknown> | undefined
      setName(typeof ins.Name === 'string' ? ins.Name.replace(/^\//, '') : '')
      setAutoRemove(hc?.AutoRemove === true)
      const rp = hc?.RestartPolicy as { Name?: string } | undefined
      setRestartPolicy(normalizeRestartPolicyName(typeof rp?.Name === 'string' ? rp.Name : undefined))
      let memStr = ''
      if (typeof hc?.Memory === 'number' && hc.Memory > 0) {
        memStr = String(Math.round(hc.Memory / 1024 / 1024))
      }
      setMemoryMbStr(memStr)
      const nano = typeof hc?.NanoCpus === 'number' && hc.NanoCpus > 0 ? hc.NanoCpus / 1e9 : 0
      setCpusStr(nano > 0 ? String(nano) : '')
      const pl = typeof hc?.PidsLimit === 'number' && hc.PidsLimit > 0 ? hc.PidsLimit : ''
      setPidsStr(pl === '' ? '' : String(pl))
    })
  }, [open, containerId])

  useModalEscape(open, onClose)

  if (!open) return null

  const submit = async () => {
    const patch: {
      containerId: string
      name: string
      restartPolicy: RestartPolicyName
      memoryMb?: number
      cpus?: number
      pidsLimit?: number
    } = {
      containerId,
      name: name.trim(),
      restartPolicy,
    }
      if (memoryMbStr.trim()) {
      const v = Number(memoryMbStr.trim())
      if (!Number.isFinite(v) || v < 0) {
        await alert(t('containers.badNumber'))
        return
      }
      patch.memoryMb = v
    }
    if (cpusStr.trim()) {
      const v = Number(cpusStr.trim())
      if (!Number.isFinite(v) || v < 0) {
        await alert(t('containers.badNumber'))
        return
      }
      patch.cpus = v
    }
    if (pidsStr.trim()) {
      const v = Number(pidsStr.trim())
      if (!Number.isFinite(v) || v < 0) {
        await alert(t('containers.badNumber'))
        return
      }
      patch.pidsLimit = Math.floor(v)
    }
    setSubmitting(true)
    try {
      const res = await window.dockerDesktop.patchContainerRuntime(patch)
      if (!res.ok) throw new Error(res.error)
      onSaved()
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
      aria-labelledby="edit-container-runtime-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="edit-container-runtime-title"
          className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50"
        >
          {t('containers.configRuntimeTitle')}
        </h2>
        <p className="mb-3 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t('containers.configRuntimeHint')}
        </p>
        <p className="mb-3 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-500">
          {t('containers.runtimeResourceHint')}
        </p>
        {loadErr ? (
          <p className="mb-3 text-[11px] text-rose-700 dark:text-rose-300">{loadErr}</p>
        ) : null}
        <div className="flex flex-col gap-2.5">
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
          <RestartPolicyField
            value={restartPolicy}
            onChange={setRestartPolicy}
            disabled={autoRemove}
          />
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('containers.memoryMb')}
            <input
              value={memoryMbStr}
              onChange={(e) => setMemoryMbStr(e.target.value)}
              disabled={!!loadErr}
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('containers.cpus')}
            <input
              value={cpusStr}
              onChange={(e) => setCpusStr(e.target.value)}
              disabled={!!loadErr}
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('containers.pidsLimit')}
            <input
              value={pidsStr}
              onChange={(e) => setPidsStr(e.target.value)}
              disabled={!!loadErr}
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!!loadErr || submitting}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {submitting ? t('common.loading') : t('containers.configRuntimeSubmit')}
          </button>
        </div>
      </div>
    </div>
  )
}
