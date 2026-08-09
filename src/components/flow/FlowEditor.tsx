"use client";

import { useCallback, useState } from "react";
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
} from "reactflow";
import "reactflow/dist/style.css";
import { Button } from "@/components/ui/button";
import { Plus, Play, Save } from "lucide-react";

// 节点类型定义
export type NodeType =
  | "ai-chat"
  | "web-scrape"
  | "youtube"
  | "extract"
  | "output"
  | "condition";

export interface FlowNodeData {
  label: string;
  type: NodeType;
  config?: Record<string, unknown>;
  status?: "idle" | "running" | "success" | "error";
}

// 初始节点
const initialNodes: Node<FlowNodeData>[] = [
  {
    id: "1",
    type: "input",
    data: { label: "开始", type: "ai-chat" },
    position: { x: 250, y: 50 },
  },
];

const initialEdges: Edge[] = [];

export function FlowEditor() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isRunning, setIsRunning] = useState(false);

  // 连接节点
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges]
  );

  // 添加节点
  const addNode = useCallback(
    (type: NodeType) => {
      const newNode: Node<FlowNodeData> = {
        id: `${Date.now()}`,
        type: "default",
        data: { label: `${type} 节点`, type },
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
      // TODO: 实现执行逻辑
      console.log("执行流程", { nodes, edges });
    } finally {
      setIsRunning(false);
    }
  }, [nodes, edges]);

  // 保存流程
  const saveFlow = useCallback(() => {
    const flowData = { nodes, edges };
    console.log("保存流程", flowData);
    // TODO: 保存到数据库
  }, [nodes, edges]);

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
            onClick={() => addNode("ai-chat")}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            AI 对话
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addNode("web-scrape")}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            网页抓取
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addNode("output")}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
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
