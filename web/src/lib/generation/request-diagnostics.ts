export interface GenerationRequestDiagnostics {
  fields: string[]
  unknownRetentionCount?: number
  durationField?: string
  duration?: number
  resolution?: string
  aspectRatio?: string
  mode?: string
  references: Array<{ type: 'image' | 'video' | 'audio'; transport: 'inline' | 'http' | 'https' | 'other'; role?: string }>
}

export function mediaRequestDetails(diagnostics: GenerationRequestDiagnostics) {
  return [
    `提交模式：${diagnostics.mode || (diagnostics.fields.includes('mode') ? '旧记录未保存 mode 值' : '未发送 mode，由渠道素材字段决定')}`,
    `请求字段：${diagnostics.fields.join(', ')}`,
    `素材角色：${diagnostics.references.map(reference => reference.role || `${reference.type}（旧记录未保存角色）`).join(', ') || '无'}`,
    '不包含密钥、提示词或素材地址；客户端检查不保证上游正确解析。',
  ].join('\n')
}

export function mediaRequestSummary(diagnostics: GenerationRequestDiagnostics) {
  const counts = { image: 0, video: 0, audio: 0 }
  diagnostics.references.forEach(reference => { if (reference.transport === 'https' || reference.transport === 'http') counts[reference.type]++ })
  const total = counts.image + counts.video + counts.audio
  const media = [
    counts.image > 0 ? `图片${counts.image}` : '',
    counts.video > 0 ? `视频${counts.video}` : '',
    counts.audio > 0 ? `音频${counts.audio}` : '',
  ].filter(Boolean)
  return `请求携带 URL ${total}${media.length ? '·含' + media.join('·') : ''}`
}

export function parseRequestDiagnostics(value: unknown): GenerationRequestDiagnostics | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.fields) || !Array.isArray(record.references)) return undefined
  const result: GenerationRequestDiagnostics = {
    fields: record.fields.filter((field): field is string => typeof field === 'string').slice(0, 32).map(field => field.slice(0, 64)),
    references: record.references.slice(0, 64).flatMap(reference => {
      if (!reference || typeof reference !== 'object') return []
      const { type, transport, role } = reference as Record<string, unknown>
      if (type !== 'image' && type !== 'video' && type !== 'audio') return []
      if (transport !== 'inline' && transport !== 'http' && transport !== 'https' && transport !== 'other') return []
      return [{ type, transport, ...(typeof role === 'string' && ['reference_image', 'reference_video', 'reference_audio', 'reference_voice', 'first_frame', 'last_frame'].includes(role) ? { role } : {}) }]
    }),
  }
  if (typeof record.mode === 'string' && ['auto', 'text-to-video', 'image-to-video', 'reference-to-video', 'start-end-to-video', 'edit-video', 'video-extension'].includes(record.mode)) result.mode = record.mode
  for (const field of ['durationField', 'resolution', 'aspectRatio'] as const) {
    if (typeof record[field] === 'string') result[field] = record[field].slice(0, 64)
  }
  if (typeof record.duration === 'number' && Number.isFinite(record.duration)) result.duration = record.duration
  if (typeof record.unknownRetentionCount === 'number' && Number.isInteger(record.unknownRetentionCount) && record.unknownRetentionCount >= 0) result.unknownRetentionCount = Math.min(64, record.unknownRetentionCount)
  return result
}
