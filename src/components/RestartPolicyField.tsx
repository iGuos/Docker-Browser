import { useTranslation } from 'react-i18next'
import { RESTART_POLICY_NAMES, type RestartPolicyName } from '@/types/restartPolicy'

type Props = {
  value: RestartPolicyName
  onChange: (v: RestartPolicyName) => void
  disabled?: boolean
}

const optionLabelKey: Record<RestartPolicyName, string> = {
  no: 'create.restartPolicyNo',
  always: 'create.restartPolicyAlways',
  'unless-stopped': 'create.restartPolicyUnlessStopped',
  'on-failure': 'create.restartPolicyOnFailure',
}

export function RestartPolicyField({ value, onChange, disabled }: Props) {
  const { t } = useTranslation()
  return (
    <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
      <span className="block">{t('create.restartPolicyLabel')}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as RestartPolicyName)}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
      >
        {RESTART_POLICY_NAMES.map((id) => (
          <option key={id} value={id}>
            {t(optionLabelKey[id])}
          </option>
        ))}
      </select>
      {disabled ? (
        <span className="mt-1 block text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
          {t('create.restartPolicyDisabledHint')}
        </span>
      ) : null}
    </label>
  )
}
