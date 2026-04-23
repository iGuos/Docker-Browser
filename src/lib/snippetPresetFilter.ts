/** Dockerfile 等「单行/关键词」模板的筛选（与 docker run 工具+版本分离） */

export type SnippetPreset = {
  id: string
  titleZh: string
  titleEn: string
  keywords: string
  code: string
}

export function getSnippetTitle(p: SnippetPreset, lang: string): string {
  return (lang ?? '').toLowerCase().startsWith('zh') ? p.titleZh : p.titleEn
}

function tokenMatches(haystack: string, token: string): boolean {
  if (!token) return true
  if (haystack.includes(token)) return true
  let from = 0
  for (const ch of token) {
    const i = haystack.indexOf(ch, from)
    if (i === -1) return false
    from = i + 1
  }
  return true
}

export function filterSnippetPresets(
  presets: readonly SnippetPreset[],
  query: string,
  lang: string,
): SnippetPreset[] {
  const raw = query.trim().toLowerCase()
  if (!raw) return [...presets]
  const titleLang = (lang ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const tokens = raw.split(/\s+/).filter(Boolean)

  return presets.filter((p) => {
    const title = (titleLang === 'zh' ? p.titleZh : p.titleEn).toLowerCase()
    const haystack = `${title} ${p.keywords.toLowerCase()} ${p.id.toLowerCase()}`
    return tokens.every((tok) => tokenMatches(haystack, tok))
  })
}
