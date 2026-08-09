"use client";

import { memo, useState } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Bot, Play, Settings, Loader2 } from "lucide-react";

export interface AINodeData {
  label: string;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
  response?: string;
  status?: "idle" | "running" | "success" | "error";
  contextVariables?: Record<string, string>;
}

const models = [
  { value: "gpt-4", label: "GPT-4" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  { value: "claude-3-opus", label: "Claude 3 Opus" },
  { value: "claude-3-sonnet", label: "Claude 3 Sonnet" },
  { value: "gemini-pro", label: "Gemini Pro" },
];

export const AINode = memo(({ id, data, selected }: NodeProps<AINodeData>) => {
  const [prompt, setPrompt] = useState(data.userPrompt || "");
  const [model, setModel] = useState(data.model || "gpt-4");
  const [showSettings, setShowSettings] = useState(false);

  const isRunning = data.status === "running";

  return (
    <Card
      className={`min-w-[320px] ${
        selected ? "ring-2 ring-primary" : ""
      } ${
        data.status === "error" ? "border-red-500" : ""
      }`}
    >
      {/* 输入连接点 */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-blue-500"
      />

      {/* 节点头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">{data.label}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* 节点内容 */}
      <div className="p-4 space-y-3">
        {showSettings && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">模型</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background"
            >
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 上下文变量 */}
        {data.contextVariables && Object.keys(data.contextVariables).length > 0 && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">可用变量</label>
            <div className="flex flex-wrap gap-1">
              {Object.keys(data.contextVariables).map((varName) => (
                <button
                  key={varName}
                  className="px-2 py-1 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20"
                  onClick={() => setPrompt(prompt + ` {{${varName}}}`)}
                >
                  {varName}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 提示词输入 */}
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">提示词</label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入提示词，使用 {{变量名}} 引用上游内容"
            className="min-h-[80px] text-sm"
            disabled={isRunning}
          />
        </div>

        {/* AI 响应 */}
        {data.response && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">响应</label>
            <div className="p-3 rounded-lg bg-muted text-sm whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {data.response}
            </div>
          </div>
        )}

        {/* 运行按钮 */}
        <Button
          size="sm"
          className="w-full gap-2"
          disabled={isRunning || !prompt.trim()}
        >
          {isRunning ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Play className="h-3 w-3" />
              运行
            </>
          )}
        </Button>
      </div>

      {/* 输出连接点 */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-green-500"
      />
    </Card>
  );
});

AINode.displayName = "AINode";
