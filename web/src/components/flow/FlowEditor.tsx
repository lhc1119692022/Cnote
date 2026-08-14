import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useParams } from "react-router-dom";
import { nanoid } from "nanoid";
import ReactFlow, {
  Background,
  NodeToolbar,
  useReactFlow,
  useStore,
  ReactFlowProvider,
  ConnectionLineType,
  Position,
  type NodeTypes,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type Viewport,
} from "reactflow";
import {
  AlertTriangle,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Download,
  Globe,
  Layers3,
  FolderPlus,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import "reactflow/dist/style.css";
import { useFlowStore } from "@/stores/use-flow-store";
import { useAIStore } from "@/stores/use-ai-store";
import { useSourceStore } from "@/stores/use-source-store";
import { useContentEditorStore } from "@/stores/use-content-editor-store";
import { captureFlowThumbnail } from "@/lib/flow/thumbnail";
import {
  revokeAllManagedObjectUrls,
  retainLocalResource,
} from "@/lib/resource-storage";
import {
  getContentCategoryVisual,
} from "@/lib/content-visuals";
import {
  CONTENT_FILE_ACCEPT,
  emptyContentData,
  type ContentImportInput,
} from "@/lib/content-import";
import {
  canNodeOutputText,
  importContentIntoNode,
  refreshMediaFromUpstream,
  refreshTextFromUpstream,
  textNodeNeedsUpstreamRefresh,
} from "@/lib/content-import-controller";
import { cloneFlowValue } from "@/lib/flow/clone";
import { hasCycle } from "@/lib/flow/graph";
import { AI_NODE_DEFAULT_SIZE, GROUP_NODE_PADDING } from "@/lib/flow/node-dimensions";
import type { ContentNodeData } from "@/types/flow";
import { useLocalResourceUrl } from "@/hooks/use-local-resource-url";
import { NodeMenuIcon } from "./NodeMenuIcon";
import { Toolbar } from "./Toolbar";
import { CanvasControls } from "./CanvasControls";
import { InteractiveEdge } from "./InteractiveEdge";
import { ContentEditorPanel } from "./ContentEditorPanel";
import {
  ContentNode,
  AINode,
  BrowserNode,
  StickyNode,
  GroupNode,
} from "./nodes";

const MINIMAP_WIDTH = 280;
const MINIMAP_HEIGHT = 180;
const FLOATING_MENU_MARGIN = 12;
const MIN_EDITOR_WIDTH = 288;
const MIN_EDITOR_HEIGHT = 256;
const NODE_PANEL_INSET = 284;
const EXTENSION_PANEL_MARGIN = 28;
const TOOLBAR_HORIZONTAL_PADDING = 32;
const MIN_TOOLBAR_GROUP_GAP = 40;
const CLIPBOARD_READ_TIMEOUT_MS = 2000;
const CONNECTION_LINE_STYLE = {
  stroke: "var(--muted-foreground)",
  strokeWidth: 2,
  strokeDasharray: "8 8",
} as const;
const DEFAULT_EDGE_OPTIONS = {
  type: "interactive",
  animated: false,
  style: { stroke: "var(--border)", strokeWidth: 1.5 },
} as const;
const FLOW_FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 0.8 } as const;
const MULTI_SELECTION_KEYS = ["Control", "Meta"];
const panelFilterLabels: Record<string, string> = {
  all: "全部",
  ai: "AI 节点",
  browser: "浏览器",
  "category:text": "文本",
  "category:video": "视频",
  "category:social": "社媒",
  "category:document": "文档",
  "category:data": "数据",
  "category:presentation": "演示文稿",
  "category:mindmap": "思维导图",
  "category:image": "图片",
};

function nodeDimension(node: Node, axis: "width" | "height") {
  const measured = (node as Node & { measured?: { width?: number; height?: number } }).measured;
  const value = node[axis] ?? measured?.[axis] ?? node.style?.[axis];
  const dimension = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(dimension) && dimension > 0) return dimension;
  return axis === "width" ? 240 : 150;
}

function nodesBounds(nodes: Node[]) {
  const left = Math.min(...nodes.map((node) => node.position.x));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const right = Math.max(...nodes.map((node) => node.position.x + nodeDimension(node, "width")));
  const bottom = Math.max(...nodes.map((node) => node.position.y + nodeDimension(node, "height")));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function absoluteNodePosition(node: Node, nodes: Node[]) {
  let position = { ...node.position };
  let parentId = node.parentNode;
  const visited = new Set<string>();

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodes.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    position = { x: position.x + parent.position.x, y: position.y + parent.position.y };
    parentId = parent.parentNode;
  }

  return position;
}

function copyLabel(label: string, usedLabels: Set<string>) {
  const base = `${label || "节点"} (副本)`;
  let candidate = base;
  let index = 2;
  while (usedLabels.has(candidate)) {
    candidate = `${base} ${index}`;
    index += 1;
  }
  usedLabels.add(candidate);
  return candidate;
}

function PanelNodeIcon({
  node,
  isSourceItem,
  fallback,
}: {
  node: any;
  isSourceItem: boolean;
  fallback: ReactNode;
}) {
  const source = node.data?.source;
  const resourceId =
    source?.kind === "file" || source?.kind === "clipboard-image"
      ? source.resourceId
      : undefined;
  const isLocalMedia =
    Boolean(resourceId) &&
    (node.data?.category === "image" || node.data?.category === "video");
  const resourceUrl = useLocalResourceUrl(
    isLocalMedia ? resourceId : undefined,
    undefined,
  );

  const markResource = (resourceLost: boolean) => {
    if (isSourceItem) return;
    useFlowStore.getState().updateNode(node.id, {
      data: resourceLost
        ? { ...node.data, resourceLost: true }
        : {
            ...node.data,
            resourceLost: false,
            disabled: false,
            enabled: true,
          },
    });
  };

  if (isLocalMedia && resourceUrl) {
    return node.data.category === "video" ? (
      <video
        src={resourceUrl}
        muted
        preload="metadata"
        onLoadedData={() => markResource(false)}
        onError={() => markResource(true)}
        className="h-9 w-9 rounded-md object-cover"
      />
    ) : (
      <img
        src={resourceUrl}
        alt=""
        onLoad={() => markResource(false)}
        onError={() => markResource(true)}
        className="h-9 w-9 rounded-md object-cover"
      />
    );
  }

  return <span className="flex h-9 w-9 items-center justify-center">{fallback}</span>;
}
const panelFilterOptions = Object.entries(panelFilterLabels);

function getNodeContentMode(node: { type?: string; data?: any }) {
  return node.type === "content" ? node.data?.subtype : undefined;
}

function getNodeContentCategory(node: { type?: string; data?: any }) {
  return node.type === "content" ? node.data?.category : undefined;
}

function getContentResourceId(data?: ContentNodeData) {
  const source = data?.source;
  return source?.kind === "file" || source?.kind === "clipboard-image"
    ? source.resourceId
    : undefined;
}

function isLocalVideoNode(node?: Node) {
  if (node?.type !== "content") return false;
  const data = node.data as ContentNodeData;
  return data.category === "video" && data.source?.kind === "file";
}

function isNodeDisabled(node: { type?: string; data?: any }) {
  if (node.data?.resourceLost) return false;
  if (node.data?.disabled || node.data?.enabled === false || node.data?.hidden)
    return true;
  if (node.type === "ai") return !node.data?.channelId || !node.data?.model;
  return false;
}

function getPointerPosition(event: MouseEvent | TouchEvent | PointerEvent) {
  if ("touches" in event && event.touches.length)
    return { x: event.touches[0].clientX, y: event.touches[0].clientY };
  if ("changedTouches" in event && event.changedTouches.length)
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    };
  return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
}

function withClipboardTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("CLIPBOARD_READ_TIMEOUT"));
    }, CLIPBOARD_READ_TIMEOUT_MS);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function InteractiveMiniMap({ right }: { right: number }) {
  const reactFlow = useReactFlow();
  const flowNodes = useStore((state) => state.getNodes());
  const transform = useStore((state) => state.transform);
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);

  const zoom = transform[2] || 1;
  const viewBox = {
    x: -transform[0] / zoom,
    y: -transform[1] / zoom,
    width: canvasWidth / zoom,
    height: canvasHeight / zoom,
  };
  const { visibleNodes, nodeBounds } = useMemo(() => {
    const visible = flowNodes.filter((node) => !node.hidden);
    if (!visible.length) return { visibleNodes: visible, nodeBounds: null };
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const node of visible) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + (node.width || 0));
      maxY = Math.max(maxY, node.position.y + (node.height || 0));
    }
    return { visibleNodes: visible, nodeBounds: { minX, minY, maxX, maxY } };
  }, [flowNodes]);
  const minX = nodeBounds?.minX ?? viewBox.x;
  const minY = nodeBounds?.minY ?? viewBox.y;
  const maxX = nodeBounds?.maxX ?? viewBox.x + viewBox.width;
  const maxY = nodeBounds?.maxY ?? viewBox.y + viewBox.height;
  const nodeWidth = Math.max(1, maxX - minX);
  const nodeHeight = Math.max(1, maxY - minY);
  const worldWidth = Math.max(2400, nodeWidth + 640);
  const worldHeight = Math.max(1600, nodeHeight + 480);
  const bounds = {
    x: (minX + maxX) / 2 - worldWidth / 2,
    y: (minY + maxY) / 2 - worldHeight / 2,
    width: worldWidth,
    height: worldHeight,
  };
  const mapInset = 2;
  const scale =
    Math.max(
      bounds.width / (MINIMAP_WIDTH - mapInset * 2),
      bounds.height / (MINIMAP_HEIGHT - mapInset * 2),
    ) || 1;
  const mapX = (worldX: number) => mapInset + (worldX - bounds.x) / scale;
  const mapY = (worldY: number) => mapInset + (worldY - bounds.y) / scale;
  const viewportRectX = mapX(viewBox.x);
  const viewportRectY = mapY(viewBox.y);
  const viewportRectRight = mapX(viewBox.x + viewBox.width);
  const viewportRectBottom = mapY(viewBox.y + viewBox.height);
  const clippedRectX = Math.max(
    mapInset,
    Math.min(MINIMAP_WIDTH - mapInset, viewportRectX),
  );
  const clippedRectY = Math.max(
    mapInset,
    Math.min(MINIMAP_HEIGHT - mapInset, viewportRectY),
  );
  const clippedRectRight = Math.max(
    mapInset,
    Math.min(MINIMAP_WIDTH - mapInset, viewportRectRight),
  );
  const clippedRectBottom = Math.max(
    mapInset,
    Math.min(MINIMAP_HEIGHT - mapInset, viewportRectBottom),
  );
  const dragRef = useRef(false);
  const moveToPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      mapInset,
      Math.min(MINIMAP_WIDTH - mapInset, event.clientX - rect.left),
    );
    const y = Math.max(
      mapInset,
      Math.min(MINIMAP_HEIGHT - mapInset, event.clientY - rect.top),
    );
    void reactFlow.setCenter(
      bounds.x + (x - mapInset) * scale,
      bounds.y + (y - mapInset) * scale,
      { zoom, duration: 0 },
    );
  };
  return (
    <div
      data-flow-minimap
      className="pointer-events-auto absolute z-[5] overflow-hidden rounded-xl border border-border bg-white shadow-lg"
      style={{
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        right,
        bottom: 24,
      }}
    >
      <svg
        aria-label="画布小地图"
        width="100%"
        height="100%"
        viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
        preserveAspectRatio="none"
        onPointerDown={(event) => {
          dragRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          moveToPoint(event);
        }}
        onPointerMove={(event) => {
          if (dragRef.current) moveToPoint(event);
        }}
        onPointerUp={(event) => {
          dragRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = false;
        }}
      >
        <rect
          x={mapInset}
          y={mapInset}
          width={MINIMAP_WIDTH - mapInset * 2}
          height={MINIMAP_HEIGHT - mapInset * 2}
          fill="#fff"
        />
        {visibleNodes.map((node) => (
          <rect
            key={node.id}
            x={mapX(node.position.x)}
            y={mapY(node.position.y)}
            width={Math.max(4, (node.width || 160) / scale)}
            height={Math.max(4, (node.height || 100) / scale)}
            rx="2"
            fill={isNodeDisabled(node) ? "#fecaca" : "#f1f5f9"}
          />
        ))}
        <rect
          x={clippedRectX}
          y={clippedRectY}
          width={Math.max(0, clippedRectRight - clippedRectX)}
          height={Math.max(0, clippedRectBottom - clippedRectY)}
          fill="rgba(59, 109, 255, 0.14)"
          stroke="rgba(59, 109, 255, 0.8)"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}

// 注册自定义节点类型
const nodeTypes: NodeTypes = {
  content: ContentNode,
  ai: AINode,
  browser: BrowserNode,
  sticky: StickyNode,
  group: GroupNode,
};
const edgeTypes: EdgeTypes = { interactive: InteractiveEdge };

// React Flow 11 在 React 19 开发模式的严格检查中会对稳定的类型表重复发出 #002。
// 类型表已由 ref 固定；保留其余运行时错误，避免掩盖真正的画布问题。
const handleReactFlowError = (code: string, message: string) => {
  if (code !== "002") console.warn(`[React Flow]: ${message}`);
};

function FlowEditorInner() {
  const { flowId } = useParams();
  const reactFlowInstance = useReactFlow();
  const stableNodeTypes = useRef(nodeTypes).current;
  const stableEdgeTypes = useRef(edgeTypes).current;
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [localVideoAiWarning, setLocalVideoAiWarning] = useState(false);
  const [showNodePanel, setShowNodePanel] = useState(false);
  const [showExtensionPanel, setShowExtensionPanel] = useState(false);
  const editorNodeId = useContentEditorStore((state) => state.nodeId);
  const contentEditorMode = useContentEditorStore((state) => state.mode);
  const previewContentEditor = useContentEditorStore((state) => state.preview);
  const openContentEditor = useContentEditorStore((state) => state.open);
  const closeContentEditor = useContentEditorStore((state) => state.close);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [panelTab, setPanelTab] = useState<"nodes" | "content">("nodes");
  const [panelFilter, setPanelFilter] = useState("all");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [panelSearch, setPanelSearch] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPanelIds, setSelectedPanelIds] = useState<string[]>([]);
  const [extensionWidth, setExtensionWidth] = useState(370);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const [keepExtensionPanelOpen, setKeepExtensionPanelOpen] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [toolbarGroupLayout, setToolbarGroupLayout] = useState({
    leftWidth: 88,
    centerWidth: 128,
    rightWidth: 48,
    leftInset: 0,
    rightInset: 0,
  });
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [addMenuLayout, setAddMenuLayout] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [connectionMenu, setConnectionMenu] = useState<{
    x: number;
    y: number;
    position: { x: number; y: number };
    nodeId: string;
    handleType: "source" | "target";
  } | null>(null);
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const [libraryMenuLayout, setLibraryMenuLayout] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{
    x: number;
    y: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [marqueeSelectionIds, setMarqueeSelectionIds] = useState<string[]>([]);
  const clipboardRef = useRef<any[]>([]);
  const additiveSelectionRef = useRef<Set<string> | null>(null);
  const altDragRef = useRef<{
    originalToClone: Map<string, string>;
    originalPositions: Map<string, { x: number; y: number }>;
    clonePositions: Map<string, { x: number; y: number }>;
  } | null>(null);
  const suppressContentPasteUntilRef = useRef(0);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const libraryTriggerRef = useRef<HTMLDivElement>(null);
  const libraryMenuRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const viewportWidthRef = useRef(window.innerWidth);
  const libraryCloseTimerRef = useRef<number | null>(null);
  const connectionStartRef = useRef<{
    nodeId: string;
    handleType: "source" | "target";
    x: number;
    y: number;
  } | null>(null);
  const connectionCreatedRef = useRef(false);
  const localVideoAiWarningTimerRef = useRef<number | null>(null);
  const savedGraphSignatureRef = useRef<string | null>(null);
  const savedFlowIdRef = useRef<string | null>(null);

  const isEditableTarget = useCallback((target: EventTarget | null) => {
    const element = target instanceof HTMLElement ? target : null;
    return Boolean(
      element?.closest(
        'input, textarea, select, [contenteditable="true"], [role="textbox"]',
      ),
    );
  }, []);

  const closeCanvasMenus = useCallback(() => {
    setAddMenu(null);
    setLibraryMenuOpen(false);
    setConnectionMenu(null);
    setCanvasContextMenu(null);
  }, []);

  const showLocalVideoAiWarning = useCallback(() => {
    setLocalVideoAiWarning(true);
    if (localVideoAiWarningTimerRef.current !== null) {
      window.clearTimeout(localVideoAiWarningTimerRef.current);
    }
    localVideoAiWarningTimerRef.current = window.setTimeout(() => {
      localVideoAiWarningTimerRef.current = null;
      setLocalVideoAiWarning(false);
    }, 3_000);
  }, []);

  const handleCanvasDoubleClick = useCallback((event: ReactMouseEvent) => {
    const target = event.target as HTMLElement;
    // 只响应真正的画布空白区域，节点、边和控件上的双击不应打开创建菜单。
    if (
      target.closest(
        ".react-flow__node, .react-flow__edge, .react-flow__panel, .react-flow__controls, [data-flow-minimap]",
      )
    )
      return;
    if (
      !target.closest(".react-flow, .react-flow__pane, .react-flow__renderer")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    setAddMenuLayout(null);
    setLibraryMenuLayout(null);
    setLibraryMenuOpen(false);
    setAddMenu({
      x: event.clientX - (bounds?.left || 0),
      y: event.clientY - (bounds?.top || 0),
    });
  }, []);

  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const graphSignature = useMemo(() => JSON.stringify({ nodes, edges }), [edges, nodes]);
  const onNodesChange = useFlowStore((state) => state.onNodesChange);
  const onEdgesChange = useFlowStore((state) => state.onEdgesChange);
  const addEdgeToStore = useFlowStore((state) => state.addEdge);
  const isLocked = useFlowStore((state) => state.isLocked);
  const currentFlow = useFlowStore((state) => state.currentFlow);
  const currentFlowId = useFlowStore((state) => state.currentFlowId);
  const isCurrentFlowReady = Boolean(
    currentFlowId && (!flowId || currentFlowId === flowId),
  );
  const loadFlow = useFlowStore((state) => state.loadFlow);
  const initialize = useFlowStore((state) => state.initialize);
  const saveCurrentFlow = useFlowStore((state) => state.saveCurrentFlow);
  const clearHistory = useFlowStore((state) => state.clearHistory);
  const addNode = useFlowStore((state) => state.addNode);
  const deleteNode = useFlowStore((state) => state.deleteNode);
  const deleteEdge = useFlowStore((state) => state.deleteEdge);
  const replaceGraph = useFlowStore((state) => state.replaceGraph);
  const sources = useSourceStore((state) => state.sources);
  const deleteSource = useSourceStore((state) => state.deleteSource);
  const editorWidth =
    viewportSize.width === 0
      ? 1200
      : Math.max(viewportSize.width, MIN_EDITOR_WIDTH);
  const hasSafeToolbarSpacing = useCallback(
    (leftInset: number, rightInset: number) => {
      const availableWidth =
        editorWidth - leftInset - rightInset - TOOLBAR_HORIZONTAL_PADDING;
      const groupWidths = [
        toolbarGroupLayout.leftWidth,
        toolbarGroupLayout.centerWidth,
        toolbarGroupLayout.rightWidth,
      ].filter((width) => width > 0);
      const requiredWidth =
        groupWidths.reduce((total, width) => total + width, 0) +
        MIN_TOOLBAR_GROUP_GAP * Math.max(0, groupWidths.length - 1);
      if (availableWidth >= requiredWidth) return true;
      // 中间按钮组的隐藏优先级高于侧边栏关闭；若隐藏中间组后
      // 仍能保留 40px 间隔，就允许侧边栏继续保持开启。
      const sideGroupWidths = [
        toolbarGroupLayout.leftWidth,
        toolbarGroupLayout.rightWidth,
      ].filter((width) => width > 0);
      const requiredWithoutCenter =
        sideGroupWidths.reduce((total, width) => total + width, 0) +
        MIN_TOOLBAR_GROUP_GAP * Math.max(0, sideGroupWidths.length - 1);
      return availableWidth >= requiredWithoutCenter;
    },
    [
      editorWidth,
      toolbarGroupLayout.centerWidth,
      toolbarGroupLayout.leftWidth,
      toolbarGroupLayout.rightWidth,
    ],
  );
  const currentLeftInset = showNodePanel ? NODE_PANEL_INSET : 0;
  const currentRightInset = showExtensionPanel
    ? extensionWidth + EXTENSION_PANEL_MARGIN
    : 0;
  const maximumExtensionWidth = Math.max(280, editorWidth * 0.7);
  const canOpenNodePanel = hasSafeToolbarSpacing(
    NODE_PANEL_INSET,
    currentRightInset,
  );
  const canOpenExtensionPanel =
    showExtensionPanel ||
    hasSafeToolbarSpacing(
      currentLeftInset,
      370 + EXTENSION_PANEL_MARGIN,
    );
  const toolbarMeasurementIsCurrent =
    toolbarGroupLayout.leftInset === currentLeftInset &&
    toolbarGroupLayout.rightInset === currentRightInset;
  const currentToolbarSpacingIsSafe = hasSafeToolbarSpacing(
    currentLeftInset,
    currentRightInset,
  );
  const handleToolbarGroupLayoutChange = useCallback(
    (layout: {
      leftWidth: number;
      centerWidth: number;
      rightWidth: number;
      leftInset: number;
      rightInset: number;
    }) => {
      setToolbarGroupLayout((current) =>
        current.leftWidth === layout.leftWidth &&
        current.centerWidth === layout.centerWidth &&
        current.rightWidth === layout.rightWidth &&
        current.leftInset === layout.leftInset &&
        current.rightInset === layout.rightInset
          ? current
          : layout,
      );
    },
    [],
  );
  const renderedEdges = useMemo(
    () => edges.map((edge) => ({ ...edge, type: "interactive" })),
    [edges],
  );
  const createGroup = useCallback(() => {
    const selectedIds = new Set(marqueeSelectionIds);
    const members = nodes.filter((node) =>
      selectedIds.has(node.id) && node.type !== "group" && !node.parentNode,
    );
    if (members.length < 2) return;

    const bounds = nodesBounds(members);
    const groupId = nanoid();
    const groupCount = nodes.filter((node) => node.type === "group").length + 1;
    const label = groupCount === 1 ? "编组" : `编组 ${groupCount}`;
    const groupNode: Node = {
      id: groupId,
      type: "group",
      position: { x: bounds.left - GROUP_NODE_PADDING, y: bounds.top - GROUP_NODE_PADDING },
      style: {
        width: Math.max(160, bounds.width + GROUP_NODE_PADDING * 2),
        height: Math.max(120, bounds.height + GROUP_NODE_PADDING * 2),
      },
      data: { label, memberCount: members.length, padding: GROUP_NODE_PADDING },
      selected: true,
      zIndex: 0,
    };
    const memberIds = new Set(members.map((node) => node.id));
    const nextNodes = [
      groupNode,
      ...nodes.map((node) => {
        if (!memberIds.has(node.id)) return { ...node, selected: false };
        return {
          ...node,
          parentNode: groupId,
          position: {
            x: node.position.x - groupNode.position.x,
            y: node.position.y - groupNode.position.y,
          },
          selected: false,
          zIndex: 1,
        };
      }),
    ];
    replaceGraph(nextNodes, edges);
    setMarqueeSelectionIds([]);
  }, [edges, marqueeSelectionIds, nodes, replaceGraph]);

  const assignNodeToUnderlyingGroup = useCallback((nodeId: string) => {
    const store = useFlowStore.getState();
    const node = store.nodes.find((item) => item.id === nodeId);
    if (!node || node.type === "group") return false;

    const nodePosition = absoluteNodePosition(node, store.nodes);
    const width = nodeDimension(node, "width");
    const height = nodeDimension(node, "height");
    const center = { x: nodePosition.x + width / 2, y: nodePosition.y + height / 2 };
    const matchingGroups = store.nodes
      .filter((item) => {
        if (item.type !== "group") return false;
        const size = { width: nodeDimension(item, "width"), height: nodeDimension(item, "height") };
        return center.x >= item.position.x && center.x <= item.position.x + size.width
          && center.y >= item.position.y && center.y <= item.position.y + size.height;
      });
    const group = matchingGroups[matchingGroups.length - 1];

    if (!group || group.id === node.parentNode) return false;

    store.replaceGraph(
      store.nodes.map((item) => item.id === nodeId
        ? {
            ...item,
            parentNode: group.id,
            extent: undefined,
            expandParent: undefined,
            position: {
              x: nodePosition.x - group.position.x,
              y: nodePosition.y - group.position.y,
            },
            zIndex: 1,
          }
        : item),
      store.edges,
    );
    return true;
  }, []);

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    const activeAltDrag = altDragRef.current;
    if (!activeAltDrag) {
      onNodesChange(changes);
      return;
    }
    const translatedChanges: NodeChange[] = [];
    changes.forEach((change) => {
      if (!("id" in change)) {
        translatedChanges.push(change);
        return;
      }
      const cloneId = activeAltDrag.originalToClone.get(change.id);
      if (!cloneId) {
        translatedChanges.push(change);
        return;
      }
      if (change.type === "position") {
        // The regular change handler records history for dragging:false. Keep this
        // transient until onNodeDragStop, where the whole copy operation commits once.
        const originalPosition = activeAltDrag.originalPositions.get(change.id);
        const clonePosition = activeAltDrag.clonePositions.get(cloneId);
        if (!change.position) {
          // React Flow's final position change normally carries only
          // dragging:false. Preserve the last drag coordinate instead of
          // interpreting this as a return to the node's starting point.
          translatedChanges.push({ ...change, id: cloneId, dragging: true });
          return;
        }
        const changedPosition = change.position;
        const position = originalPosition && clonePosition
          ? {
              x: clonePosition.x + changedPosition.x - originalPosition.x,
              y: clonePosition.y + changedPosition.y - originalPosition.y,
            }
          : changedPosition;
        translatedChanges.push({
          ...change,
          id: cloneId,
          position,
          ...(change.dragging === false ? { dragging: true } : {}),
        });
        return;
      }
      if (change.type === "select") translatedChanges.push({ ...change, id: cloneId });
    });
    if (translatedChanges.length) onNodesChange(translatedChanges);
  }, [onNodesChange]);

  const handleNodeDragStart = useCallback((event: ReactMouseEvent, node: Node, draggedNodes: Node[]) => {
    if (!event.altKey || node.type === "group" || altDragRef.current) return;
    const selected = draggedNodes.filter((item) => item.type !== "group");
    if (!selected.length) return;

    const usedLabels = new Set(nodes.map((item) => String(item.data?.label || "节点")));
    const originalToClone = new Map<string, string>();
    const originalPositions = new Map<string, { x: number; y: number }>();
    const clonePositions = new Map<string, { x: number; y: number }>();
    const clones = selected.map((item) => {
      const id = nanoid();
      originalToClone.set(item.id, id);
      originalPositions.set(item.id, { ...item.position });
      const parent = item.parentNode
        ? nodes.find((candidate) => candidate.id === item.parentNode)
        : undefined;
      const position = parent
        ? { x: parent.position.x + item.position.x, y: parent.position.y + item.position.y }
        : { ...item.position };
      clonePositions.set(id, position);
      return {
        ...cloneFlowValue(item),
        id,
        parentNode: undefined,
        extent: undefined,
        position,
        selected: true,
        data: {
          ...cloneFlowValue(item.data),
          label: copyLabel(String(item.data?.label || "节点"), usedLabels),
          sourceId: undefined,
        },
      };
    });
    const copiedEdges = edges
      .filter((edge) => originalToClone.has(edge.source) || originalToClone.has(edge.target))
      .map((edge) => ({
        ...cloneFlowValue(edge),
        id: nanoid(),
        source: originalToClone.get(edge.source) || edge.source,
        target: originalToClone.get(edge.target) || edge.target,
        selected: false,
      }));
    altDragRef.current = { originalToClone, originalPositions, clonePositions };
    replaceGraph(
      [...nodes.map((item) => ({ ...item, selected: false })), ...clones],
      [...edges, ...copiedEdges],
      false,
    );
  }, [edges, nodes, replaceGraph]);

  const handleNodeDragStop = useCallback((_: ReactMouseEvent, node: Node) => {
    const activeAltDrag = altDragRef.current;
    window.requestAnimationFrame(() => {
      const store = useFlowStore.getState();
      if (activeAltDrag && altDragRef.current === activeAltDrag) {
        activeAltDrag.originalToClone.forEach((cloneId) => {
          store.updateNode(cloneId, { dragging: false });
          assignNodeToUnderlyingGroup(cloneId);
        });
        store.addToHistory();
        store.saveCurrentFlow();
        altDragRef.current = null;
        return;
      }
      assignNodeToUnderlyingGroup(node.id);
    });
  }, [assignNodeToUnderlyingGroup]);

  const handleNodeDrag = useCallback((_: ReactMouseEvent, node: Node) => {
    const activeAltDrag = altDragRef.current;
    if (!activeAltDrag) return;
    const cloneId = activeAltDrag.originalToClone.get(node.id);
    const originalPosition = activeAltDrag.originalPositions.get(node.id);
    const cloneStartPosition = cloneId
      ? activeAltDrag.clonePositions.get(cloneId)
      : undefined;
    if (!cloneId || !originalPosition || !cloneStartPosition) return;

    const position = {
      x: cloneStartPosition.x + node.position.x - originalPosition.x,
      y: cloneStartPosition.y + node.position.y - originalPosition.y,
    };
    useFlowStore.getState().onNodesChange([{
      type: "position",
      id: cloneId,
      position,
      dragging: true,
    }]);
  }, []);

  useEffect(() => {
    const updateViewportSize = () => {
      if (viewportWidthRef.current !== window.innerWidth) {
        viewportWidthRef.current = window.innerWidth;
        setKeepExtensionPanelOpen(false);
      }
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };
    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    return () => window.removeEventListener("resize", updateViewportSize);
  }, []);

  useEffect(() => {
    if (
      (!showNodePanel && !showExtensionPanel) ||
      !toolbarMeasurementIsCurrent ||
      currentToolbarSpacingIsSafe ||
      isResizingPanel
    )
      return;
    if (showExtensionPanel && keepExtensionPanelOpen) {
      setShowNodePanel(false);
      return;
    }
    setShowNodePanel(false);
    setShowExtensionPanel(false);
    setExtensionWidth(370);
    setKeepExtensionPanelOpen(false);
  }, [
    currentToolbarSpacingIsSafe,
    isResizingPanel,
    keepExtensionPanelOpen,
    showExtensionPanel,
    showNodePanel,
    toolbarMeasurementIsCurrent,
  ]);

  useEffect(() => {
    let cancelled = false;
    void initialize().then(() => {
      if (!cancelled && flowId) {
        revokeAllManagedObjectUrls();
        loadFlow(flowId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [flowId, initialize, loadFlow]);

  useLayoutEffect(() => {
    if (!isCurrentFlowReady) return;
    const flowRoot = reactFlowWrapper.current?.querySelector<HTMLElement>(
      ".react-flow",
    );
    if (!flowRoot) return;

    let resetFrame: number | null = null;
    let followUpFrame: number | null = null;

    // React Flow uses its viewport transform for navigation. Keep the host element
    // at its native origin when focused embedded content tries to scroll it.
    const resetNativeScroll = () => {
      if (flowRoot.scrollLeft !== 0) flowRoot.scrollLeft = 0;
      if (flowRoot.scrollTop !== 0) flowRoot.scrollTop = 0;
    };
    const scheduleReset = () => {
      if (resetFrame !== null) return;
      resetFrame = window.requestAnimationFrame(() => {
        resetFrame = null;
        resetNativeScroll();
      });
    };

    resetNativeScroll();
    resetFrame = window.requestAnimationFrame(() => {
      resetFrame = null;
      resetNativeScroll();
      followUpFrame = window.requestAnimationFrame(() => {
        followUpFrame = null;
        resetNativeScroll();
      });
    });

    const resizeObserver = new ResizeObserver(scheduleReset);
    resizeObserver.observe(flowRoot);
    flowRoot.addEventListener("scroll", resetNativeScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      flowRoot.removeEventListener("scroll", resetNativeScroll);
      if (resetFrame !== null) window.cancelAnimationFrame(resetFrame);
      if (followUpFrame !== null) window.cancelAnimationFrame(followUpFrame);
    };
  }, [currentFlowId, isCurrentFlowReady]);

  useEffect(() => {
    const releaseTransientHistory = () => clearHistory();
    window.addEventListener("pagehide", releaseTransientHistory);
    return () => {
      window.removeEventListener("pagehide", releaseTransientHistory);
      clearHistory();
      resizeCleanupRef.current?.();
      if (resizeFrameRef.current !== null)
        cancelAnimationFrame(resizeFrameRef.current);
      if (libraryCloseTimerRef.current !== null)
        window.clearTimeout(libraryCloseTimerRef.current);
      revokeAllManagedObjectUrls();
    };
  }, [clearHistory]);

  useEffect(() => {
    if (!addMenu) return;
    const closeOnOutsideAction = (event: Event) => {
      if (
        !(event.target as HTMLElement | null)?.closest?.(
          "[data-canvas-add-menu]",
        )
      )
        closeCanvasMenus();
    };
    document.addEventListener("pointerdown", closeOnOutsideAction, true);
    document.addEventListener("keydown", closeOnOutsideAction, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideAction, true);
      document.removeEventListener("keydown", closeOnOutsideAction, true);
    };
  }, [addMenu, closeCanvasMenus]);

  useEffect(() => {
    if (!canvasContextMenu) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-canvas-context-menu]")
      )
        return;
      setCanvasContextMenu(null);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [canvasContextMenu]);

  useEffect(() => {
    if (!editorNodeId || contentEditorMode !== 'panel') return;
    setShowExtensionPanel(true);
    setKeepExtensionPanelOpen(true);
  }, [contentEditorMode, editorNodeId]);

  useEffect(() => {
    if (!editorNodeId || nodes.some((node) => node.id === editorNodeId)) return;
    closeContentEditor();
    setShowExtensionPanel(false);
    setKeepExtensionPanelOpen(false);
    setExtensionWidth(370);
  }, [closeContentEditor, editorNodeId, nodes]);

  useEffect(() => {
    if (!showExtensionPanel) return;
    const selectedNodes = nodes.filter((node) => node.selected);
    if (selectedNodes.length !== 1) return;
    const selectedNode = selectedNodes[0];
    const isEditableContent =
      selectedNode.type === "content" &&
      (selectedNode.data?.category === "text" ||
        selectedNode.data?.category === "mindmap");
    if (isEditableContent) {
      if (editorNodeId !== selectedNode.id) previewContentEditor(selectedNode.id);
    } else if (editorNodeId) {
      closeContentEditor();
    }
  }, [closeContentEditor, editorNodeId, nodes, previewContentEditor, showExtensionPanel]);

  useEffect(() => {
    const unsyncedTextNodes = nodes.filter((node) => textNodeNeedsUpstreamRefresh(node.id));
    unsyncedTextNodes.forEach((node) => {
      void refreshTextFromUpstream(node.id);
    });
  }, [edges, nodes]);

  useLayoutEffect(() => {
    if (!addMenu || !addMenuRef.current) return;
    const containerRect = reactFlowWrapper.current?.getBoundingClientRect();
    if (!containerRect) return;
    const menuRect = addMenuRef.current.getBoundingClientRect();
    const maxLeft = Math.max(
      FLOATING_MENU_MARGIN,
      containerRect.width - menuRect.width - FLOATING_MENU_MARGIN,
    );
    const maxTop = Math.max(
      FLOATING_MENU_MARGIN,
      containerRect.height - menuRect.height - FLOATING_MENU_MARGIN,
    );
    const nextLayout = {
      left: Math.min(Math.max(addMenu.x, FLOATING_MENU_MARGIN), maxLeft),
      top: Math.min(Math.max(addMenu.y, FLOATING_MENU_MARGIN), maxTop),
    };
    setAddMenuLayout((current) =>
      current?.left === nextLayout.left && current?.top === nextLayout.top
        ? current
        : nextLayout,
    );
  }, [addMenu]);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-node-filter-menu]")) return;
      setFilterMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [filterMenuOpen]);

  useEffect(() => {
    if (!connectionMenu) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-connection-menu]"))
        setConnectionMenu(null);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [connectionMenu]);

  // 生成画布缩略图
  const generateThumbnail = useCallback(async () => {
    if (nodes.length === 0) return undefined;
    return captureFlowThumbnail();
  }, [nodes.length]);

  const flushNodeEditors = useCallback(async () => {
    const tasks: Promise<unknown>[] = [];
    document.dispatchEvent(
      new CustomEvent("cnote:flush-node-editors", { detail: { tasks } }),
    );
    if (tasks.length) await Promise.allSettled(tasks);
  }, []);

  const saveWithThumbnail = useCallback(
    async (viewport?: Viewport) => {
      setSaveStatus("saving");
      try {
        await flushNodeEditors();
        // Thumbnail capture is optional. A capture failure must never stop the
        // actual graph from being persisted.
        const thumbnail = await generateThumbnail().catch(() => undefined);
        saveCurrentFlow(thumbnail, viewport || reactFlowInstance.getViewport());
        savedGraphSignatureRef.current = JSON.stringify({
          nodes: useFlowStore.getState().nodes,
          edges: useFlowStore.getState().edges,
        });
        setSaveStatus("saved");
      } catch (error) {
        console.error("保存 Flow 失败:", error);
        setSaveStatus("unsaved");
      }
    },
    [flushNodeEditors, generateThumbnail, reactFlowInstance, saveCurrentFlow],
  );

  const saveLightweight = useCallback(
    (viewport?: Viewport) => {
      saveCurrentFlow(undefined, viewport || reactFlowInstance.getViewport());
      savedGraphSignatureRef.current = JSON.stringify({
        nodes: useFlowStore.getState().nodes,
        edges: useFlowStore.getState().edges,
      });
      setSaveStatus("saved");
    },
    [reactFlowInstance, saveCurrentFlow],
  );

  useEffect(() => {
    if (!isCurrentFlowReady) return;
    if (savedFlowIdRef.current !== currentFlowId) {
      savedFlowIdRef.current = currentFlowId;
      savedGraphSignatureRef.current = graphSignature;
      setSaveStatus("saved");
      return;
    }
    if (savedGraphSignatureRef.current !== graphSignature) setSaveStatus("unsaved");
  }, [currentFlowId, graphSignature, isCurrentFlowReady]);

  const focusNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return;
      reactFlowInstance.setCenter(
        node.position.x + (node.width || 0) / 2,
        node.position.y + (node.height || 0) / 2,
        { zoom: 1.1, duration: 350 },
      );
      onNodesChange(
        nodes.map((item) => ({
          type: "select" as const,
          id: item.id,
          selected: item.id === nodeId,
        })),
      );
    },
    [nodes, onNodesChange, reactFlowInstance],
  );

  const arrangeNodes = useCallback(() => {
    nodes.forEach((node, index) => {
      useFlowStore
        .getState()
        .updateNode(node.id, {
          position: {
            x: 120 + (index % 3) * 320,
            y: 140 + Math.floor(index / 3) * 240,
          },
        });
    });
    reactFlowInstance.fitView({ padding: 0.2, duration: 400 });
  }, [nodes, reactFlowInstance]);

  const filteredPanelNodes = useMemo(() => {
    const normalizedSearch = panelSearch.trim().toLowerCase();
    return nodes.filter((node) => {
      const mode = getNodeContentMode(node);
      const category = getNodeContentCategory(node);
      const typeMatch =
        panelFilter === "all" ||
        (panelFilter === "content"
          ? node.type === "content" && !mode
          : node.type === panelFilter) ||
        (panelFilter.startsWith("category:") &&
          category === panelFilter.slice(9));
      const searchText =
        `${node.data?.label || ""} ${node.type || ""} ${node.data?.category || ""} ${node.data?.subtype || ""} ${node.data?.description || ""} ${JSON.stringify(node.data?.payload || {})} ${JSON.stringify(node.data?.preview || {})}`.toLowerCase();
      return (
        typeMatch &&
        (!normalizedSearch || searchText.includes(normalizedSearch))
      );
    });
  }, [nodes, panelFilter, panelSearch]);

  // 内容资料库与主页“内容”页共享 useSourceStore；画布上的普通内容节点不计入资料库。
  const libraryItems = useMemo(
    () => sources.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    [sources],
  );

  useLayoutEffect(() => {
    if (
      !addMenu ||
      !libraryMenuOpen ||
      !libraryTriggerRef.current ||
      !libraryMenuRef.current
    )
      return;
    const containerRect = reactFlowWrapper.current?.getBoundingClientRect();
    if (!containerRect) return;
    const triggerRect = libraryTriggerRef.current.getBoundingClientRect();
    const menuElement = libraryMenuRef.current;
    const menuRect = menuElement.getBoundingClientRect();
    const overlap = 4;
    const opensRight =
      triggerRect.right - overlap + menuRect.width <=
      containerRect.right - FLOATING_MENU_MARGIN;
    const left = opensRight
      ? triggerRect.width - overlap
      : -menuRect.width + overlap;
    const desiredHeight = Math.max(menuElement.scrollHeight, menuRect.height);
    const availableBelow = Math.max(
      96,
      containerRect.bottom - FLOATING_MENU_MARGIN - triggerRect.top,
    );
    const availableAbove = Math.max(
      96,
      triggerRect.bottom - containerRect.top - FLOATING_MENU_MARGIN,
    );
    const opensDown =
      desiredHeight <= availableBelow || availableBelow >= availableAbove;
    const maxHeight = Math.min(
      desiredHeight,
      opensDown ? availableBelow : availableAbove,
    );
    const top = opensDown ? 0 : triggerRect.height - maxHeight;
    const nextLayout = { left, top, maxHeight };
    setLibraryMenuLayout((current) =>
      current?.left === left &&
      current?.top === top &&
      current?.maxHeight === maxHeight
        ? current
        : nextLayout,
    );
  }, [addMenu, addMenuLayout, libraryItems.length, libraryMenuOpen]);
  const panelContentNodes = useMemo(() => {
    const normalizedSearch = panelSearch.trim().toLowerCase();
    return libraryItems
      .filter((source) => {
        const searchText =
          `${source.title || ""} ${source.nodeData.category || ""} ${source.nodeData.subtype || ""} ${JSON.stringify(source.nodeData.payload || {})} ${JSON.stringify(source.nodeData.preview || {})}`.toLowerCase();
        return !normalizedSearch || searchText.includes(normalizedSearch);
      })
      .map((source) => ({
        id: `source:${source.id}`,
        type: "content",
        data: {
          ...source.nodeData,
          label: source.title,
          sourceId: source.id,
        },
      }));
  }, [libraryItems, panelSearch]);

  const nodeSummary = (node: any) => {
    const category = getNodeContentCategory(node);
    if (category) return panelFilterLabels[`category:${category}`] || "内容";
    return node.type === "ai" ? "AI" : node.type || "节点";
  };

  const nodeDisplayName = (node: any) => {
    if (node.type === "content") return node.data?.label || "内容类型选择";
    return node.type === "content"
      ? "内容类型选择"
      : node.data?.label || (node.type === "ai" ? "AI 节点" : node.type);
  };

  const nodeVisual = (node: any) => {
    const contentVisual = getContentCategoryVisual(undefined, node.data?.category);
    if (contentVisual) return contentVisual;
    if (node.type === "ai")
      return {
        icon: Sparkles,
        iconClass: "text-violet-500",
        iconSurfaceClass: "bg-violet-50",
      };
    if (node.type === "browser")
      return {
        icon: Globe,
        iconClass: "text-blue-500",
        iconSurfaceClass: "bg-blue-50",
      };
    if (node.type === "sticky")
      return {
        icon: StickyNote,
        iconClass: "text-amber-500",
        iconSurfaceClass: "bg-amber-50",
      };
    return {
      icon: Layers3,
      iconClass: "text-slate-500",
      iconSurfaceClass: "bg-slate-50",
    };
  };

  const nodeIcon = (node: any, size = "h-4 w-4") => {
    const visual = nodeVisual(node);
    const Icon = visual.icon;
    return <Icon className={`${size} ${visual.iconClass}`} />;
  };

  const addNodeAt = (type: string, position: { x: number; y: number }) => {
    if (type === "ai") {
      const store = useAIStore.getState();
      const channel = store.apiKeys.find(
        (item) =>
          Boolean(store.getAPIKey(item.id)) && Boolean(item.modelIds?.length),
      );
      addNode({
        type: "ai",
        position,
        style: AI_NODE_DEFAULT_SIZE,
        data: {
          label: "AI 节点",
          channelId: channel?.id,
          model: channel?.modelIds?.[0],
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
    } else if (type === "browser") {
      addNode({
        type: "browser",
        position,
        data: { label: "浏览器节点", url: "https://www.baidu.com/", confirmedUrl: "https://www.baidu.com/", outputMode: "url", syncStatus: "synced", status: "loading" },
      });
    } else if (type === "sticky") {
      addNode({ type: "sticky", position, data: { label: "贴纸", text: "" } });
    } else {
      addNode({
        type: "content",
        position,
        data: emptyContentData("内容"),
      });
    }
    setAddMenu(null);
  };

  const handleFileDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "json") {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          useFlowStore
            .getState()
            .importFlowFromJSON(String(reader.result || ""));
        } catch (error) {
          console.error("导入失败:", error);
        }
      };
      reader.readAsText(file);
      return;
    }
    const created = addNode({
      type: "content",
      position,
      data: emptyContentData(file.name || "内容"),
    });
    void importContentIntoNode(created.id, { kind: "file", file, fileName: file.name });
  };

  const getCanvasContentPosition = useCallback(
    (clientX?: number, clientY?: number) => {
      const wrapper = reactFlowWrapper.current;
      if (!wrapper) return { x: 160, y: 160 };
      const rect = wrapper.getBoundingClientRect();
      const point = reactFlowInstance.screenToFlowPosition({
        x: clientX === undefined ? rect.left + rect.width / 2 : clientX,
        y: clientY === undefined ? rect.top + rect.height / 2 : clientY,
      });
      return { x: point.x - 270, y: point.y - 180 };
    },
    [reactFlowInstance],
  );

  const importClipboardInputAt = useCallback(
    async (input: ContentImportInput, clientX?: number, clientY?: number) => {
      const created = addNode({
        type: "content",
        position: getCanvasContentPosition(clientX, clientY),
        data: emptyContentData("内容"),
      });
      await importContentIntoNode(created.id, input);
    },
    [addNode, getCanvasContentPosition],
  );

  const importClipboardInputIntoSelectedNode = useCallback(
    async (input: ContentImportInput) => {
      const selected = useFlowStore.getState().nodes.filter((node) => node.selected);
      if (selected.length !== 1 || selected[0].type !== "content") return false;
      const target = selected[0];
      const category = target.data?.category as ContentNodeData["category"] | undefined;
      // A type-selection node detects the clipboard content itself. Link-based
      // content nodes use their selected category and parse immediately.
      if (!category || category === "video" || category === "social" || category === "document") {
        if (input.kind === "text" && !input.text.trim()) return false;
        await importContentIntoNode(target.id, input, category || undefined);
        return true;
      }
      return false;
    },
    [],
  );

  const createClipboardErrorNode = useCallback(
    (code: string, message: string, clientX?: number, clientY?: number) => {
      const created = addNode({
        type: "content",
        position: getCanvasContentPosition(clientX, clientY),
        data: emptyContentData("内容"),
      });
      useFlowStore.getState().updateNode(created.id, {
        data: {
          ...created.data,
          state: "error",
          parse: {
            requestId: globalThis.crypto?.randomUUID?.() || "clipboard",
            revision: 1,
            completedAt: Date.now(),
            error: { code, message, retryable: code === "CLIPBOARD_PERMISSION_DENIED" },
          },
        } satisfies ContentNodeData,
      });
      return created;
    },
    [addNode, getCanvasContentPosition],
  );

  const readSystemClipboardAndImport = useCallback(
    async (clientX?: number, clientY?: number) => {
      let clipboardPermissionIssue = false;
      try {
        if (navigator.clipboard?.read) {
          try {
            const items = await withClipboardTimeout(navigator.clipboard.read());
            for (const item of items) {
              const imageType = item.types.find((type) => type.startsWith("image/"));
              if (imageType) {
                const blob = await withClipboardTimeout(item.getType(imageType));
                await importClipboardInputAt(
                  { kind: "file", file: blob, fileName: `clipboard.${imageType.split("/")[1] || "png"}`, clipboardImage: true },
                  clientX,
                  clientY,
                );
                return true;
              }
            }
            for (const item of items) {
              const textType = item.types.includes("text/plain") ? "text/plain" : item.types.find((type) => type.startsWith("text/"));
              if (textType) {
                const blob = await withClipboardTimeout(item.getType(textType));
                await importClipboardInputAt({ kind: "text", text: await withClipboardTimeout(blob.text()) }, clientX, clientY);
                return true;
              }
            }
          } catch (error) {
            clipboardPermissionIssue = true;
          }
        }
        if (navigator.clipboard?.readText) {
          try {
            const text = await withClipboardTimeout(navigator.clipboard.readText());
            if (text.trim()) {
              await importClipboardInputAt({ kind: "text", text }, clientX, clientY);
              return true;
            }
          } catch (error) {
            clipboardPermissionIssue = true;
          }
        }
      } catch (error) {
        clipboardPermissionIssue = true;
      }
      if (!navigator.clipboard?.read && !navigator.clipboard?.readText) {
        clipboardPermissionIssue = true;
      }
      if (clipboardPermissionIssue) {
        console.warn("读取剪贴板失败，请使用 Ctrl/Cmd+V");
        createClipboardErrorNode(
          "CLIPBOARD_PERMISSION_DENIED",
          "浏览器未允许读取剪贴板，请使用 Ctrl/Cmd+V 粘贴。",
          clientX,
          clientY,
        );
        return false;
      }
      createClipboardErrorNode(
        "INVALID_CONTENT",
        "剪贴板中没有可识别的文本、URL 或图片。",
        clientX,
        clientY,
      );
      return false;
    },
    [createClipboardErrorNode, importClipboardInputAt],
  );

  const onConnectStart = useCallback(
    (
      event: any,
      params: { nodeId: string | null; handleType: "source" | "target" | null },
    ) => {
      if (!params.nodeId || !params.handleType) return;
      const point = getPointerPosition(event);
      connectionStartRef.current = {
        nodeId: params.nodeId,
        handleType: params.handleType,
        ...point,
      };
      connectionCreatedRef.current = false;
      setConnectionMenu(null);
    },
    [],
  );

  const onConnect = useCallback(
    (connection: any) => {
      if (
        !connection.source ||
        !connection.target ||
        connection.source === connection.target
      )
        return;
      if (connection.sourceHandle && connection.sourceHandle !== "out") return;
      if (connection.targetHandle && connection.targetHandle !== "in") return;
      const currentGraph = useFlowStore.getState();
      if (hasCycle(currentGraph.nodes, [
        ...currentGraph.edges,
        {
          id: `candidate-${connection.source}-${connection.target}`,
          source: connection.source,
          target: connection.target,
        },
      ])) return;
      connectionCreatedRef.current = true;
      addEdgeToStore({
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle || "out",
        targetHandle: connection.targetHandle || "in",
        type: "interactive",
      });
      const connectedNodes = useFlowStore.getState().nodes;
      const target = connectedNodes.find((node) => node.id === connection.target);
      const source = connectedNodes.find((node) => node.id === connection.source);
      if (target?.type === "ai" && isLocalVideoNode(source)) {
        showLocalVideoAiWarning();
      }
      if (target?.type === "content" && target.data?.category === "text" && canNodeOutputText(source)) {
        // React Flow is still committing the new edge here. Defer any source
        // parsing and downstream writes until that transaction has completed.
        // The controller coalesces this with the empty-text sync effect.
        window.setTimeout(() => { void refreshTextFromUpstream(target.id); }, 0);
      }
      if (target?.type === "content" && (target.data?.category === "image" || target.data?.category === "video")) {
        const kind = target.data.category;
        window.setTimeout(() => { refreshMediaFromUpstream(target.id, kind); }, 0);
      }
    },
    [addEdgeToStore, showLocalVideoAiWarning],
  );

  const handleNodeClick = useCallback(() => {
    setMarqueeSelectionIds([]);
  }, []);

  const handlePaneClick = useCallback(() => {
    setMarqueeSelectionIds([]);
    setFilterMenuOpen(false);
  }, []);

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      if (!isResizingPanel) saveLightweight(viewport);
    },
    [isResizingPanel, saveLightweight],
  );

  const handleSelectionStart = useCallback((event: ReactMouseEvent) => {
    setMarqueeSelectionIds([]);
    additiveSelectionRef.current = event.ctrlKey || event.metaKey
      ? new Set(
          useFlowStore
            .getState()
            .nodes.filter((node) => node.selected)
            .map((node) => node.id),
        )
      : null;
  }, []);

  const handleSelectionEnd = useCallback(() => {
    const previousSelection = additiveSelectionRef.current;
    additiveSelectionRef.current = null;
    const currentNodes = useFlowStore.getState().nodes;
    const selectedNow = new Set(
      currentNodes.filter((node) => node.selected).map((node) => node.id),
    );
    previousSelection?.forEach((id) => selectedNow.add(id));
    if (previousSelection?.size) {
      handleNodesChange(
        currentNodes.map((node) => ({
          type: "select" as const,
          id: node.id,
          selected: selectedNow.has(node.id),
        })),
      );
    }
    const eligibleIds = useFlowStore
      .getState()
      .nodes.filter(
        (node) =>
          selectedNow.has(node.id) &&
          node.type !== "group" &&
          !node.parentNode,
      )
      .map((node) => node.id);
    setMarqueeSelectionIds(eligibleIds.length > 1 ? eligibleIds : []);
  }, [handleNodesChange]);

  const isValidFlowConnection = useCallback(
    (connection: any) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return false;
      if (connection.sourceHandle && connection.sourceHandle !== "out") return false;
      if (connection.targetHandle && connection.targetHandle !== "in") return false;
      const currentGraph = useFlowStore.getState();
      return !hasCycle(currentGraph.nodes, [
        ...currentGraph.edges,
        {
          id: `candidate-${connection.source}-${connection.target}`,
          source: connection.source,
          target: connection.target,
        },
      ]);
    },
    [],
  );

  const onConnectEnd = useCallback(
    (event: any) => {
      const start = connectionStartRef.current;
      connectionStartRef.current = null;
      if (!start || connectionCreatedRef.current) return;
      const point = getPointerPosition(event);
      const targetElement = (event.target as HTMLElement | null)?.closest(
        ".react-flow__node",
      );
      const targetNodeId =
        targetElement?.getAttribute("data-id") ||
        targetElement?.getAttribute("data-nodeid");
      const sameNode = targetNodeId === start.nodeId;
      const isSimpleClick =
        Math.hypot(point.x - start.x, point.y - start.y) < 10;

      if (targetNodeId && !sameNode) {
        if (start.handleType === "source")
          onConnect({
            source: start.nodeId,
            target: targetNodeId,
            sourceHandle: "out",
            targetHandle: "in",
          });
        else
          onConnect({
            source: targetNodeId,
            target: start.nodeId,
            sourceHandle: "out",
            targetHandle: "in",
          });
        return;
      }
      if (sameNode && !isSimpleClick) return;

      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      const x = point.x - (bounds?.left || 0);
      const y = point.y - (bounds?.top || 0);
      setConnectionMenu({
        x,
        y,
        position: reactFlowInstance.screenToFlowPosition({
          x: point.x,
          y: point.y,
        }),
        nodeId: start.nodeId,
        handleType: start.handleType,
      });
    },
    [onConnect, reactFlowInstance],
  );

  const createConnectedNode = (type: "ai" | "content") => {
    if (!connectionMenu) return;
    const position = connectionMenu.position;
    const store = useAIStore.getState();
    const channel = store.apiKeys.find(
      (item) =>
        Boolean(store.getAPIKey(item.id)) && Boolean(item.modelIds?.length),
    );
    const created = addNode(
      type === "ai"
        ? {
            type: "ai",
            position,
            style: AI_NODE_DEFAULT_SIZE,
            data: {
              label: "AI 节点",
              channelId: channel?.id,
              model: channel?.modelIds?.[0],
              prompt: "",
              temperature: 1,
              maxTokens: 258000,
              autoCompressThreshold: 0.7,
              webSearch: "auto",
              reasoningLevel: "medium",
              messages: [],
              sessions: [],
            },
          }
        : { type: "content", position, data: emptyContentData("内容") },
    );
      if (created) {
      const edge =
        connectionMenu.handleType === "source"
          ? {
              source: connectionMenu.nodeId,
              target: created.id,
              sourceHandle: "out",
              targetHandle: "in",
            }
          : {
              source: created.id,
              target: connectionMenu.nodeId,
              sourceHandle: "out",
              targetHandle: "in",
        };
      addEdgeToStore({ ...edge, type: "interactive" });
      const connectedNodes = useFlowStore.getState().nodes;
      const source = connectedNodes.find((node) => node.id === edge.source);
      const target = connectedNodes.find((node) => node.id === edge.target);
      if (target?.type === "ai" && isLocalVideoNode(source)) {
        showLocalVideoAiWarning();
      }
    }
    setConnectionMenu(null);
  };

  // 快捷键处理
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const isCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
      // Saving must work even when the active element is an editable node field.
      if (isCtrlOrCmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        await saveWithThumbnail();
        return;
      }
      if (isEditableTarget(e.target)) {
        if (isCtrlOrCmd && e.key.toLowerCase() === "c") clipboardRef.current = [];
        return;
      }

      // Ctrl/Cmd + Z: 撤销
      if (isCtrlOrCmd && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        useFlowStore.getState().undo();
      }

      // Ctrl/Cmd + Shift + Z 或 Ctrl/Cmd + Y: 重做
      if (
        (isCtrlOrCmd && e.shiftKey && e.key === "z") ||
        (isCtrlOrCmd && e.key === "y")
      ) {
        e.preventDefault();
        useFlowStore.getState().redo();
      }

      if (isCtrlOrCmd && e.key.toLowerCase() === "c") {
        const selectedNodes = nodes
          .filter((node) => node.selected)
          .map((node) => ({
            ...cloneFlowValue(node),
            id: undefined,
            position: { x: node.position.x + 40, y: node.position.y + 40 },
          }));
        clipboardRef.current = selectedNodes;
        if (selectedNodes.length) e.preventDefault();
        return;
      }
      if (isCtrlOrCmd && e.key.toLowerCase() === "v") {
        if (clipboardRef.current.length) {
          e.preventDefault();
          suppressContentPasteUntilRef.current = performance.now() + 500;
          const nodesToPaste = clipboardRef.current.map((node) =>
            cloneFlowValue(node),
          );
          clipboardRef.current = clipboardRef.current.map((node) => ({
            ...node,
            position: {
              x: node.position.x + 40,
              y: node.position.y + 40,
            },
          }));
          for (const node of nodesToPaste) {
            await retainLocalResource(getContentResourceId(node.data));
            addNode({ ...node, id: undefined });
          }
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        nodes
          .filter((node) => node.selected)
          .forEach((node) => deleteNode(node.id));
        edges
          .filter((edge) => edge.selected)
          .forEach((edge) => deleteEdge(edge.id));
        return;
      }

      // F: 适应视图
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        reactFlowInstance.fitView({ padding: 0.2 });
      }

      // +: 放大
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        reactFlowInstance.zoomIn();
      }

      // -: 缩小
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        reactFlowInstance.zoomOut();
      }

      // Ctrl/Cmd + 0: 适应视图
      if (isCtrlOrCmd && e.key === "0") {
        e.preventDefault();
        reactFlowInstance.fitView({ padding: 0.2 });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [addNode, deleteEdge, deleteNode, edges, isEditableTarget, nodes, reactFlowInstance, saveWithThumbnail]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (performance.now() <= suppressContentPasteUntilRef.current) {
        event.preventDefault();
        return;
      }
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const imageItem = Array.from(clipboard.items).find((item) => item.type.startsWith("image/"));
      const text = clipboard.getData("text/plain");
      const rect = reactFlowWrapper.current?.getBoundingClientRect();
      if (imageItem) {
        event.preventDefault();
        const file = imageItem.getAsFile();
        if (file) {
          const input = { kind: "file" as const, file, fileName: file.name || "clipboard.png", clipboardImage: true };
          void importClipboardInputIntoSelectedNode(input).then((imported) => {
            if (!imported && !nodes.some((node) => node.selected)) {
              void importClipboardInputAt(input, rect ? rect.left + rect.width / 2 : undefined, rect ? rect.top + rect.height / 2 : undefined);
            }
          });
        } else {
          if (!nodes.some((node) => node.selected)) createClipboardErrorNode("INVALID_CONTENT", "剪贴板中的图片无法读取，请重试或选择本地文件。", rect ? rect.left + rect.width / 2 : undefined, rect ? rect.top + rect.height / 2 : undefined);
        }
      } else if (text.trim()) {
        event.preventDefault();
        const input = { kind: "text" as const, text };
        void importClipboardInputIntoSelectedNode(input).then((imported) => {
          if (!imported && !nodes.some((node) => node.selected)) {
            void importClipboardInputAt(input, rect ? rect.left + rect.width / 2 : undefined, rect ? rect.top + rect.height / 2 : undefined);
          }
        });
      } else {
        event.preventDefault();
        if (!nodes.some((node) => node.selected)) createClipboardErrorNode("INVALID_CONTENT", "剪贴板中没有可识别的文本、URL 或图片。", rect ? rect.left + rect.width / 2 : undefined, rect ? rect.top + rect.height / 2 : undefined);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [createClipboardErrorNode, importClipboardInputAt, importClipboardInputIntoSelectedNode, isEditableTarget, nodes]);

  // 窗口关闭/刷新前自动保存
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveCurrentFlow(undefined, reactFlowInstance.getViewport());
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [reactFlowInstance, saveCurrentFlow]);

  useEffect(() => () => {
    if (localVideoAiWarningTimerRef.current !== null) {
      window.clearTimeout(localVideoAiWarningTimerRef.current);
    }
  }, []);

  return (
    <div
      className="relative h-dvh overflow-hidden bg-background"
      style={{ minWidth: MIN_EDITOR_WIDTH, minHeight: MIN_EDITOR_HEIGHT }}
    >
      {/* 顶部工具栏 */}
      <Toolbar
        saveStatus={saveStatus}
        onSave={saveWithThumbnail}
        leftInset={currentLeftInset}
        rightInset={currentRightInset}
        viewportWidth={editorWidth}
        isResizing={isResizingPanel}
        canOpenNodePanel={canOpenNodePanel}
        canOpenExtensionPanel={canOpenExtensionPanel}
        onGroupLayoutChange={handleToolbarGroupLayoutChange}
        onOpenNodePanel={() =>
          canOpenNodePanel && setShowNodePanel((value) => !value)
        }
        onOpenContentLibrary={() => {
          if (!canOpenNodePanel) return;
          setShowNodePanel(true);
          setPanelTab("content");
          setPanelFilter("all");
        }}
        onOpenExtensionPanel={() => {
          if (!canOpenExtensionPanel) return;
          if (showExtensionPanel) {
            setKeepExtensionPanelOpen(false);
            setExtensionWidth(370);
            closeContentEditor();
            setShowExtensionPanel(false);
            return;
          }
          const selectedEditableNode = nodes.find(
            (node) =>
              node.selected &&
              node.type === "content" &&
              (node.data?.category === "text" ||
                node.data?.category === "mindmap"),
          );
          if (selectedEditableNode) openContentEditor(selectedEditableNode.id);
          setShowExtensionPanel(true);
        }}
      />

      {localVideoAiWarning && (
        <div
          role="alert"
          className="absolute right-4 top-20 z-[70] flex max-w-[min(420px,calc(100%-32px))] items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 shadow-lg dark:border-amber-800 dark:bg-amber-950/90 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-5">AI 节点暂不支持本地上传的视频。</p>
          <button
            type="button"
            className="-mr-1 -mt-1 rounded p-1 text-amber-900/70 hover:bg-amber-200/70 hover:text-amber-950 dark:text-amber-100/70 dark:hover:bg-amber-900/60 dark:hover:text-amber-50"
            aria-label="关闭提示"
            onClick={() => setLocalVideoAiWarning(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {showNodePanel && (
        <aside data-node-panel className="absolute bottom-4 left-4 top-4 z-40 flex w-[260px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          <div className="mx-3 mt-2 flex items-center gap-1 p-2 px-0">
            <button
              className={`flex-1 rounded-full px-2 py-2 text-sm font-semibold text-foreground ${panelTab === "nodes" ? "bg-muted" : "hover:bg-muted"}`}
              onClick={() => setPanelTab("nodes")}
            >
              节点
            </button>
            <button
              className={`flex-1 rounded-full px-2 py-2 text-sm font-semibold text-foreground ${panelTab === "content" ? "bg-muted" : "hover:bg-muted"}`}
              onClick={() => setPanelTab("content")}
            >
              内容
            </button>
          </div>
          <div className="mx-3 flex items-center gap-2 p-2 px-0">
            <input
              value={panelSearch}
              onChange={(event) => setPanelSearch(event.target.value)}
              placeholder="搜索节点"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary"
            />
            <div data-node-filter-menu className="relative flex-none">
              <button
                type="button"
                aria-label="节点类型筛选"
                aria-haspopup="menu"
                aria-expanded={filterMenuOpen}
                onClick={() => setFilterMenuOpen((value) => !value)}
                className="inline-flex h-9 w-max items-center gap-1.5 whitespace-nowrap rounded-lg bg-card px-3 pr-2 text-left text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{panelFilterLabels[panelFilter]}</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${filterMenuOpen ? "rotate-180" : ""}`}
                />
              </button>
              {filterMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1.5 w-max min-w-[116px] space-y-1 rounded-xl border border-border bg-card p-1.5 text-left shadow-xl"
                >
                  {panelFilterOptions.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={panelFilter === value}
                      onClick={() => {
                        setPanelFilter(value);
                        setFilterMenuOpen(false);
                      }}
                      className={`flex w-full items-center rounded-lg px-2.5 py-2.5 text-left text-xs transition-colors ${panelFilter === value ? "bg-muted font-medium text-foreground" : "text-foreground hover:bg-muted"}`}
                    >
                      <span className="whitespace-nowrap text-left">
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 space-y-1 overflow-auto p-3">
            {(panelTab === "content"
              ? panelContentNodes
              : filteredPanelNodes
            ).map((node) => {
              const resourceLost = Boolean(node.data?.resourceLost);
              const disabled = isNodeDisabled(node);
              const isSourceItem = node.id.startsWith("source:");
              const linkedNodeId = isSourceItem ? undefined : node.id;
              return (
                <div
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  className={`flex h-12 w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-xs hover:bg-muted ${selectedPanelIds.includes(node.id) ? "bg-muted ring-1 ring-primary/40" : ""} ${disabled ? "opacity-60 grayscale" : resourceLost ? "opacity-80" : ""}`}
                  onClick={() =>
                    selectionMode
                      ? setSelectedPanelIds((ids) =>
                          ids.includes(node.id)
                            ? ids.filter((id) => id !== node.id)
                            : [...ids, node.id],
                        )
                      : linkedNodeId
                        ? focusNode(linkedNodeId)
                        : undefined
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    if (selectionMode) {
                      setSelectedPanelIds((ids) =>
                        ids.includes(node.id)
                          ? ids.filter((id) => id !== node.id)
                          : [...ids, node.id],
                      );
                    } else if (linkedNodeId) {
                      focusNode(linkedNodeId);
                    }
                  }}
                >
                  {selectionMode ? (
                    selectedPanelIds.includes(node.id) ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )
                  ) : (
                    <PanelNodeIcon
                      node={node}
                      isSourceItem={isSourceItem}
                      fallback={nodeIcon(node)}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {nodeDisplayName(node)}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {node.data?.description || nodeSummary(node)}
                    </span>
                  </span>
                  <span
                    className={`h-2 w-2 rounded-full ${resourceLost ? "bg-red-500" : disabled ? "bg-muted-foreground/40" : "bg-emerald-500"}`}
                    title={
                      resourceLost ? "资源丢失" : disabled ? "未启用" : "正常"
                    }
                  />
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    aria-label={isSourceItem ? "删除收藏标签" : "删除节点"}
                    title={isSourceItem ? "删除收藏标签" : "删除节点"}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isSourceItem && node.data?.sourceId) {
                        deleteSource(node.data.sourceId);
                        setSelectedPanelIds((ids) =>
                          ids.filter((id) => id !== node.id),
                        );
                      } else {
                        deleteNode(node.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            {((panelTab === "content" && panelContentNodes.length === 0) ||
              (panelTab !== "content" && filteredPanelNodes.length === 0)) && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                {panelTab === "content"
                  ? "暂无内容收藏"
                  : nodes.length === 0
                    ? "当前面板暂未创建节点"
                    : "暂无匹配节点"}
              </p>
            )}
          </div>
          <div className="mx-3 flex items-center gap-1 p-3 px-0">
            <button
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
              onClick={() => {
                setSelectionMode((value) => !value);
                setSelectedPanelIds([]);
              }}
            >
              {selectionMode ? (
                <X className="h-3.5 w-3.5" />
              ) : (
                <CheckSquare className="h-3.5 w-3.5" />
              )}
              {selectionMode ? "取消" : "选择"}
            </button>
            {selectionMode && (
              <>
                <button
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                  onClick={() =>
                    setSelectedPanelIds(
                      (panelTab === "content"
                        ? panelContentNodes
                        : filteredPanelNodes
                      ).map((node) => node.id),
                    )
                  }
                >
                  <Check className="h-3.5 w-3.5" />
                  全选
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    const selected = nodes.filter((node) =>
                      selectedPanelIds.includes(node.id),
                    );
                    const blob = new Blob(
                      [JSON.stringify({ nodes: selected }, null, 2)],
                      { type: "application/json" },
                    );
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "selected-nodes.json";
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  导出
                </button>
              </>
            )}
          </div>
        </aside>
      )}

      {showExtensionPanel && (
        <aside
          className="absolute bottom-4 right-4 top-4 z-40 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
          style={{ width: extensionWidth, minWidth: 280, maxWidth: "70%" }}
        >
          <div
            className={`group absolute -left-1 top-0 z-10 h-full w-2 cursor-ew-resize ${isResizingPanel ? "bg-emerald-400/20" : "hover:bg-emerald-400/20"}`}
            title="拖动调整宽度，单击最大化"
            onMouseDown={(event) => {
              event.preventDefault();
              setKeepExtensionPanelOpen(true);
              const startX = event.clientX;
              const startWidth = extensionWidth;
              const startViewport = reactFlowInstance.getViewport();
              setIsResizingPanel(true);
              document.body.style.userSelect = "none";
              let pendingWidth = startWidth;
              let didDrag = false;
              const move = (moveEvent: MouseEvent) => {
                if (Math.abs(moveEvent.clientX - startX) >= 3) didDrag = true;
                pendingWidth = Math.max(
                  280,
                  Math.min(
                    maximumExtensionWidth,
                    startWidth + startX - moveEvent.clientX,
                  ),
                );
                if (resizeFrameRef.current !== null) return;
                resizeFrameRef.current = requestAnimationFrame(() => {
                  resizeFrameRef.current = null;
                  const widthDelta = pendingWidth - startWidth;
                  setExtensionWidth(pendingWidth);
                  void reactFlowInstance.setViewport({
                    ...startViewport,
                    x: startViewport.x - widthDelta,
                  });
                });
              };
              const up = () => {
                if (resizeFrameRef.current !== null)
                  cancelAnimationFrame(resizeFrameRef.current);
                resizeFrameRef.current = null;
                if (!didDrag) {
                  const widthDelta = maximumExtensionWidth - startWidth;
                  setExtensionWidth(maximumExtensionWidth);
                  void reactFlowInstance.setViewport({
                    ...startViewport,
                    x: startViewport.x - widthDelta,
                  });
                }
                document.body.style.userSelect = "";
                setIsResizingPanel(false);
                resizeCleanupRef.current = null;
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
              };
              resizeCleanupRef.current = up;
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
            }}
          >
            <div className="absolute left-0 top-1/2 h-16 w-0.5 -translate-y-1/2 rounded-full bg-transparent group-hover:bg-emerald-400" />
          </div>
          <div className="flex shrink-0 items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <Layers3 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                {nodes.find((node) => node.id === editorNodeId)?.data?.label ||
                  nodes.find((node) => node.selected)?.data?.label ||
                  "未选中节点"}
              </h2>
            </div>
            <button
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label="关闭面板"
              onClick={() => {
                setKeepExtensionPanelOpen(false);
                setExtensionWidth(370);
                setShowExtensionPanel(false);
                closeContentEditor();
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {editorNodeId ? (
            <ContentEditorPanel nodeId={editorNodeId} />
          ) : nodes.some((node) => node.selected) ? (
            <p className="px-4 text-xs leading-relaxed text-muted-foreground">
              在这里查看当前选中节点的内容和可用操作。
            </p>
          ) : (
            <div className="flex h-[calc(100%-56px)] flex-col items-center justify-center px-8 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Layers3 className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                在画布上选中一个节点，即可在这里查看内容
              </p>
            </div>
          )}
        </aside>
      )}

      {/* React Flow 画布 */}
      <div
        ref={reactFlowWrapper}
        className="relative h-full w-full overflow-hidden"
        onDoubleClickCapture={handleCanvasDoubleClick}
        onContextMenu={(event) => {
          if (isEditableTarget(event.target) || nodes.some((node) => node.selected)) return;
          const target = event.target as HTMLElement;
          if (target.closest(".react-flow__node, .react-flow__edge, .react-flow__panel, .react-flow__controls")) return;
          event.preventDefault();
          const rect = reactFlowWrapper.current?.getBoundingClientRect();
          const rawX = event.clientX - (rect?.left || 0);
          const rawY = event.clientY - (rect?.top || 0);
          const maxX = Math.max(FLOATING_MENU_MARGIN, (rect?.width || 0) - 188);
          const maxY = Math.max(FLOATING_MENU_MARGIN, (rect?.height || 0) - 106);
          setCanvasContextMenu({
            x: Math.max(FLOATING_MENU_MARGIN, Math.min(rawX, maxX)),
            y: Math.max(FLOATING_MENU_MARGIN, Math.min(rawY, maxY)),
            clientX: event.clientX,
            clientY: event.clientY,
          });
          setAddMenu(null);
          setConnectionMenu(null);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleFileDrop}
      >
        {isCurrentFlowReady ? (
        <ReactFlow
          key={currentFlowId || flowId}
          nodes={nodes}
          edges={renderedEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onSelectionStart={handleSelectionStart}
          onSelectionEnd={handleSelectionEnd}
          isValidConnection={isValidFlowConnection}
          connectionRadius={48}
          connectionLineType={ConnectionLineType.Bezier}
          connectionLineStyle={CONNECTION_LINE_STYLE}
          nodeTypes={stableNodeTypes}
          edgeTypes={stableEdgeTypes}
          onError={handleReactFlowError}
          nodesDraggable={!isLocked}
          nodesConnectable={!isLocked}
          elementsSelectable={!isLocked}
          deleteKeyCode={null}
          selectNodesOnDrag={false}
          selectionOnDrag
          selectionKeyCode="Shift"
          multiSelectionKeyCode={MULTI_SELECTION_KEYS}
          panActivationKeyCode="Space"
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          defaultViewport={currentFlow?.viewport}
          proOptions={{ hideAttribution: true }}
          fitView={!currentFlow?.viewport}
          fitViewOptions={FLOW_FIT_VIEW_OPTIONS}
          zoomOnDoubleClick={false}
          onMoveStart={closeCanvasMenus}
          onMoveEnd={handleMoveEnd}
          minZoom={0.1}
          maxZoom={4}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        >
          <Background color="var(--border)" gap={16} />
          <NodeToolbar
            nodeId={marqueeSelectionIds}
            isVisible={marqueeSelectionIds.length > 1}
            position={Position.Top}
            offset={12}
            className="nodrag nowheel"
          >
            <div className="flex items-center overflow-hidden rounded-full border border-border bg-card text-xs shadow-lg">
              <span className="px-3 py-2 font-medium text-muted-foreground">
                已选择 {marqueeSelectionIds.length} 个
              </span>
              <span className="h-5 w-px bg-border" />
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-3 py-2 font-medium text-foreground hover:bg-muted"
                onClick={(event) => { event.stopPropagation(); createGroup(); }}
              >
                <FolderPlus className="h-3.5 w-3.5" />
                编组
              </button>
            </div>
          </NodeToolbar>
        </ReactFlow>
        ) : (
          <div className="h-full w-full bg-background" aria-hidden="true" />
        )}
        {isCurrentFlowReady && showMinimap && (
          <InteractiveMiniMap
            right={showExtensionPanel ? extensionWidth + 24 : 24}
          />
        )}
      </div>

      {canvasContextMenu && (
        <div
          data-canvas-context-menu
          className="absolute z-[59] w-44 rounded-xl border border-border bg-card p-1.5 shadow-lg"
          style={{ left: canvasContextMenu.x, top: canvasContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              const point = canvasContextMenu;
              setCanvasContextMenu(null);
              void readSystemClipboardAndImport(point.clientX, point.clientY);
            }}
          >
            <ClipboardPaste className="h-4 w-4 text-muted-foreground" />
            粘贴
          </button>
          <p className="px-3 pb-1 pt-1 text-[10px] leading-4 text-muted-foreground">
            浏览器拒绝读取时，请使用 Ctrl/Cmd+V
          </p>
        </div>
      )}

      {connectionMenu && (
        <div
          data-connection-menu
          className="absolute z-[58] w-48 rounded-xl border border-border bg-card p-1.5 shadow-xl"
          style={{ left: connectionMenu.x, top: connectionMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
            选择要连接的节点
          </p>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => createConnectedNode("ai")}
          >
            <NodeMenuIcon kind="ai" />
            AI 节点
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => createConnectedNode("content")}
          >
            <NodeMenuIcon kind="content" />
            内容节点
          </button>
        </div>
      )}

      {addMenu && (
        <div
          ref={addMenuRef}
          data-canvas-add-menu
          className="absolute z-[55] w-60 select-none rounded-xl border border-border bg-card p-1.5 shadow-xl"
          style={{
            left: addMenuLayout?.left ?? addMenu.x,
            top: addMenuLayout?.top ?? addMenu.y,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="space-y-0.5">
            <button
              className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() =>
                addNodeAt(
                  "ai",
                  reactFlowInstance.screenToFlowPosition({
                    x: addMenu.x + (reactFlowWrapper.current?.getBoundingClientRect().left || 0),
                    y: addMenu.y + (reactFlowWrapper.current?.getBoundingClientRect().top || 0),
                  }),
                )
              }
            >
              <NodeMenuIcon kind="ai" />
              添加 AI 节点
            </button>
            <button
              className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() =>
                addNodeAt(
                  "content",
                  reactFlowInstance.screenToFlowPosition({
                    x: addMenu.x + (reactFlowWrapper.current?.getBoundingClientRect().left || 0),
                    y: addMenu.y + (reactFlowWrapper.current?.getBoundingClientRect().top || 0),
                  }),
                )
              }
            >
              <NodeMenuIcon kind="content" />
              添加内容节点
            </button>
            <button
              className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() =>
                addNodeAt(
                  "browser",
                  reactFlowInstance.screenToFlowPosition({
                    x: addMenu.x + (reactFlowWrapper.current?.getBoundingClientRect().left || 0),
                    y: addMenu.y + (reactFlowWrapper.current?.getBoundingClientRect().top || 0),
                  }),
                )
              }
            >
              <NodeMenuIcon kind="browser" />
              添加浏览器节点
            </button>
          </div>
          <div className="my-1 h-px bg-border/50" />
          <button
            className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() =>
              addNodeAt(
                "sticky",
                reactFlowInstance.screenToFlowPosition({
                  x: addMenu.x + (reactFlowWrapper.current?.getBoundingClientRect().left || 0),
                  y: addMenu.y + (reactFlowWrapper.current?.getBoundingClientRect().top || 0),
                }),
              )
            }
          >
            <NodeMenuIcon kind="sticky" />
            添加贴纸
          </button>
          <div className="my-1 h-px bg-border/50" />
          <div
            ref={libraryTriggerRef}
            className="relative"
            onMouseEnter={() => {
              if (libraryCloseTimerRef.current !== null) {
                window.clearTimeout(libraryCloseTimerRef.current);
                libraryCloseTimerRef.current = null;
              }
              setLibraryMenuOpen(true);
            }}
            onMouseLeave={() => {
              libraryCloseTimerRef.current = window.setTimeout(
                () => setLibraryMenuOpen(false),
                140,
              );
            }}
          >
            <button
              className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => setLibraryMenuOpen(true)}
            >
              <NodeMenuIcon kind="library" />
              <span className="min-w-0 flex-1">
                内容资料库 ({libraryItems.length})
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {libraryMenuOpen && (
              <div
                ref={libraryMenuRef}
                className="absolute left-[calc(100%-4px)] top-0 z-[56] w-56 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-1.5 shadow-xl"
                style={
                  libraryMenuLayout || { maxHeight: "calc(100dvh - 24px)" }
                }
                onMouseEnter={() => {
                  if (libraryCloseTimerRef.current !== null) {
                    window.clearTimeout(libraryCloseTimerRef.current);
                    libraryCloseTimerRef.current = null;
                  }
                }}
                onMouseLeave={() => {
                  libraryCloseTimerRef.current = window.setTimeout(
                    () => setLibraryMenuOpen(false),
                    140,
                  );
                }}
              >
                <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
                  最近使用
                </p>
                {libraryItems.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-muted"
                    onClick={async () => {
                      await retainLocalResource(getContentResourceId(item.nodeData));
                      addNode({
                        type: "content",
                        position: reactFlowInstance.screenToFlowPosition({
                          x: addMenu.x + (reactFlowWrapper.current?.getBoundingClientRect().left || 0),
                          y: addMenu.y + (reactFlowWrapper.current?.getBoundingClientRect().top || 0),
                        }),
                        data: {
                          ...item.nodeData,
                          label: item.title,
                          sourceId: undefined,
                        },
                      });
                      setAddMenu(null);
                      setLibraryMenuOpen(false);
                    }}
                  >
                    <span className="h-6 w-6">
                      {nodeIcon(
                        {
                          type: "content",
                          data: item.nodeData,
                        },
                        "h-3.5 w-3.5",
                      )}
                    </span>
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
                {libraryItems.length === 0 && (
                  <p className="px-3 py-3 text-xs text-muted-foreground">
                    暂无内容收藏
                  </p>
                )}
                {libraryItems.length > 8 && (
                  <button
                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-primary hover:bg-muted"
                    onClick={() => {
                      setShowNodePanel(true);
                      setPanelTab("content");
                      setPanelFilter("all");
                      setAddMenu(null);
                      setLibraryMenuOpen(false);
                    }}
                  >
                    展开更多
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              setAddMenu(null);
              document.getElementById("flow-file-import")?.click();
            }}
          >
            <NodeMenuIcon kind="import" />
            导入文件
          </button>
          <input
            id="flow-file-import"
            type="file"
            className="hidden"
            accept={`.json,${CONTENT_FILE_ACCEPT}`}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const extension = file.name.split(".").pop()?.toLowerCase();
              const bounds = reactFlowWrapper.current?.getBoundingClientRect();
              const position = reactFlowInstance.screenToFlowPosition({
                x: addMenu.x + (bounds?.left || 0),
                y: addMenu.y + (bounds?.top || 0),
              });
              if (extension === "json") {
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    useFlowStore
                      .getState()
                      .importFlowFromJSON(String(reader.result || ""));
                  } catch (error) {
                    console.error("导入失败:", error);
                  }
                };
                reader.readAsText(file);
              } else {
                const created = addNode({
                  type: "content",
                  position,
                  data: emptyContentData(file.name || "内容"),
                });
                void importContentIntoNode(created.id, { kind: "file", file, fileName: file.name });
              }
              event.currentTarget.value = "";
            }}
          />
        </div>
      )}

      {/* 左下角画布控制 */}
      <CanvasControls
        minimapVisible={showMinimap}
        leftOffset={showNodePanel ? 284 : 24}
        onToggleMinimap={() => setShowMinimap((value) => !value)}
        onArrange={arrangeNodes}
        onGuide={() => setShowGuide(true)}
      />

      {showGuide && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold">快捷键</h2>
              <button
                className="text-xs text-muted-foreground"
                onClick={() => setShowGuide(false)}
              >
                关闭
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <p className="flex justify-between">
                <span>Ctrl / Space + 拖动</span>
                <span className="text-muted-foreground">
                  临时切换选择 / 移动
                </span>
              </p>
              <p className="flex justify-between">
                <span>滚轮</span>
                <span className="text-muted-foreground">缩放画布</span>
              </p>
              <p className="flex justify-between">
                <span>拖动</span>
                <span className="text-muted-foreground">框选多个节点</span>
              </p>
              <p className="flex justify-between">
                <span>Shift / Cmd + 点击</span>
                <span className="text-muted-foreground">追加选择节点</span>
              </p>
              <p className="flex justify-between">
                <span>Ctrl / Cmd + C / V</span>
                <span className="text-muted-foreground">复制 / 粘贴节点</span>
              </p>
              <p className="flex justify-between">
                <span>Delete / Backspace</span>
                <span className="text-muted-foreground">删除选中节点或连接线</span>
              </p>
              <p className="flex justify-between">
                <span>双击空白</span>
                <span className="text-muted-foreground">添加节点</span>
              </p>
              <p className="flex justify-between">
                <span>空格 + 左键 / 鼠标中键</span>
                <span className="text-muted-foreground">拖动画布</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function FlowEditor() {
  return (
    <ReactFlowProvider>
      <FlowEditorInner />
    </ReactFlowProvider>
  );
}
