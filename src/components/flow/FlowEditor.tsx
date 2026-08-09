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
import { Plus, Play, Save, FileText, Bot, Globe, FileOutput } from "lucide-react";
import { AINode, AINodeData } from "./nodes/AINode";
import { ContentNode, ContentNodeData } from "./nodes/ContentNode";
import { BrowserNode, BrowserNodeData } from "./nodes/BrowserNode";
import { OutputNode, OutputNodeData } from "./nodes/OutputNode";
import { createFlow, updateFlow } from "@/lib/db/flows-api";

// 节点类型定义
export type NodeType = "ai" | "content" | "browser" | "output";

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

  // 定义自定义节点类型
  const nodeTypes: NodeTypes = useMemo(
    () => ({
      ai: AINode,
      content: ContentNode,
      browser: BrowserNode,
      output: OutputNode,
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
        },
        position: {
          x: Math.random() * 400 + 100,
          y: Math.random() * 400 + 100,
        },
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

  return (
    <div className="flex flex-1 flex-col h-screen">
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
            onClick={() => addNode("output", "输出节点")}
            className="gap-2"
          >
            <FileOutput className="h-4 w-4" />
            输出
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
          nodeTypes={nodeTypes}
          fitView
          className="bg-background"
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
