import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { UpstreamInput } from '@/lib/flow/upstream-inputs'

function inputStatus(input: UpstreamInput) {
  if (input.availability === 'url-only') return '仅网址'
  if (input.availability === 'empty') return '暂无输出'
  if (input.availability === 'unsupported') return '不支持文本输入'
  return ''
}

export function UpstreamInputChips({ inputs, targetLabel }: { inputs: readonly UpstreamInput[]; targetLabel: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const textInputs = inputs.filter(input => input.text || input.resources.length === 0)
  const expanded = textInputs.find(input => input.nodeId === expandedId)
  if (!textInputs.length) return null
  return <div className="min-w-0 space-y-1 pb-1" data-upstream-inputs>
    <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
      {textInputs.map(input => <div key={input.nodeId} className="inline-flex max-w-full items-center rounded-full bg-muted text-[10px] text-muted-foreground">
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-1 hover:text-foreground"
          aria-label={`预览上游 ${input.label}`}
          aria-expanded={expandedId === input.nodeId}
          title={`${input.label} → ${targetLabel}${input.edgeIds.length ? ` · ${input.edgeIds.join(', ')}` : ''}`}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => setExpandedId(current => current === input.nodeId ? null : input.nodeId)}
        >
          <span className="truncate">{input.label}{inputStatus(input) ? ` · ${inputStatus(input)}` : ''}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </div>)}
    </div>
    {expanded && <div role="region" aria-label={`上游内容 ${expanded.label}`} className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words px-2 py-1 text-xs text-muted-foreground" onPointerDown={event => event.stopPropagation()}>
      {expanded.text || inputStatus(expanded)}
    </div>}
  </div>
}
