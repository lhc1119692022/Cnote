import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReactFlow } from "reactflow";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  PanelLeft,
  PanelRightOpen,
  Plus,
  Sparkles,
  Save,
  Layers,
  Download,
  Upload,
  FileText,
} from "lucide-react";
import { useFlowStore } from "@/stores/use-flow-store";
import { useTemplateStore } from "@/stores/use-template-store";
import { useAIStore } from "@/stores/use-ai-store";
import { useSourceStore } from "@/stores/use-source-store";
import { retainLocalResource } from "@/lib/resource-storage";
import { captureFlowThumbnail } from "@/lib/flow/thumbnail";
import { AI_NODE_DEFAULT_SIZE, BROWSER_NODE_DEFAULT_SIZE } from "@/lib/flow/node-dimensions";
import { getContentCategoryVisual } from "@/lib/content-visuals";
import { CONTENT_FILE_ACCEPT, emptyContentData } from "@/lib/content-import";
import { importContentIntoNode } from "@/lib/content-import-controller";
import { NodeMenuIcon } from "./NodeMenuIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ToolbarProps {
  saveStatus?: "saved" | "saving" | "unsaved";
  onSave?: () => void | Promise<void>;
  onOpenNodePanel?: () => void;
  onOpenContentLibrary?: () => void;
  onOpenExtensionPanel?: () => void;
  canOpenNodePanel?: boolean;
  canOpenExtensionPanel?: boolean;
  leftInset?: number;
  rightInset?: number;
  viewportWidth?: number;
  isResizing?: boolean;
  onGroupLayoutChange?: (layout: {
    leftWidth: number;
    centerWidth: number;
    rightWidth: number;
    leftInset: number;
    rightInset: number;
  }) => void;
}

export function Toolbar({
  saveStatus = "saved",
  onSave,
  onOpenNodePanel,
  onOpenContentLibrary,
  onOpenExtensionPanel,
  canOpenNodePanel = true,
  canOpenExtensionPanel = true,
  leftInset = 0,
  rightInset = 0,
  viewportWidth = 1200,
  isResizing = false,
  onGroupLayoutChange,
}: ToolbarProps) {
  const navigate = useNavigate();
  const reactFlowInstance = useReactFlow();
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateCategory, setTemplateCategory] = useState("");
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showLibrarySubmenu, setShowLibrarySubmenu] = useState(false);
  const [librarySubmenuLayout, setLibrarySubmenuLayout] = useState<{
    maxHeight?: number;
    overflowY: "visible" | "auto";
  }>({ overflowY: "visible" });
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<"flow" | "json" | "png">(
    "flow",
  );
  const createTemplate = useTemplateStore((state) => state.createTemplate);
  const apiKeys = useAIStore((state) => state.apiKeys);
  const getAPIKey = useAIStore((state) => state.getAPIKey);
  const sources = useSourceStore((state) => state.sources);

  const currentFlow = useFlowStore((state) => state.currentFlow);
  const saveCurrentFlow = useFlowStore((state) => state.saveCurrentFlow);
  const addNode = useFlowStore((state) => state.addNode);
  const exportFlowAsJSON = useFlowStore((state) => state.exportFlowAsJSON);
  const importFlowFromJSON = useFlowStore((state) => state.importFlowFromJSON);
  const updateFlow = useFlowStore((state) => state.updateFlow);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [expandedGroupWidths, setExpandedGroupWidths] = useState({
    left: 88,
    center: 128,
    right: 48,
  });
  const addMenuRef = useRef<HTMLDivElement>(null);
  const leftGroupRef = useRef<HTMLDivElement>(null);
  const centerGroupRef = useRef<HTMLDivElement>(null);
  const rightGroupRef = useRef<HTMLDivElement>(null);
  const librarySubmenuRef = useRef<HTMLDivElement>(null);
  const libraryCloseTimerRef = useRef<number | null>(null);
  const libraryItems = useMemo(
    () => sources.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    [sources],
  );

  useEffect(() => {
    if (!showAddMenu) return;
    const closeOnOutsideAction = (event: Event) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setShowAddMenu(false);
        setShowLibrarySubmenu(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideAction, true);
    document.addEventListener("keydown", closeOnOutsideAction, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideAction, true);
      document.removeEventListener("keydown", closeOnOutsideAction, true);
    };
  }, [showAddMenu]);

  useEffect(
    () => () => {
      if (libraryCloseTimerRef.current !== null)
        window.clearTimeout(libraryCloseTimerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!showLibrarySubmenu || !librarySubmenuRef.current) return;
    const measure = () => {
      const submenu = librarySubmenuRef.current;
      if (!submenu) return;
      const availableHeight = Math.max(
        120,
        window.innerHeight - submenu.getBoundingClientRect().top - 12,
      );
      const needsScroll = submenu.scrollHeight > availableHeight + 1;
      const nextLayout = needsScroll
        ? { maxHeight: availableHeight, overflowY: "auto" as const }
        : { overflowY: "visible" as const };
      setLibrarySubmenuLayout((current) =>
        current.maxHeight === nextLayout.maxHeight &&
        current.overflowY === nextLayout.overflowY
          ? current
          : nextLayout,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [libraryItems.length, showLibrarySubmenu]);

  const responsiveWidth = viewportWidth || 1200;
  const layoutWidth = responsiveWidth - leftInset - rightInset - 32;
  const compactTitle = responsiveWidth < 1100 || layoutWidth < 900;
  const compactActions = responsiveWidth < 950 || layoutWidth < 950;
  const compactPanelToggles = responsiveWidth < 300;
  const expandedGroupCount = [
    expandedGroupWidths.left,
    expandedGroupWidths.center,
    expandedGroupWidths.right,
  ].filter((width) => width > 0).length;
  const expandedGroupsRequiredWidth =
    expandedGroupWidths.left +
    expandedGroupWidths.center +
    expandedGroupWidths.right +
    Math.max(0, expandedGroupCount - 1) * 40;
  const compactCenter =
    responsiveWidth < 380 || layoutWidth < expandedGroupsRequiredWidth;

  useLayoutEffect(() => {
    const measure = () => {
      const leftWidth =
        leftGroupRef.current?.getBoundingClientRect().width || 0;
      const centerWidth =
        centerGroupRef.current?.getBoundingClientRect().width || 0;
      const rightWidth =
        rightGroupRef.current?.getBoundingClientRect().width || 0;
      setExpandedGroupWidths((current) => {
        const next = {
          left: leftWidth || current.left,
          center: centerWidth || current.center,
          right: rightWidth || current.right,
        };
        return next.left === current.left &&
          next.center === current.center &&
          next.right === current.right
          ? current
          : next;
      });
      onGroupLayoutChange?.({
        leftWidth,
        centerWidth,
        rightWidth,
        leftInset,
        rightInset,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (leftGroupRef.current) observer.observe(leftGroupRef.current);
    if (centerGroupRef.current) observer.observe(centerGroupRef.current);
    if (rightGroupRef.current) observer.observe(rightGroupRef.current);
    return () => observer.disconnect();
  }, [
    compactActions,
    compactCenter,
    compactPanelToggles,
    compactTitle,
    leftInset,
    onGroupLayoutChange,
    rightInset,
  ]);

  useEffect(() => {
    if (compactCenter) {
      setShowAddMenu(false);
      setShowLibrarySubmenu(false);
    }
  }, [compactCenter]);

  const commitTitle = () => {
    const title = titleDraft.trim();
    if (title && currentFlow)
      updateFlow(currentFlow.id, { name: title, title });
    setEditingTitle(false);
  };

  const getVisibleViewportCenter = (nodeWidth: number, nodeHeight: number) => {
    const center = reactFlowInstance.screenToFlowPosition({
      x: leftInset + (window.innerWidth - leftInset - rightInset) / 2,
      y: window.innerHeight / 2,
    });
    return { x: center.x - nodeWidth / 2, y: center.y - nodeHeight / 2 };
  };

  const addLibraryItem = async (item: (typeof libraryItems)[number]) => {
    const size = { width: 420, height: 360 };
    const resource = item.nodeData.source;
    if (resource?.kind === "file" || resource?.kind === "clipboard-image") {
      await retainLocalResource(resource.resourceId);
    }
    addNode({
      type: "content",
      position: getVisibleViewportCenter(size.width, size.height),
      data: {
        ...item.nodeData,
        label: item.title,
        sourceId: undefined,
      },
    });
    setShowLibrarySubmenu(false);
    setShowAddMenu(false);
  };

  const libraryItemVisual = (item: (typeof libraryItems)[number]) =>
    getContentCategoryVisual(undefined, item.nodeData.category || undefined);

  // 生成画布缩略图
  const generateThumbnail = async () => {
    const nodes = useFlowStore.getState().nodes;
    if (nodes.length === 0) return undefined;
    return captureFlowThumbnail();
  };

  // 返回 Dashboard
  const handleBack = async () => {
    try {
      const thumbnail = await generateThumbnail();
      saveCurrentFlow(thumbnail);
      navigate("/dashboard");
    } catch (error) {
      console.error("handleBack 错误:", error);
      navigate("/dashboard");
    }
  };

  // 添加内容节点
  const handleAddContent = () => {
    const position = getVisibleViewportCenter(540, 420);

    addNode({
      type: "content",
      position,
      data: emptyContentData("内容"),
    });
  };

  // 添加 AI 节点
  const handleAddAI = () => {
    const position = getVisibleViewportCenter(
      AI_NODE_DEFAULT_SIZE.width,
      AI_NODE_DEFAULT_SIZE.height,
    );

    const defaultChannel = apiKeys.find(
      (channel) =>
        Boolean(getAPIKey(channel.id)) && Boolean(channel.modelIds?.length),
    );
    addNode({
      type: "ai",
      position,
      style: AI_NODE_DEFAULT_SIZE,
      data: {
        label: "AI 节点",
        channelId: defaultChannel?.id,
        model: defaultChannel?.modelIds?.[0],
        systemPrompt: "Generate content based on the inputs.",
        prompt: "",
        temperature: 1,
        maxTokens: 258000,
        autoCompressThreshold: 0.7,
        webSearch: "auto",
        reasoningLevel: "medium",
        messages: [],
        sessions: [],
      },
    });
    setShowLibrarySubmenu(false);
    setShowAddMenu(false);
  };

  const handleAddBrowser = () => {
    addNode({
      type: "browser",
      position: getVisibleViewportCenter(
        BROWSER_NODE_DEFAULT_SIZE.width,
        BROWSER_NODE_DEFAULT_SIZE.height,
      ),
      data: { label: "浏览器节点", url: "https://www.baidu.com/", confirmedUrl: "https://www.baidu.com/", outputMode: "url", syncStatus: "synced", status: "loading" },
    });
    setShowLibrarySubmenu(false);
    setShowAddMenu(false);
  };

  // 保存
  const handleSave = async () => {
    if (onSave) {
      await onSave();
      return;
    }
    const thumbnail = await generateThumbnail();
    saveCurrentFlow(thumbnail);
  };

  // 保存为模板
  const handleSaveAsTemplate = () => {
    const nodes = useFlowStore.getState().nodes;
    if (!currentFlow || nodes.length === 0) return;
    setTemplateTitle(currentFlow.name);
    setTemplateDescription(currentFlow.description || "");
    setShowTemplateDialog(true);
  };

  const handleCreateTemplate = () => {
    const { nodes, edges } = useFlowStore.getState();
    if (!templateTitle.trim() || nodes.length === 0) return;
    createTemplate(
      templateTitle.trim(),
      templateDescription.trim(),
      nodes,
      edges,
      templateCategory.trim() || undefined,
    );
    setShowTemplateDialog(false);
    setTemplateTitle("");
    setTemplateDescription("");
    setTemplateCategory("");
  };

  // 导出
  const handleExport = () => {
    setShowExportDialog(true);
  };

  const confirmExport = async () => {
    const content =
      exportFormat === "flow" || exportFormat === "json"
        ? exportFlowAsJSON()
        : undefined;
    const extension = exportFormat === "png" ? "png" : "json";
    const mime = exportFormat === "png" ? "image/png" : "application/json";
    const thumbnail =
      exportFormat === "png" ? await generateThumbnail() : undefined;
    const blob = thumbnail
      ? await fetch(thumbnail).then((response) => response.blob())
      : new Blob([content || ""], { type: mime });
    const suggestedName = `${currentFlow?.name || "flow"}.${extension}`;
    const picker = (window as any).showSaveFilePicker;
    if (picker) {
      const handle = await picker({
        suggestedName,
        types: [
          {
            description: extension.toUpperCase(),
            accept: { [mime]: [`.${extension}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      a.click();
      URL.revokeObjectURL(url);
    }
    setShowExportDialog(false);
  };

  // 导入
  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.json,${CONTENT_FILE_ACCEPT}`;
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension === "json") {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            importFlowFromJSON(event.target?.result as string);
          } catch (error) {
            console.error("导入失败:", error);
          }
        };
        reader.readAsText(file);
        return;
      }
      const created = addNode({
        type: "content",
        position: getVisibleViewportCenter(420, 360),
        data: emptyContentData(file.name || "内容"),
      });
      void importContentIntoNode(created.id, { kind: "file", file, fileName: file.name });
    };
    input.click();
  };

  return (
    <>
      <div
        className={`pointer-events-none absolute top-0 z-50 flex h-[72px] items-center justify-between bg-transparent px-4 ${isResizing ? "transition-none" : "transition-[left,right]"}`}
        style={{ left: leftInset, right: rightInset }}
      >
        <div
          ref={leftGroupRef}
          className="pointer-events-auto flex shrink-0 items-center gap-2"
        >
          {!compactPanelToggles && (
            <Button
              variant="ghost"
              size="icon"
              disabled={!canOpenNodePanel}
              className="h-10 w-10 rounded-full bg-card shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
              title={
                canOpenNodePanel ? "侧边栏" : "窗口宽度不足，无法打开侧边栏"
              }
              onClick={onOpenNodePanel}
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
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          {!compactTitle && (
            <div
              className="ml-1 min-w-[230px] rounded-full bg-card px-5 py-2 shadow-sm"
              onDoubleClick={() => {
                setTitleDraft(currentFlow?.name || "");
                setEditingTitle(true);
              }}
            >
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitTitle();
                    if (event.key === "Escape") setEditingTitle(false);
                  }}
                  className="w-full bg-transparent text-sm font-semibold text-foreground outline-none"
                />
              ) : (
                <h1 className="truncate text-sm font-semibold text-foreground">
                  {currentFlow?.name || "Untitled Flow"}
                </h1>
              )}
              <p
                className={`truncate text-[10px] ${saveStatus === "unsaved" ? "text-amber-600" : saveStatus === "saving" ? "text-blue-600" : "text-muted-foreground"}`}
              >
                {saveStatus === "unsaved" ? "有更改未保存" : saveStatus === "saving" ? "正在保存..." : "所有更改已保存"}
              </p>
            </div>
          )}
        </div>

        {!compactCenter ? (
          <div
            ref={(element) => {
              centerGroupRef.current = element;
              addMenuRef.current = element;
            }}
            className="pointer-events-auto relative flex shrink-0 items-center rounded-full bg-card p-1 shadow-sm"
          >
            <Button
              variant="ghost"
              className="group h-9 gap-1.5 rounded-full px-3 text-muted-foreground"
              onClick={() =>
                setShowAddMenu((value) => {
                  if (value) setShowLibrarySubmenu(false);
                  return !value;
                })
              }
              title="添加节点"
            >
              <span className="flex items-center gap-0.5">
                <Plus className="h-[18px] w-[18px] stroke-[2.75] text-primary" />
                <ChevronDown className="h-3.5 w-3.5 stroke-[2.75] text-muted-foreground" />
              </span>
              <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all group-hover:max-w-12 group-hover:opacity-100">
                添加
              </span>
            </Button>
            <div className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              className="group h-9 gap-1.5 rounded-full px-3 text-muted-foreground"
              onClick={handleAddAI}
              title="AI 节点"
            >
              <Sparkles className="h-4 w-4 text-violet-500" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all group-hover:max-w-16 group-hover:opacity-100">
                AI 节点
              </span>
            </Button>
            {showAddMenu && (
              <div
                data-toolbar-add-menu
                className="absolute left-0 top-12 w-48 rounded-xl border border-border bg-card p-1.5 shadow-xl"
              >
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    handleAddContent();
                    setShowLibrarySubmenu(false);
                    setShowAddMenu(false);
                  }}
                >
                  <NodeMenuIcon kind="content" compact />
                  添加内容节点
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-muted"
                  onClick={handleAddBrowser}
                >
                  <NodeMenuIcon kind="browser" compact />
                  添加浏览器节点
                </button>
                <div className="my-1 h-px bg-border/60" />
                <div
                  className="relative"
                  onMouseEnter={() => {
                    if (libraryCloseTimerRef.current !== null)
                      window.clearTimeout(libraryCloseTimerRef.current);
                    setShowLibrarySubmenu(true);
                  }}
                  onMouseLeave={() => {
                    libraryCloseTimerRef.current = window.setTimeout(
                      () => setShowLibrarySubmenu(false),
                      140,
                    );
                  }}
                >
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-muted"
                    onClick={() => setShowLibrarySubmenu(true)}
                  >
                    <NodeMenuIcon kind="library" compact />
                    <span className="min-w-0 flex-1">
                      内容资料库 ({libraryItems.length})
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {showLibrarySubmenu && (
                    <div
                      ref={librarySubmenuRef}
                      className="absolute left-[calc(100%-4px)] top-0 z-[52] w-56 rounded-xl border border-border bg-card p-1.5 shadow-xl"
                      style={librarySubmenuLayout}
                      onMouseEnter={() => {
                        if (libraryCloseTimerRef.current !== null)
                          window.clearTimeout(libraryCloseTimerRef.current);
                      }}
                      onMouseLeave={() => {
                        libraryCloseTimerRef.current = window.setTimeout(
                          () => setShowLibrarySubmenu(false),
                          140,
                        );
                      }}
                    >
                      <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
                        最近使用
                      </p>
                      {libraryItems.slice(0, 8).map((item) => {
                        const visual = libraryItemVisual(item);
                        const Icon = visual?.icon || FileText;
                        return (
                          <button
                            key={item.id}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-muted"
                            onClick={() => void addLibraryItem(item)}
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                              <Icon
                                className={`h-3.5 w-3.5 ${visual?.iconClass || "text-blue-500"}`}
                              />
                            </span>
                            <span className="truncate">{item.title}</span>
                          </button>
                        );
                      })}
                      {libraryItems.length === 0 && (
                        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                          暂无收藏内容
                        </p>
                      )}
                      <button
                        className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-primary hover:bg-muted"
                        onClick={() => {
                          onOpenContentLibrary?.();
                          setShowLibrarySubmenu(false);
                          setShowAddMenu(false);
                        }}
                      >
                        展开资料库
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div ref={centerGroupRef} className="hidden" />
        )}

        <div
          ref={rightGroupRef}
          className={
            compactActions && compactPanelToggles
              ? "hidden"
              : "pointer-events-auto flex shrink-0 items-center gap-1 rounded-full bg-card p-1 shadow-sm"
          }
        >
          {!compactActions && (
            <>
              {/* 保存 */}
              <Button
                variant="ghost"
                className="group relative flex h-10 w-10 items-center overflow-hidden rounded-full px-2 transition-all hover:w-[76px] hover:bg-muted"
                onClick={handleSave}
                title="保存 (Ctrl+S)"
              >
                <Save className="h-5 w-5 shrink-0" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all group-hover:ml-1 group-hover:max-w-8 group-hover:opacity-100">
                  保存
                </span>
              </Button>

              {/* 模板 */}
              <Button
                variant="ghost"
                className="group relative flex h-10 w-10 items-center overflow-hidden rounded-full px-2 transition-all hover:w-[76px] hover:bg-muted"
                onClick={handleSaveAsTemplate}
                title="保存为模板"
              >
                <Layers className="h-5 w-5 shrink-0" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all group-hover:ml-1 group-hover:max-w-8 group-hover:opacity-100">
                  模板
                </span>
              </Button>

              {/* 导出 */}
              <Button
                variant="ghost"
                className="group relative flex h-10 w-10 items-center overflow-hidden rounded-full px-2 transition-all hover:w-[76px] hover:bg-muted"
                onClick={handleExport}
                title="导出"
              >
                <Download className="h-5 w-5 shrink-0" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all group-hover:ml-1 group-hover:max-w-8 group-hover:opacity-100">
                  导出
                </span>
              </Button>

              {/* 导入 */}
              <Button
                variant="ghost"
                className="group relative flex h-10 w-10 items-center overflow-hidden rounded-full px-2 transition-all hover:w-[76px] hover:bg-muted"
                onClick={handleImport}
                title="导入"
              >
                <Upload className="h-5 w-5 shrink-0" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all group-hover:ml-1 group-hover:max-w-8 group-hover:opacity-100">
                  导入
                </span>
              </Button>
              {!compactPanelToggles && (
                <div className="mx-1 h-6 w-px bg-border" />
              )}
            </>
          )}
          {!compactPanelToggles && (
            <Button
              variant="ghost"
              disabled={!canOpenExtensionPanel}
              className="group relative flex h-10 w-10 items-center overflow-hidden rounded-full px-2 transition-all hover:w-[76px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:w-10 disabled:hover:bg-transparent"
              title={
                canOpenExtensionPanel ? "面板" : "窗口宽度不足，无法打开面板"
              }
              onClick={onOpenExtensionPanel}
            >
              <PanelRightOpen className="h-5 w-5 shrink-0" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all group-hover:ml-1 group-hover:max-w-8 group-hover:opacity-100">
                面板
              </span>
            </Button>
          )}
        </div>
      </div>

      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-base">保存为模板</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setShowTemplateDialog(false)}
            >
              取消
            </Button>
            <Button
              className="flex-1"
              onClick={handleCreateTemplate}
              disabled={!templateTitle.trim()}
            >
              保存模板
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-base">导出画板</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-xs text-muted-foreground">
              导出方式
              <select
                value={exportFormat}
                onChange={(event) =>
                  setExportFormat(event.target.value as typeof exportFormat)
                }
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground"
              >
                <option value="flow">导出完整 Flow 包</option>
                <option value="json">导出为 JSON</option>
                <option value="png">将画布导出为 PNG</option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              确认后可选择保存位置。
            </p>
          </div>
          <div className="mt-5 flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setShowExportDialog(false)}
            >
              取消
            </Button>
            <Button className="flex-1" onClick={() => void confirmExport()}>
              选择位置并导出
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
