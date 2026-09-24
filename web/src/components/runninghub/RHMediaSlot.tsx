import { useEffect, useRef, useState } from 'react'
import { Image, Mic, Video, X } from 'lucide-react'
import type { GenerationReference } from '@/types/flow'
import type { RHField } from '@/lib/runninghub/workflow'
import { AssetManager } from '@/runtime/asset-manager'

export function RHMediaSlot({ field, reference, disabled, onUpload, onRemove }: {
  field: RHField; reference?: GenerationReference; disabled: boolean
  onUpload: (file: File) => void; onRemove?: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    const fallback = reference?.previewUrl || reference?.url || ''
    setUrl(fallback)
    const id = reference?.id.startsWith('asset-') ? reference.id : reference?.resourceId?.startsWith('sha256-') ? `asset-${reference.resourceId.slice(7)}` : undefined
    if (id) void new AssetManager().resolveAssetUrl(id).then(value => { if (!cancelled) setUrl(value || fallback) }).catch(() => {})
    return () => { cancelled = true }
  }, [reference?.id, reference?.resourceId, reference?.previewUrl, reference?.url])
  const Icon = field.inputType === 'image' ? Image : field.inputType === 'video' ? Video : Mic
  return <div className="group relative h-14 w-14 shrink-0" title={reference ? `${field.label}：${reference.label || '已添加'}${reference.upstreamNodeId ? '（上游素材，断开连线可移除）' : ''}` : `添加${field.label}${field.required ? '（必填）' : ''}`}>
    <button type="button" aria-label={reference ? `${field.label}已添加` : `添加${field.label}`} disabled={disabled || Boolean(reference)} onClick={() => input.current?.click()} className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border text-muted-foreground ${reference ? 'border-border bg-muted' : 'border-dashed border-border bg-muted/30 hover:bg-muted'}`}>
      {reference && url && field.inputType === 'image' ? <img src={url} alt={field.label} className="h-full w-full object-cover" draggable={false} /> : reference && url && field.inputType === 'video' ? <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <Icon className="h-4 w-4" />}
    </button>
    {reference && onRemove && <button type="button" title="移除素材" aria-label={`移除${field.label}`} disabled={disabled} onClick={onRemove} className="absolute -right-1 -top-1 rounded-full border border-border bg-card p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100"><X className="h-3 w-3" /></button>}
    <input ref={input} type="file" className="hidden" accept={`${field.inputType}/*`} disabled={disabled || Boolean(reference)} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUpload(file) }} />
  </div>
}
