"use client";

import { useCallback, useState, useMemo, useEffect } from "react";
import ReactFlow, {
  Node,
  Edge,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
  NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Play, Save, FileText, Bot, Globe, FileOutput, Download, FileUp, Square, FileType } from "lucide-react";
import { AINode, AINodeData } from "./nodes/AINode";
import { ContentNode, ContentNodeData } from "./nodes/ContentNode";
import { BrowserNode, BrowserNodeData } from "./nodes/BrowserNode";
import { OutputNode, OutputNodeData } from "./nodes/OutputNode";
import { GroupNode, GroupNodeData } from "./nodes/GroupNode";
import { PDFNode, PDFNodeData } from "./nodes/PDFNode";
import { createFlow, updateFlow } from "@/lib/db/flows-api";
import {
  exportFlowAsPNG,
  exportFlowAsJSON,
  exportFlowAsFullPackage,
  importFlowPackage,
  saveFlowAsTemplate,
} from "@/lib/flow-export";

// 节点类型定义
export type NodeType = "ai" | "content" | "browser" | "output" | "group" | "pdf";

// 初始节点
const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

interface FlowEditorProps {
  flowId?: string;
  initialData?: {
    nodes: Node[];
    edges: Edge[];
    name: string;
  };
}

export function FlowEditor({ flowId, initialData }: FlowEditorProps = {}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialData?.nodes || initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialData?.edges || initialEdges);
  const [isRunning, setIsRunning] = useState(false);
  const [currentFlowId, setCurrentFlowId] = useState(flowId);
  const [flowName, setFlowName] = useState(initialData?.name || "未命名流程");
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  // 从 sessionStorage 加载模板数据
  useEffect(() => {
    const templateData = sessionStorage.getItem("templateData");
    if (templateData && !flowId) {
      try {
        const { nodes: templateNodes, edges: templateEdges, name } = JSON.parse(templateData);
        if (templateNodes && templateEdges) {
          setNodes(templateNodes);
          setEdges(templateEdges);
          setFlowName(name || "未命名流程");
        }
        // 清除 sessionStorage
        sessionStorage.removeItem("templateData");
      } catch (error) {
        console.error("加载模板数据失败:", error);
      }
    }
  }, [flowId, setNodes, setEdges]);

  // 定义自定义节点类型
  const nodeTypes: NodeTypes = useMemo(
    () => ({
      ai: AINode,
      content: ContentNode,
      browser: BrowserNode,
      output: OutputNode,
      group: GroupNode,
      pdf: PDFNode,
    }),
    []
  );

  // 连接节点
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));

      // 更新AI节点的上下文变量
      if (connection.target) {
        updateNodeContextVariables(connection.target);
      }
    },
    [setEdges]
  );

  // 更新节点的上下文变量
  const updateNodeContextVariables = (nodeId: string) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId && node.type === "ai") {
          // 查找所有连接到此节点的边
          const incomingEdges = edges.filter((edge) => edge.target === nodeId);
          const contextVariables: Record<string, string> = {};

          incomingEdges.forEach((edge) => {
            const sourceNode = nds.find((n) => n.id === edge.source);
            if (sourceNode) {
              const varName = sourceNode.data.label || sourceNode.id;
              contextVariables[varName] = sourceNode.id;
            }
          });

          return {
            ...node,
            data: {
              ...node.data,
              contextVariables,
            } as AINodeData,
          };
        }
        return node;
      })
    );
  };

  // 添加节点
  const addNode = useCallback(
    (type: NodeType, label: string) => {
      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type,
        data: {
          label,
          ...(type === "content" && { content: "", type: "text" }),
          ...(type === "ai" && { model: "gpt-4", contextVariables: {} }),
          ...(type === "browser" && { url: "", content: "" }),
          ...(type === "output" && { content: "" }),
          ...(type === "group" && { description: "", color: "#f0f0f0" }),
          ...(type === "pdf" && { source: "file", text: "", pages: 0 }),
        },
        position: {
          x: Math.random() * 400 + 100,
          y: Math.random() * 400 + 100,
        },
        ...(type === "group" && {
          style: {
            width: 400,
            height: 300,
            zIndex: -1,
          },
        }),
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes]
  );

  // 执行流程
  const runFlow = useCallback(async () => {
    setIsRunning(true);
    try {
      // 拓扑排序，按依赖顺序执行节点
      const sortedNodes = topologicalSort(nodes, edges);

      for (const node of sortedNodes) {
        if (node.type === "ai") {
          await executeAINode(node, nodes, edges);
        } else if (node.type === "browser") {
          await executeBrowserNode(node);
        }
      }
    } catch (error) {
      console.error("执行流程失败:", error);
    } finally {
      setIsRunning(false);
    }
  }, [nodes, edges]);

  // 拓扑排序
  const topologicalSort = (nodes: Node[], edges: Edge[]): Node[] => {
    const adjacencyList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // 初始化
    nodes.forEach((node) => {
      adjacencyList.set(node.id, []);
      inDegree.set(node.id, 0);
    });

    // 构建图
    edges.forEach((edge) => {
      adjacencyList.get(edge.source)?.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    });

    // 找到所有入度为0的节点
    const queue: string[] = [];
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) {
        queue.push(nodeId);
      }
    });

    const sorted: Node[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = nodes.find((n) => n.id === nodeId);
      if (node) sorted.push(node);

      adjacencyList.get(nodeId)?.forEach((targetId) => {
        const newDegree = (inDegree.get(targetId) || 0) - 1;
        inDegree.set(targetId, newDegree);
        if (newDegree === 0) {
          queue.push(targetId);
        }
      });
    }

    return sorted;
  };

  // 执行AI节点
  const executeAINode = async (node: Node, allNodes: Node[], allEdges: Edge[]) => {
    // 更新节点状态为运行中
    setNodes((nds) =>
      nds.map((n) =>
        n.id === node.id
          ? { ...n, data: { ...n.data, status: "running" } }
          : n
      )
    );

    try {
      const nodeData = node.data as AINodeData;
      let prompt = nodeData.userPrompt || "";

      // 替换上下文变量
      if (nodeData.contextVariables) {
        Object.entries(nodeData.contextVariables).forEach(([varName, sourceId]) => {
          const sourceNode = allNodes.find((n) => n.id === sourceId);
          if (sourceNode) {
            const content =
              sourceNode.data.content || sourceNode.data.response || "";
            prompt = prompt.replace(new RegExp(`{{${varName}}}`, "g"), content);
          }
        });
      }

      // 调用AI API
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: nodeData.model,
          prompt,
          systemPrompt: nodeData.systemPrompt,
        }),
      });

      if (!response.ok) throw new Error("AI请求失败");

      const data = await response.json();

      // 更新节点数据
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  response: data.response,
                  status: "success",
                },
              }
            : n
        )
      );

      // 更新连接的输出节点
      const outgoingEdges = allEdges.filter((e) => e.source === node.id);
      outgoingEdges.forEach((edge) => {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === edge.target
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    content: data.response,
                  },
                }
              : n
          )
        );
      });
    } catch (error) {
      console.error("执行AI节点失败:", error);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? { ...n, data: { ...n.data, status: "error" } }
            : n
        )
      );
    }
  };

  // 执行浏览器节点
  const executeBrowserNode = async (node: Node) => {
    const nodeData = node.data as BrowserNodeData;
    if (!nodeData.url) return;

    setNodes((nds) =>
      nds.map((n) =>
        n.id === node.id
          ? { ...n, data: { ...n.data, status: "loading" } }
          : n
      )
    );

    try {
      const response = await fetch(
        `/api/web/scrape?url=${encodeURIComponent(nodeData.url)}`
      );
      if (!response.ok) throw new Error("网页抓取失败");

      const data = await response.json();

      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  content: data.content,
                  status: "success",
                },
              }
            : n
        )
      );
    } catch (error) {
      console.error("执行浏览器节点失败:", error);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? { ...n, data: { ...n.data, status: "error" } }
            : n
        )
      );
    }
  };

  // 保存流程
  const saveFlow = useCallback(async () => {
    try {
      if (currentFlowId) {
        // 更新现有流程
        await updateFlow(currentFlowId, {
          name: flowName,
          nodes: JSON.stringify(nodes),
          edges: JSON.stringify(edges),
        });
        console.log("流程已更新");
      } else {
        // 创建新流程
        const newFlow = await createFlow({
          name: flowName,
          nodes: JSON.stringify(nodes),
          edges: JSON.stringify(edges),
        });
        setCurrentFlowId(newFlow.id);
        console.log("流程已保存", newFlow.id);
      }
    } catch (error) {
      console.error("保存流程失败:", error);
    }
  }, [nodes, edges, flowName, currentFlowId]);

  // 导出相关状态
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
  const [templateFormData, setTemplateFormData] = useState({
    name: "",
    category: "内容处理",
    description: "",
  });

  // 导出为PNG
  const handleExportPNG = async () => {
    try {
      await exportFlowAsPNG("flow-canvas", `${flowName}.png`);
      setShowExportDialog(false);
    } catch (error) {
      console.error("导出PNG失败:", error);
    }
  };

  // 导出为JSON
  const handleExportJSON = () => {
    exportFlowAsJSON(nodes, edges, `${flowName}.json`);
    setShowExportDialog(false);
  };

  // 导出为完整包
  const handleExportFullPackage = () => {
    exportFlowAsFullPackage(nodes, edges, flowName, `${flowName}-package.json`);
    setShowExportDialog(false);
  };

  // 导入Flow
  const handleImportFlow = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const flowData = await importFlowPackage(file);
      setNodes(flowData.nodes);
      setEdges(flowData.edges);
      setFlowName(flowData.name);
      setShowImportDialog(false);
    } catch (error) {
      console.error("导入Flow失败:", error);
    }
  };

  // 保存为模板
  const handleSaveAsTemplate = async () => {
    try {
      await saveFlowAsTemplate(
        nodes,
        edges,
        templateFormData.name,
        templateFormData.category,
        templateFormData.description
      );
      setShowSaveTemplateDialog(false);
      setTemplateFormData({ name: "", category: "内容处理", description: "" });
    } catch (error) {
      console.error("保存模板失败:", error);
    }
  };

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "f" || event.key === "F") {
        setIsPresentationMode(false);
        setFocusedNodeId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 节点双击处理
  const handleNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setIsPresentationMode(true);
    setFocusedNodeId(node.id);
  }, []);

  return (
    <div className="flex flex-1 flex-col h-screen" id="flow-canvas">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">流程编辑器</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => addNode("content", "内容节点")}
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            内容
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addNode("ai", "AI节点")}
            className="gap-2"
          >
            <Bot className="h-4 w-4" />
            AI
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addNode("browser", "浏览器节点")}
            className="gap-2"
          >
            <Globe className="h-4 w-4" />
            浏览器
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addNode("pdf", "PDF节点")}
            className="gap-2"
          >
            <FileType className="h-4 w-4" />
            PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addNode("output", "输出节点")}
            className="gap-2"
          >
            <FileOutput className="h-4 w-4" />
            输出
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addNode("group", "分组")}
            className="gap-2"
          >
            <Square className="h-4 w-4" />
            分组
          </Button>

          <div className="w-px h-6 bg-border mx-2" />

          <Button
            variant="outline"
            size="sm"
            onClick={saveFlow}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            保存
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowExportDialog(true)}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            导出
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowImportDialog(true)}
            className="gap-2"
          >
            <FileUp className="h-4 w-4" />
            导入
          </Button>
          <Button
            size="sm"
            onClick={runFlow}
            disabled={isRunning}
            className="gap-2"
          >
            <Play className="h-4 w-4" />
            {isRunning ? "运行中..." : "运行"}
          </Button>
        </div>
      </div>

      {/* ReactFlow 画布 */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={handleNodeDoubleClick}
          nodeTypes={nodeTypes}
          fitView
          className="bg-background"
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>

        {/* 演示模式遮罩 */}
        {isPresentationMode && focusedNodeId && (
          <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
            onClick={() => {
              setIsPresentationMode(false);
              setFocusedNodeId(null);
            }}
          >
            <div className="bg-card p-8 rounded-lg max-w-4xl max-h-[80vh] overflow-auto">
              {nodes.find((n) => n.id === focusedNodeId)?.data && (
                <div>
                  <h2 className="text-2xl font-bold mb-4">
                    {nodes.find((n) => n.id === focusedNodeId)?.data.label}
                  </h2>
                  <pre className="text-sm whitespace-pre-wrap">
                    {JSON.stringify(
                      nodes.find((n) => n.id === focusedNodeId)?.data,
                      null,
                      2
                    )}
                  </pre>
                  <p className="text-sm text-muted-foreground mt-4">
                    按 F 键返回全局视图
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 导出对话框 */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导出工作流</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={handleExportPNG}
            >
              <Download className="h-4 w-4 mr-2" />
              导出为 PNG 图片
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={handleExportJSON}
            >
              <Download className="h-4 w-4 mr-2" />
              导出为 JSON（结构）
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={handleExportFullPackage}
            >
              <Download className="h-4 w-4 mr-2" />
              导出为完整包（含数据）
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                setShowExportDialog(false);
                setShowSaveTemplateDialog(true);
              }}
            >
              <Save className="h-4 w-4 mr-2" />
              保存为模板
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 导入对话框 */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入工作流</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              选择之前导出的工作流包文件（JSON格式）
            </p>
            <Input
              type="file"
              accept=".json"
              onChange={handleImportFlow}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 保存为模板对话框 */}
      <Dialog open={showSaveTemplateDialog} onOpenChange={setShowSaveTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存为模板</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">模板名称</Label>
              <Input
                id="template-name"
                placeholder="例如: YouTube视频总结"
                value={templateFormData.name}
                onChange={(e) =>
                  setTemplateFormData({ ...templateFormData, name: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-category">分类</Label>
              <Select
                value={templateFormData.category}
                onValueChange={(value) =>
                  setTemplateFormData({ ...templateFormData, category: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="内容处理">内容处理</SelectItem>
                  <SelectItem value="视频处理">视频处理</SelectItem>
                  <SelectItem value="翻译">翻译</SelectItem>
                  <SelectItem value="营销">营销</SelectItem>
                  <SelectItem value="研究分析">研究分析</SelectItem>
                  <SelectItem value="其他">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-description">描述</Label>
              <Textarea
                id="template-description"
                placeholder="简要描述这个模板的用途..."
                value={templateFormData.description}
                onChange={(e) =>
                  setTemplateFormData({ ...templateFormData, description: e.target.value })
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveTemplateDialog(false)}>
              取消
            </Button>
            <Button onClick={handleSaveAsTemplate} disabled={!templateFormData.name}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
