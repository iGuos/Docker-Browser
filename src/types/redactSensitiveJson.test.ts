import { describe, expect, it } from 'vitest'
import { redactSensitiveJson } from './redactSensitiveJson'

describe('redactSensitiveJson', () => {
  it('masks common secret keys', () => {
    const o = {
      user: 'x',
      apiToken: 'hide-me',
      nested: { Password: 'p' },
      ok: 1,
    }
    const r = redactSensitiveJson(o) as Record<string, unknown>
    expect(r.user).toBe('x')
    expect(r.apiToken).toBe('***')
    expect((r.nested as Record<string, unknown>).Password).toBe('***')
    expect(r.ok).toBe(1)
  })
})
