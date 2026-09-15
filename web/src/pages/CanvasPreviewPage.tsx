/**
 * 新画布引擎临时验证入口。
 * 不接入 App.tsx 路由；阶段 7 再接正式路由。
 * 只读旧图并在新引擎里渲染，不改旧 store / 旧 UI。
 */

import { useEffect } from 'react'
import { nanoid } from 'nanoid'
import type { FlowDocument, NodeSpec } from '@/domain'
import { CanvasViewport } from '@/canvas/components'
import { AIContent, BrowserContent, ContentContent, RequestContent, StickyContent } from '@/canvas/contents'
import { listDocuments } from '@/storage'
import { useGraphStore } from '@/stores/graph-store'
import { migrateLegacyFlows } from '@/runtime/legacy-loader'

function createPreviewDocument(): FlowDocument {
  const now = Date.now()
  return {
    id: nanoid(),
    name: '新画布预览',
    title: '新画布预览',
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      {
        id: nanoid(),
        kind: 'sticky',
        position: { x: 200, y: 200 },
        size: { width: 320, height: 240 },
        label: '',
        content: '欢迎使用新画布',
        color: 'yellow',
        background: 'solid',
      },
      {
        id: nanoid(),
        kind: 'browser',
        position: { x: 600, y: 200 },
        size: { width: 760, height: 520 },
        label: '',
        url: 'https://www.google.com/',
      },
    ],
    edges: [],
    createdAt: now,
    updatedAt: now,
  }
}

function renderNodeContent(node: NodeSpec) {
  switch (node.kind) {
    case 'sticky':
      return <StickyContent node={node} />
    case 'browser':
      return <BrowserContent node={node} />
    case 'ai':
      return <AIContent node={node} />
    case 'request':
      return <RequestContent node={node} />
    case 'content':
      return <ContentContent node={node} />
    case 'group':
      return null
    default:
      return null
  }
}

export default function CanvasPreviewPage() {
  const currentDocument = useGraphStore((state) => state.currentDocument)

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const openFirst = async (): Promise<boolean> => {
        const docs = await listDocuments()
        if (cancelled) return true
        const first = docs[0]
        if (first) {
          useGraphStore.getState().openDocument(first)
          return true
        }
        return false
      }

      try {
        if (await openFirst()) return
        await migrateLegacyFlows()
        if (cancelled) return
        if (await openFirst()) return
        if (cancelled) return
        useGraphStore.getState().openDocument(createPreviewDocument())
      } catch {
        if (!cancelled && !useGraphStore.getState().currentDocument) {
          useGraphStore.getState().openDocument(createPreviewDocument())
        }
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      {currentDocument == null ? (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          正在加载画布…
        </div>
      ) : (
        <>
          <div className="absolute left-2 top-2 z-50 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
            新画布引擎预览 · 只读验证 · {currentDocument.name}
          </div>
          <CanvasViewport className="h-full w-full">{renderNodeContent}</CanvasViewport>
        </>
      )}
    </div>
  )
}
