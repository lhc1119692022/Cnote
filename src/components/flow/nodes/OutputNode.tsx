"use client";

import { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileOutput, Download, Copy } from "lucide-react";

export interface OutputNodeData {
  label: string;
  content?: string;
  format?: "text" | "markdown" | "json";
}

export const OutputNode = memo(({ id, data, selected }: NodeProps<OutputNodeData>) => {
  const handleDownload = () => {
    if (!data.content) return;

    const blob = new Blob([data.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `output-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    if (!data.content) return;
    navigator.clipboard.writeText(data.content);
  };

  return (
    <Card
      className={`min-w-[300px] max-w-[400px] ${
        selected ? "ring-2 ring-primary" : ""
      }`}
    >
      {/* 输入连接点 */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-green-500"
      />

      {/* 节点头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <FileOutput className="h-4 w-4 text-green-500" />
          <span className="font-medium text-sm">{data.label}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCopy}
            disabled={!data.content}
          >
            <Copy className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleDownload}
            disabled={!data.content}
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* 节点内容 */}
      <div className="p-4">
        {data.content ? (
          <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto p-3 rounded-lg bg-muted">
            {data.content}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-8">
            等待上游节点输出
          </div>
        )}
      </div>
    </Card>
  );
});

OutputNode.displayName = "OutputNode";
