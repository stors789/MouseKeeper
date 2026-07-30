const WHITESPACE_PATTERN = /\s+/gu
const WORD_SPLIT_PATTERN = /[^\p{L}\p{N}_-]+/gu

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(WHITESPACE_PATTERN, ' ')
    .toLocaleLowerCase('und')
}

export function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  if (value == null) {
    return undefined
  }
  const normalized = normalizeText(value)
  return normalized.length > 0 ? normalized : undefined
}

export function makeActiveKey(
  prefix: string,
  value: string | null | undefined
): string | undefined {
  const normalized = normalizeOptionalText(value)
  return normalized ? `${prefix}:${normalized}` : undefined
}

export function makeCompositeKey(
  prefix: string,
  ...parts: readonly (string | null | undefined)[]
): string | undefined {
  const normalizedParts = parts.map(normalizeOptionalText)
  if (normalizedParts.some(part => part === undefined)) {
    return undefined
  }
  return `${prefix}:${normalizedParts.join('\u001f')}`
}

export function buildSearchTerms(
  values: readonly (string | null | undefined)[],
  limit = 64
): string[] {
  const terms = new Set<string>()
  for (const value of values) {
    const normalized = normalizeOptionalText(value)
    if (!normalized) {
      continue
    }

    terms.add(normalized)
    for (const token of normalized.split(WORD_SPLIT_PATTERN)) {
      if (token.length > 0) {
        terms.add(token)
      }
      if (terms.size >= limit) {
        return [...terms]
      }
    }
  }
  return [...terms].slice(0, limit)
}

export function mouseDisplayLabel(mouse: {
  earTag?: string
  experimentNumber?: string
  name?: string
  alias?: string
  id: string
}): string {
  return (
    mouse.earTag ??
    mouse.experimentNumber ??
    mouse.name ??
    mouse.alias ??
    mouse.id
  )
}

