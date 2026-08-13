export type AIImageInput =
  | { kind: 'url'; url: string }
  | { kind: 'base64'; mediaType: string; data: string }

export type AIContextEntry = { nodeId: string; label: string; text: string; images?: AIImageInput[] }

const AI_VARIABLE_PATTERN = /\{\{node:([A-Za-z0-9_-]+)\}\}/g

export function aiVariableToken(nodeId: string) {
  return `{{node:${nodeId}}}`
}

export function aiPromptVariableIds(prompt: string) {
  return [...prompt.matchAll(AI_VARIABLE_PATTERN)].map((match) => match[1])
}

export function hasAiPromptVariables(prompt: string) {
  return aiPromptVariableIds(prompt).length > 0
}

export function promptHasUsableContent(prompt: string) {
  return Boolean(prompt.replace(AI_VARIABLE_PATTERN, '').trim()) || hasAiPromptVariables(prompt)
}

function contextBlock(entry: AIContextEntry) {
  return `[${entry.label}]\n${entry.text}\n[/${entry.label}]`
}

function appendEntryParts(parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: AIImageInput }>, entry: AIContextEntry) {
  const block = contextBlock(entry)
  if (block.trim()) parts.push({ type: 'text', text: block })
  entry.images?.forEach((image) => parts.push({ type: 'image', image }))
}

/** Compiles a prompt into text and image parts for multimodal model requests. */
export function compileAiPromptParts(prompt: string, entries: AIContextEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.nodeId, entry]))
  const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: AIImageInput }> = []
  const pushText = (text: string) => {
    if (text) parts.push({ type: 'text', text })
  }
  const matches = [...prompt.matchAll(AI_VARIABLE_PATTERN)]
  if (matches.length) {
    let cursor = 0
    matches.forEach((match) => {
      const index = match.index || 0
      pushText(prompt.slice(cursor, index))
      const entry = byId.get(match[1])
      if (entry) appendEntryParts(parts, entry)
      else pushText(`[${'未连接变量'}]`)
      cursor = index + match[0].length
    })
    pushText(prompt.slice(cursor))
  } else {
    pushText(prompt.trim())
    entries.filter((entry) => entry.text.trim() || entry.images?.length).forEach((entry) => {
      if (parts.length) pushText('\n\n')
      appendEntryParts(parts, entry)
    })
  }
  return parts
}

/**
 * Variables make an upstream value explicit and positional. Without a variable,
 * connected inputs remain an implicit suffix to the author's instruction.
 */
export function compileAiPrompt(prompt: string, entries: AIContextEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.nodeId, entry]))
  if (hasAiPromptVariables(prompt)) {
    return prompt.replace(AI_VARIABLE_PATTERN, (_match, nodeId: string) => {
      const entry = byId.get(nodeId)
      return entry?.text.trim() ? contextBlock(entry) : `[${entry?.label || '未连接变量'}]`
    }).trim()
  }

  const implicitContext = entries
    .filter((entry) => entry.text.trim())
    .map(contextBlock)
    .join('\n\n')
  return [prompt.trim(), implicitContext].filter(Boolean).join('\n\n')
}
