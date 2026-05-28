export const LANGUAGE_STORAGE_KEY = 'docker-browser-language'

export type AppLanguage = 'en' | 'zh-CN'

export function parseAppLanguage(raw: string | null): AppLanguage | null {
  if (raw === 'en' || raw === 'zh-CN') return raw
  return null
}

export function getDefaultAppLanguage(): AppLanguage {
  return 'zh-CN'
}
