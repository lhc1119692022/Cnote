"use client";

import { memo, useState } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Edit2, Save, X } from "lucide-react";

export interface ContentNodeData {
  label: string;
  content: string;
  type: "text" | "youtube" | "pdf" | "image" | "video" | "table";
  editable?: boolean;
}

export const ContentNode = memo(({ id, data, selected }: NodeProps<ContentNodeData>) => {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(data.content || "");

  const handleSave = () => {
    setIsEditing(false);
    // TODO: 保存到节点数据
  };

  const getTypeColor = () => {
    switch (data.type) {
      case "youtube": return "text-red-500";
      case "pdf": return "text-orange-500";
      case "image": return "text-purple-500";
      case "video": return "text-pink-500";
      case "table": return "text-green-500";
      default: return "text-blue-500";
    }
  };

  return (
    <Card
      className={`min-w-[300px] max-w-[400px] ${
        selected ? "ring-2 ring-primary" : ""
      }`}
    >
      {/* 输入连接点 (用于从AI节点接收内容) */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-purple-500"
      />

      {/* 节点头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <FileText className={`h-4 w-4 ${getTypeColor()}`} />
          <span className="font-medium text-sm">{data.label}</span>
        </div>
        <div className="flex items-center gap-1">
          {!isEditing ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsEditing(true)}
            >
              <Edit2 className="h-3 w-3" />
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleSave}
              >
                <Save className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  setIsEditing(false);
                  setContent(data.content || "");
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 节点内容 */}
      <div className="p-4">
        {isEditing ? (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[120px] text-sm"
            placeholder="输入内容..."
          />
        ) : (
          <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto">
            {content || "暂无内容"}
          </div>
        )}
      </div>

      {/* 输出连接点 (用于传递给AI节点作为上下文) */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-blue-500"
      />
    </Card>
  );
});

ContentNode.displayName = "ContentNode";
