import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Layers,
  PanelLeft,
  PanelRightOpen,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Upload,
} from 'lucide-react'
import { addLibrarySource, addNodeAtViewportCenter, type AddableKind } from '@/canvas/node-factory'
import { documentToLegacyFlow } from '@/canvas/document-legacy'
import { NodeMenuIcon } from '@/canvas/components/NodeMenuIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Size } from '@/domain'
import { showMessage } from '@/lib/app-dialog'
import { getContentCategoryVisual } from '@/lib/content-visuals'
import { FlowBackupError, restoreFlowBackup, saveFlowBackup } from '@/lib/flow-backup'
import { openBlobFromFile, saveBlobToFile, safeFileName } from '@/lib/file-save'
import { retainLocalResource } from '@/lib/resource-storage'
import { migrateDocument } from '@/domain'
import { legacyFlowToDocument } from '@/runtime/legacy-loader'
import { createDocument, loadDocument } from '@/storage'
import { captureCanvasThumbnail } from '@/lib/flow/thumbnail'
import { listResumableDocumentRuns, requestResumeDocumentGeneration } from '@/canvas/contents/request-generation'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { useSourceStore } from '@/stores/use-source-store'
import { useTemplateStore } from '@/stores/use-template-store'
import { useUiStore } from '@/stores/ui-store'
import { canvasOverlayInsets, hasSafePanelToolbarSpacing, NODE_PANEL_INSET } from '@/canvas/overlay-insets'

export type SaveStatus = 'saved' | 'saving' | 'unsaved'

interface CanvasToolbarProps {
  containerSize: Size
  saveStatus: SaveStatus
  onSave: () => void | Promise<void>
  leftInset?: number
  rightInset?: number
}

export function CanvasToolbar({
  containerSize,
  saveStatus,
  onSave,
  leftInset = 0,
  rightInset = 0,
}: CanvasToolbarProps) {
  const navigate = useNavigate()
  const documentName = useGraphStore((state) => state.currentDocument?.name ?? '')
  const runs = useRuntimeStore((state) => state.runs)
  const showNodePanel = useUiStore((state) => state.showNodePanel)
  const showExtensionPanel = useUiStore((state) => state.showExtensionPanel)
  const extensionWidth = useUiStore((state) => state.extensionWidth)
  const sources = useSourceStore((state) => state.sources)
  const createTemplate = useTemplateStore((state) => state.createTemplate)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(documentName)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showLibrarySubmenu, setShowLibrarySubmenu] = useState(false)
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [templateCategory, setTemplateCategory] = useState('')
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [showExportFormatMenu, setShowExportFormatMenu] = useState(false)
  const [exportFormat, setExportFormat] = useState<'json' | 'png' | 'backup'>('json')
  const [resumeBusy, setResumeBusy] = useState(false)
  const [expandedGroupWidths, setExpandedGroupWidths] = useState({ left: 88, center: 128, right: 48, leftInset, rightInset })
  const [librarySubmenuLayout, setLibrarySubmenuLayout] = useState<{ maxHeight?: number; overflowY: 'visible' | 'auto' }>({
    overflowY: 'visible',
  })

  const addMenuRef = useRef<HTMLDivElement>(null)
  const leftGroupRef = useRef<HTMLDivElement>(null)
  const centerGroupRef = useRef<HTMLDivElement>(null)
  const rightGroupRef = useRef<HTMLDivElement>(null)
  const librarySubmenuRef = useRef<HTMLDivElement>(null)
  const exportFormatMenuRef = useRef<HTMLDivElement>(null)
  const libraryCloseTimerRef = useRef<number | null>(null)

  const libraryItems = useMemo(
    () => sources.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    [sources],
  )

  useEffect(() => {
    if (!editingTitle) setTitleDraft(documentName)
  }, [documentName, editingTitle])

  useEffect(() => {
    if (!showAddMenu) return
    const closeOnOutsideAction = (event: Event) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setShowAddMenu(false)
        setShowLibrarySubmenu(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideAction, true)
    document.addEventListener('keydown', closeOnOutsideAction, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideAction, true)
      document.removeEventListener('keydown', closeOnOutsideAction, true)
    }
  }, [showAddMenu])

  useEffect(() => () => {
    if (libraryCloseTimerRef.current !== null) window.clearTimeout(libraryCloseTimerRef.current)
  }, [])

  useEffect(() => {
    if (!showExportFormatMenu) return
    const closeExportFormatMenu = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof PointerEvent && exportFormatMenuRef.current?.contains(event.target as Node)) return
      setShowExportFormatMenu(false)
    }
    document.addEventListener('pointerdown', closeExportFormatMenu, true)
    document.addEventListener('keydown', closeExportFormatMenu, true)
    return () => {
      document.removeEventListener('pointerdown', closeExportFormatMenu, true)
      document.removeEventListener('keydown', closeExportFormatMenu, true)
    }
  }, [showExportFormatMenu])

  useLayoutEffect(() => {
    if (!showLibrarySubmenu || !librarySubmenuRef.current) return
    const measure = () => {
      const submenu = librarySubmenuRef.current
      if (!submenu) return
      const availableHeight = Math.max(120, window.innerHeight - submenu.getBoundingClientRect().top - 12)
      const needsScroll = submenu.scrollHeight > availableHeight + 1
      const nextLayout = needsScroll
        ? { maxHeight: availableHeight, overflowY: 'auto' as const }
        : { overflowY: 'visible' as const }
      setLibrarySubmenuLayout((current) => (
        current.maxHeight === nextLayout.maxHeight && current.overflowY === nextLayout.overflowY
          ? current
          : nextLayout
      ))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [libraryItems.length, showLibrarySubmenu])

  const viewportWidth = containerSize.width || window.innerWidth
  const layoutWidth = viewportWidth - leftInset - rightInset - 32
  const compactTitle = viewportWidth < 1100 || layoutWidth < 900
  const compactActions = viewportWidth < 950 || layoutWidth < 950
  const actionButtonClass = compactActions
    ? 'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-2 hover:bg-muted'
    : 'group relative flex h-10 w-10 shrink-0 items-center overflow-hidden rounded-full px-2 transition-all hover:w-[76px] hover:bg-muted'
  const actionLabelClass = compactActions
    ? 'hidden'
    : 'max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all group-hover:ml-1 group-hover:max-w-8 group-hover:opacity-100'
  const compactPanelToggles = viewportWidth < 300
  const expandedGroupCount = [expandedGroupWidths.left, expandedGroupWidths.center, expandedGroupWidths.right]
    .filter((width) => width > 0).length
  const expandedGroupsRequiredWidth =
    expandedGroupWidths.left + expandedGroupWidths.center + expandedGroupWidths.right + Math.max(0, expandedGroupCount - 1) * 40
  const compactCenter = viewportWidth < 380 || layoutWidth < expandedGroupsRequiredWidth
  const canOpenNodePanel = showNodePanel || hasSafePanelToolbarSpacing(
    viewportWidth, { left: NODE_PANEL_INSET, right: rightInset }, expandedGroupWidths,
  )
  const canOpenExtensionPanel = showExtensionPanel || hasSafePanelToolbarSpacing(
    viewportWidth,
    canvasOverlayInsets({ showNodePanel, showExtensionPanel: true, extensionWidth }),
    expandedGroupWidths,
  )

  useLayoutEffect(() => {
    const measure = () => {
      const leftWidth = leftGroupRef.current?.getBoundingClientRect().width || 0
      const centerWidth = centerGroupRef.current?.getBoundingClientRect().width || 0
      const rightWidth = rightGroupRef.current?.getBoundingClientRect().width || 0
      setExpandedGroupWidths((current) => {
        const next = {
          left: leftWidth || current.left,
          center: compactCenter ? current.center : centerWidth || current.center,
          right: rightWidth || current.right,
          leftInset,
          rightInset,
        }
        return next.left === current.left && next.center === current.center && next.right === current.right
          && next.leftInset === current.leftInset && next.rightInset === current.rightInset ? current : next
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (leftGroupRef.current) observer.observe(leftGroupRef.current)
    if (centerGroupRef.current) observer.observe(centerGroupRef.current)
    if (rightGroupRef.current) observer.observe(rightGroupRef.current)
    return () => observer.disconnect()
  }, [compactActions, compactCenter, compactPanelToggles, compactTitle, leftInset, rightInset])

  const hasResumableGeneration = listResumableDocumentRuns().length > 0

  useEffect(() => {
    if (expandedGroupWidths.leftInset !== leftInset || expandedGroupWidths.rightInset !== rightInset) return
    if (hasSafePanelToolbarSpacing(viewportWidth, { left: leftInset, right: rightInset }, expandedGroupWidths)) return
    if (showNodePanel) useUiStore.getState().setShowNodePanel(false)
    else if (showExtensionPanel) useUiStore.getState().setShowExtensionPanel(false)
  }, [expandedGroupWidths, leftInset, rightInset, viewportWidth, showNodePanel, showExtensionPanel])
  const showResumeButton = hasResumableGeneration
  const resumeRunning = Object.values(runs).some((run) => run.status === 'running' || run.status === 'validating' || run.status === 'queued')

  const inset = { left: leftInset, right: rightInset }

  const commitTitle = () => {
    const title = titleDraft.trim() || '未命名画布'
    const doc = useGraphStore.getState().currentDocument
    if (doc && (doc.name !== title || doc.title !== title)) {
      useGraphStore.setState({
        currentDocument: { ...doc, name: title, title, updatedAt: Date.now() },
      })
    }
    setEditingTitle(false)
  }

  const addKind = (kind: AddableKind) => {
    addNodeAtViewportCenter(kind, containerSize, inset)
    setShowAddMenu(false)
    setShowLibrarySubmenu(false)
  }

  const handleBack = () => {
    void Promise.resolve(onSave()).then(
      () => navigate('/dashboard'),
      () => undefined,
    )
  }

  const handleSaveAsTemplate = () => {
    const doc = useGraphStore.getState().currentDocument
    if (!doc || doc.nodes.length === 0) {
      showMessage('当前画布没有可保存为模板的节点。')
      return
    }
    setTemplateTitle(doc.name)
    setTemplateDescription(doc.description || '')
    setShowTemplateDialog(true)
  }

  const handleCreateTemplate = () => {
    const doc = useGraphStore.getState().currentDocument
    if (!doc || !templateTitle.trim()) return
    const legacy = documentToLegacyFlow(doc)
    createTemplate(
      templateTitle.trim(),
      templateDescription.trim(),
      legacy.nodes,
      legacy.edges,
      templateCategory.trim() || undefined,
    )
    setShowTemplateDialog(false)
  }

  const handleExportConfirm = async () => {
    const doc = useGraphStore.getState().currentDocument
    if (!doc) return
    try {
      if (exportFormat === 'backup') {
        await saveFlowBackup(documentToLegacyFlow(doc))
      } else if (exportFormat === 'png') {
        const thumbnail = await captureCanvasThumbnail({ format: 'png' })
        if (!thumbnail) {
          showMessage('无法生成画布 PNG，请稍后重试。')
          return
        }
        const blob = await fetch(thumbnail).then((response) => response.blob())
        await saveBlobToFile(blob, `${safeFileName(doc.name, 'flow')}.png`, {
          description: 'Cnote 画布 PNG',
          extension: '.png',
        })
      } else {
        const blob = new Blob([JSON.stringify(documentToLegacyFlow(doc), null, 2)], { type: 'application/json' })
        await saveBlobToFile(blob, `${safeFileName(doc.name, 'flow')}.json`, {
          description: 'Cnote Flow JSON',
          extension: '.json',
        })
      }
      setShowExportDialog(false)
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '导出失败，请稍后重试。')
    }
  }

  const handleResumeTask = async () => {
    if (resumeBusy || resumeRunning) return
    setResumeBusy(true)
    try {
      const result = requestResumeDocumentGeneration()
      if (result.count === 0) {
        showMessage('没有可继续的生成任务。')
      }
    } finally {
      setResumeBusy(false)
    }
  }

  const handleImport = async () => {
    try {
      const file = await openBlobFromFile({
        title: '导入 Flow',
        extensions: ['json', 'zip', 'cnote.zip'],
      })
      if (!file) return
      const name = (file as File).name || ''
      if (name.endsWith('.zip') || file.type.includes('zip')) {
        const restored = await restoreFlowBackup(file)
        if (restored.flowId) {
          const loaded = await loadDocument(restored.flowId)
          if (loaded.ok) useGraphStore.getState().openDocument(loaded.doc)
        }
        if (restored.warnings.length) showMessage(restored.warnings.join('\n'))
        return
      }
      const parsed = JSON.parse(await file.text()) as unknown
      if (parsed && typeof parsed === 'object' && 'schemaVersion' in parsed) {
        const migrated = migrateDocument(parsed)
        await createDocument(migrated.payload)
        useGraphStore.getState().openDocument(migrated.payload)
        return
      }
      const document = legacyFlowToDocument(parsed as Parameters<typeof legacyFlowToDocument>[0])
      await createDocument(document)
      useGraphStore.getState().openDocument(document)
    } catch (error) {
      if (error instanceof FlowBackupError) {
        showMessage(error.message)
        return
      }
      showMessage(error instanceof Error ? error.message : '导入失败，请检查文件格式。')
    }
  }

  const addLibraryItem = async (item: (typeof libraryItems)[number]) => {
    const resource = item.nodeData.source
    if (resource?.kind === 'file' || resource?.kind === 'clipboard-image') {
      await retainLocalResource(resource.resourceId)
    }
    addLibrarySource(item, containerSize, inset)
    setShowLibrarySubmenu(false)
    setShowAddMenu(false)
  }

  const openNodePanel = () => {
    if (!canOpenNodePanel) return
    useUiStore.getState().setShowNodePanel(!showNodePanel)
  }

  const openExtensionPanel = () => {
    if (!canOpenExtensionPanel) return
    useUiStore.getState().setShowExtensionPanel(!showExtensionPanel)
  }

  return (
    <>
      <div
        data-canvas-chrome="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-50 flex min-h-16 items-center justify-between gap-3 px-4 py-2"
        style={{ paddingLeft: leftInset + 16, paddingRight: rightInset + 16 }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div ref={leftGroupRef} className="pointer-events-auto flex shrink-0 items-center gap-2">
          {!compactPanelToggles && (
            <Button
              variant="ghost"
              size="icon"
              disabled={!canOpenNodePanel}
              className="h-10 w-10 rounded-full bg-card shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
              title={canOpenNodePanel ? (showNodePanel ? '隐藏侧边栏' : '侧边栏') : '窗口宽度不足，无法打开侧边栏'}
              aria-label={showNodePanel ? '隐藏侧边栏' : '侧边栏'}
              aria-pressed={showNodePanel}
              onClick={openNodePanel}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-card shadow-sm"
            onClick={handleBack}
            title="返回控制台"
            aria-label="返回控制台"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          {compactTitle ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-full bg-card shadow-sm"
              title={`编辑画布名称：${documentName || '未命名画布'}`}
              aria-label="编辑画布名称"
              onClick={() => {
                setTitleDraft(documentName)
                setEditingTitle(true)
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          ) : (
            <div
              className="ml-1 min-w-[230px] rounded-full bg-card px-5 py-2 shadow-sm"
              onDoubleClick={() => {
                setTitleDraft(documentName)
                setEditingTitle(true)
              }}
            >
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  aria-label="画布名称"
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitTitle()
                    if (event.key === 'Escape') setEditingTitle(false)
                  }}
                  className="w-full bg-transparent text-sm font-semibold text-foreground outline-none"
                />
              ) : (
                <h1 className="truncate text-sm font-semibold text-foreground">{documentName || '未命名画布'}</h1>
              )}
              <p className={`truncate text-[10px] ${saveStatus === 'unsaved' ? 'text-amber-600' : saveStatus === 'saving' ? 'text-blue-600' : 'text-muted-foreground'}`}>
                {saveStatus === 'unsaved' ? '有更改未保存' : saveStatus === 'saving' ? '正在保存...' : '所有更改已保存'}
              </p>
            </div>
          )}
        </div>

          <div
            ref={(element) => {
              centerGroupRef.current = element
              addMenuRef.current = element
            }}
            className="pointer-events-auto relative flex shrink-0 items-center rounded-full bg-card p-1 shadow-sm"
          >
            <Button
              variant="ghost"
              className={compactCenter ? 'h-10 w-10 rounded-full p-2 text-muted-foreground' : 'group h-9 gap-1.5 rounded-full px-3 text-muted-foreground'}
              onClick={() => {
                setShowAddMenu((value) => {
                  if (value) setShowLibrarySubmenu(false)
                  return !value
                })
              }}
              title="添加节点"
              aria-label="添加节点"
              aria-pressed={showAddMenu}
            >
              <span className="flex items-center gap-0.5">
                <Plus className="h-[18px] w-[18px] stroke-[2.75] text-primary" />
                {!compactCenter && <ChevronDown className="h-3.5 w-3.5 stroke-[2.75] text-muted-foreground" />}
              </span>
              <span className={compactCenter ? 'hidden' : 'max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all group-hover:max-w-12 group-hover:opacity-100'}>
                添加
              </span>
            </Button>
            {!compactCenter && <><div className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              className="group h-9 gap-1.5 rounded-full px-3 text-muted-foreground"
              onClick={() => addKind('ai')}
              title="AI 节点"
              aria-label="新增 AI 节点"
            >
              <Sparkles className="h-4 w-4 text-violet-500" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all group-hover:max-w-16 group-hover:opacity-100">
                AI 节点
              </span>
            </Button>
            </>}
            {showAddMenu && (
              <div data-toolbar-add-menu role="menu" aria-label="新增节点" className="cnote-menu-surface absolute left-0 top-12 z-50 w-48">
                <button type="button" role="menuitem" className="cnote-menu-item" onClick={() => addKind('ai')}>
                  <NodeMenuIcon kind="ai" compact />
                  添加 AI 节点
                </button>
                <button type="button" role="menuitem" className="cnote-menu-item" onClick={() => addKind('content')}>
                  <NodeMenuIcon kind="content" compact />
                  添加内容节点
                </button>
                <button type="button" role="menuitem" className="cnote-menu-item" onClick={() => addKind('browser')}>
                  <NodeMenuIcon kind="browser" compact />
                  添加浏览器节点
                </button>
                <button type="button" role="menuitem" className="cnote-menu-item" onClick={() => addKind('request')}>
                  <NodeMenuIcon kind="request" compact />
                  添加请求体节点
                </button>
                <button type="button" role="menuitem" className="cnote-menu-item" onClick={() => addKind('sticky')}>
                  <NodeMenuIcon kind="sticky" compact />
                  添加贴纸
                </button>
                <div className="my-1 h-px bg-border/60" />
                <div
                  className="relative"
                  onMouseEnter={() => {
                    if (libraryCloseTimerRef.current !== null) window.clearTimeout(libraryCloseTimerRef.current)
                    setShowLibrarySubmenu(true)
                  }}
                  onMouseLeave={() => {
                    libraryCloseTimerRef.current = window.setTimeout(() => setShowLibrarySubmenu(false), 140)
                  }}
                >
                  <button type="button" className="cnote-menu-item" onClick={() => setShowLibrarySubmenu(true)}>
                    <NodeMenuIcon kind="library" compact />
                    <span className="min-w-0 flex-1">内容资料库 ({libraryItems.length})</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {showLibrarySubmenu && (
                    <div
                      ref={librarySubmenuRef}
                      className="absolute left-[calc(100%-4px)] top-0 z-[52] w-56 rounded-xl border border-border bg-card p-1.5 shadow-xl"
                      style={librarySubmenuLayout}
                      onMouseEnter={() => {
                        if (libraryCloseTimerRef.current !== null) window.clearTimeout(libraryCloseTimerRef.current)
                      }}
                      onMouseLeave={() => {
                        libraryCloseTimerRef.current = window.setTimeout(() => setShowLibrarySubmenu(false), 140)
                      }}
                    >
                      <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground">最近使用</p>
                      {libraryItems.slice(0, 8).map((item) => {
                        const visual = getContentCategoryVisual(undefined, item.nodeData.category ?? undefined)
                        const Icon = visual?.icon
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className="cnote-menu-item"
                            onClick={() => void addLibraryItem(item)}
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                              {Icon ? <Icon className={`h-3.5 w-3.5 ${visual?.iconClass || 'text-blue-500'}`} /> : null}
                            </span>
                            <span className="truncate">{item.title}</span>
                          </button>
                        )
                      })}
                      {libraryItems.length === 0 && (
                        <p className="px-3 py-4 text-center text-xs text-muted-foreground">暂无收藏内容</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

        <div
          ref={rightGroupRef}
          className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full bg-card p-1 shadow-sm"
        >
            <>{showResumeButton && (
                <Button
                  variant="ghost"
                  disabled={resumeBusy || resumeRunning}
                  className={compactActions ? `${actionButtonClass} text-primary disabled:opacity-40` : 'group relative flex h-10 items-center gap-1.5 overflow-hidden rounded-full px-3 text-primary transition-all hover:bg-primary/10 disabled:opacity-40'}
                  onClick={() => void handleResumeTask()}
                  title="继续上次中断的任务"
                  aria-label="继续任务"
                >
                  <RotateCcw className="h-4 w-4 shrink-0" />
                  {!compactActions && <span className="text-xs">继续任务</span>}
                </Button>
              )}

              <Button
                variant="ghost"
                className={actionButtonClass}
                onClick={() => void onSave()}
                title="保存 (Ctrl+S)"
                aria-label="保存"
                disabled={saveStatus === 'saving'}
              >
                <Save className="h-5 w-5 shrink-0" />
                <span className={actionLabelClass}>
                  保存
                </span>
              </Button>
              <Button
                variant="ghost"
                className={actionButtonClass}
                onClick={handleSaveAsTemplate}
                title="保存为模板"
                aria-label="保存为模板"
              >
                <Layers className="h-5 w-5 shrink-0" />
                <span className={actionLabelClass}>
                  模板
                </span>
              </Button>
              <Button
                variant="ghost"
                className={actionButtonClass}
                onClick={() => setShowExportDialog(true)}
                title="导出"
                aria-label="导出"
              >
                <Download className="h-5 w-5 shrink-0" />
                <span className={actionLabelClass}>
                  导出
                </span>
              </Button>
              <Button
                variant="ghost"
                className={actionButtonClass}
                onClick={() => void handleImport()}
                title="导入"
                aria-label="导入"
              >
                <Upload className="h-5 w-5 shrink-0" />
                <span className={actionLabelClass}>
                  导入
                </span>
              </Button>
              {!compactPanelToggles && <div className="mx-1 h-6 w-px bg-border" />}
            </>
          {!compactPanelToggles && (
            <Button
              variant="ghost"
              disabled={!canOpenExtensionPanel}
              className="group relative flex h-10 w-10 items-center overflow-hidden rounded-full px-2 transition-all hover:w-[76px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:w-10 disabled:hover:bg-transparent"
              title={canOpenExtensionPanel ? '面板' : '窗口宽度不足，无法打开面板'}
              aria-label="面板"
              aria-pressed={showExtensionPanel}
              onClick={openExtensionPanel}
            >
              <PanelRightOpen className="h-5 w-5 shrink-0" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all group-hover:ml-1 group-hover:max-w-8 group-hover:opacity-100">
                面板
              </span>
            </Button>
          )}
        </div>
      </div>

      <Dialog open={compactTitle && editingTitle} onOpenChange={setEditingTitle}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑画布名称</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); commitTitle() }}>
            <input
              autoFocus
              value={titleDraft}
              aria-label="画布名称"
              onChange={(event) => setTitleDraft(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-3">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setEditingTitle(false)}>取消</Button>
              <Button type="submit" className="flex-1">保存</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-base">保存为模板</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-1">
            <label className="block text-[13px] text-muted-foreground">
              <span className="mb-2 block font-medium">模板名称</span>
              <input
                autoFocus
                value={templateTitle}
                onChange={(event) => setTemplateTitle(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
              />
            </label>
            <label className="block text-[13px] text-muted-foreground">
              <span className="mb-2 block font-medium">描述（可选）</span>
              <input
                value={templateDescription}
                onChange={(event) => setTemplateDescription(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
              />
            </label>
            <label className="block text-[13px] text-muted-foreground">
              <span className="mb-2 block font-medium">分类（可选）</span>
              <input
                value={templateCategory}
                onChange={(event) => setTemplateCategory(event.target.value)}
                placeholder="例如：内容处理"
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
              />
            </label>
          </div>
          <div className="mt-6 flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowTemplateDialog(false)}>取消</Button>
            <Button className="flex-1" onClick={handleCreateTemplate} disabled={!templateTitle.trim()}>保存模板</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showExportDialog} onOpenChange={(open) => { setShowExportDialog(open); if (!open) setShowExportFormatMenu(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-base">导出画布</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 p-1">
            <div ref={exportFormatMenuRef} className="relative">
              <button
                type="button"
                className="flex h-10 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-sm"
                onClick={() => setShowExportFormatMenu((open) => !open)}
              >
                <span>{exportFormat === 'json' ? 'JSON' : exportFormat === 'png' ? '将画布导出为 PNG' : '完整备份 (.zip)'}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
              {showExportFormatMenu && (
                <div className="cnote-menu-surface absolute left-0 right-0 top-[calc(100%+6px)] z-50">
                  <button type="button" className="cnote-menu-item" data-active={exportFormat === 'json'} onClick={() => { setExportFormat('json'); setShowExportFormatMenu(false) }}>
                    <span className="flex-1 text-left">JSON</span>
                    {exportFormat === 'json' && <Check className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" className="cnote-menu-item" data-active={exportFormat === 'png'} onClick={() => { setExportFormat('png'); setShowExportFormatMenu(false) }}>
                    <span className="flex-1 text-left">将画布导出为 PNG</span>
                    {exportFormat === 'png' && <Check className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" className="cnote-menu-item" data-active={exportFormat === 'backup'} onClick={() => { setExportFormat('backup'); setShowExportFormatMenu(false) }}>
                    <span className="flex-1 text-left">完整备份 (.zip)</span>
                    {exportFormat === 'backup' && <Check className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowExportDialog(false)}>取消</Button>
            <Button className="flex-1" onClick={() => void handleExportConfirm()}>导出</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
