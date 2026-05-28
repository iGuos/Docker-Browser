const SENSITIVE_KEY =
  /password|passwd|secret|token|apikey|api_key|authorization|(^|_)auth($|_)/i

/** 用于界面展示的 JSON 脱敏（浅层键名匹配，不解析嵌套路径）。 */
export function redactSensitiveJson(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => redactSensitiveJson(v))
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) {
      if (SENSITIVE_KEY.test(k)) out[k] = '***'
      else out[k] = redactSensitiveJson(v)
    }
    return out
  }
  return value
}
