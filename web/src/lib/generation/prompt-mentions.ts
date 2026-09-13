import type { GenerationReference } from '@/types/flow'

export type PromptMentionContext = {
  start: number
  end: number
  query: string
}

export type PromptMentionMap = Record<string, string>

const TYPE_PREFIXES: Record<GenerationReference['type'], string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
}

export function getPromptMentionContext(prompt: string, caret: number): PromptMentionContext | null {
  const safeCaret = Math.max(0, Math.min(caret, prompt.length))
  const beforeCaret = prompt.slice(0, safeCaret)
  const atIndex = beforeCaret.lastIndexOf('@')
  if (atIndex < 0) return null

  const previousCharacter = prompt.charAt(atIndex - 1)
  if (previousCharacter && /[A-Za-z0-9_]/.test(previousCharacter)) return null

  const query = beforeCaret.slice(atIndex + 1)
  if (/[^\p{L}\p{N}_-]/u.test(query)) return null
  return { start: atIndex, end: safeCaret, query }
}

export function getPromptMentionToken(reference: GenerationReference, references: GenerationReference[], promptMentions: PromptMentionMap = {}) {
  const storedToken = promptMentions[reference.id]
  if (storedToken) return storedToken
  const sameTypeIndex = references.filter((item) => item.type === reference.type).findIndex((item) => item.id === reference.id)
  const usedTokens = new Set(Object.entries(promptMentions).filter(([referenceId]) => referenceId !== reference.id).map(([, token]) => token))
  let ordinal = Math.max(0, sameTypeIndex) + 1
  let token = `@${TYPE_PREFIXES[reference.type]}${ordinal}`
  while (usedTokens.has(token)) {
    ordinal += 1
    token = `@${TYPE_PREFIXES[reference.type]}${ordinal}`
  }
  return token
}

export function filterPromptMentionReferences(references: GenerationReference[], query: string, promptMentions: PromptMentionMap = {}) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return references
  return references.filter((reference) => {
    const token = getPromptMentionToken(reference, references, promptMentions)
    return [token, reference.label, reference.fileName]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  })
}

export function replacePromptMention(prompt: string, context: PromptMentionContext, token: string) {
  return `${prompt.slice(0, context.start)}${token}${prompt.slice(context.end)}`
}

export function removePromptMention(prompt: string, token: string, placeholder: string) {
  if (!token) return prompt
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return prompt.replace(new RegExp(`${escapedToken}(?![\\p{L}\\p{N}_-])`, 'gu'), placeholder)
}
