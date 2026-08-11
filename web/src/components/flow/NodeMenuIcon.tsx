import { FileUp, Globe, Layers3, Library, Sparkles, StickyNote, type LucideIcon } from 'lucide-react'

type NodeMenuIconKind = 'ai' | 'content' | 'browser' | 'sticky' | 'library' | 'import'

const menuIconVisuals: Record<NodeMenuIconKind, { icon: LucideIcon; iconClass: string }> = {
  ai: { icon: Sparkles, iconClass: 'text-violet-500' },
  content: { icon: Layers3, iconClass: 'text-blue-500' },
  browser: { icon: Globe, iconClass: 'text-cyan-600' },
  sticky: { icon: StickyNote, iconClass: 'text-amber-500' },
  library: { icon: Library, iconClass: 'text-emerald-500' },
  import: { icon: FileUp, iconClass: 'text-orange-500' },
}

export function NodeMenuIcon({ kind, compact = false }: { kind: NodeMenuIconKind; compact?: boolean }) {
  const visual = menuIconVisuals[kind]
  const Icon = visual.icon
  return <span className={`flex shrink-0 items-center justify-center ${compact ? 'h-6 w-6' : 'h-7 w-7'}`}><Icon className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${visual.iconClass}`} /></span>
}
