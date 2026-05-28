/** 与 Engine `HostConfig.RestartPolicy.Name` 一致的可选值 */
export const RESTART_POLICY_NAMES = ['no', 'always', 'unless-stopped', 'on-failure'] as const
export type RestartPolicyName = (typeof RESTART_POLICY_NAMES)[number]

export function isRestartPolicyName(s: string): s is RestartPolicyName {
  return (RESTART_POLICY_NAMES as readonly string[]).includes(s)
}

export function normalizeRestartPolicyName(raw: string | undefined | null): RestartPolicyName {
  const n = (raw ?? '').trim().toLowerCase()
  return isRestartPolicyName(n) ? n : 'no'
}

/** 写入 `HostConfig.RestartPolicy`；`on-failure` 带默认重试次数 */
export function restartPolicyToDocker(
  name: RestartPolicyName,
): { Name: string; MaximumRetryCount?: number } {
  if (name === 'on-failure') return { Name: 'on-failure', MaximumRetryCount: 5 }
  if (name === 'no') return { Name: 'no' }
  return { Name: name, MaximumRetryCount: 0 }
}
