/** 从 inspect JSON 提取用于摘要展示的结构。 */

export type InspectMountRow = { type?: string; name?: string; source?: string; destination?: string }

export function extractInspectMounts(ins: Record<string, unknown>): InspectMountRow[] {
  const mounts = ins.Mounts
  if (!Array.isArray(mounts)) return []
  return mounts.map((m) => {
    const o = m as Record<string, unknown>
    return {
      type: typeof o.Type === 'string' ? o.Type : undefined,
      name: typeof o.Name === 'string' ? o.Name : undefined,
      source: typeof o.Source === 'string' ? o.Source : undefined,
      destination: typeof o.Destination === 'string' ? o.Destination : undefined,
    }
  })
}

export function extractInspectNetworkNames(ins: Record<string, unknown>): string[] {
  const ns = ins.NetworkSettings as Record<string, unknown> | undefined
  const nets = ns?.Networks as Record<string, unknown> | undefined
  if (!nets || typeof nets !== 'object') return []
  return Object.keys(nets).sort()
}

export function extractInspectLabels(ins: Record<string, unknown>): { key: string; value: string }[] {
  const cfg = ins.Config as Record<string, unknown> | undefined
  const labels = cfg?.Labels as Record<string, string> | undefined
  if (!labels || typeof labels !== 'object') return []
  return Object.entries(labels)
    .map(([key, value]) => ({ key, value: String(value ?? '') }))
    .sort((a, b) => a.key.localeCompare(b.key))
}
