/** 从 `docker inspect` JSON 的 HostConfig.PortBindings 或 NetworkSettings.Ports 还原端口映射文本（与创建表单一致） */

function linesFromPortBindings(
  pb: Record<string, { HostIp?: string; HostPort?: string }[] | null | undefined>,
): string {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const [key, hosts] of Object.entries(pb)) {
    const km = key.match(/^(\d+)\/(tcp|udp)$/i)
    if (!km || !Array.isArray(hosts)) continue
    const priv = km[1]
    const typ = km[2].toLowerCase()
    const suffix = typ === 'tcp' ? '' : `/${typ}`
    for (const h of hosts) {
      if (!h?.HostPort) continue
      const hip = (h.HostIp ?? '').trim()
      const defaultIp =
        !hip || hip === '0.0.0.0' || hip === '::' || hip === '[::]' || hip === '::/0'
      const line = defaultIp ? `${h.HostPort}:${priv}${suffix}` : `${hip}:${h.HostPort}:${priv}${suffix}`
      if (seen.has(line)) continue
      seen.add(line)
      lines.push(line)
    }
  }
  return lines.join('\n')
}

export function inspectJsonToPublishText(ins: unknown): string {
  if (!ins || typeof ins !== 'object') return ''
  const o = ins as Record<string, unknown>
  const hc = o.HostConfig as Record<string, unknown> | undefined
  const pb = hc?.PortBindings as Record<string, { HostIp?: string; HostPort?: string }[] | null> | undefined
  if (pb && typeof pb === 'object' && Object.keys(pb).length > 0) {
    return linesFromPortBindings(pb)
  }
  const ns = o.NetworkSettings as Record<string, unknown> | undefined
  const np = ns?.Ports as Record<string, { HostIp?: string; HostPort?: string }[] | null> | undefined
  if (np && typeof np === 'object' && Object.keys(np).length > 0) {
    return linesFromPortBindings(np)
  }
  return ''
}
