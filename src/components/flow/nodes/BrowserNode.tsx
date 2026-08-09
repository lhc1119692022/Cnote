"use client";

import { memo, useState, useRef, useEffect } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, ExternalLink, Loader2, FileText } from "lucide-react";

export interface BrowserNodeData {
  label: string;
  url?: string;
  content?: string;
  status?: "idle" | "loading" | "success" | "error";
}

export const BrowserNode = memo(({ id, data, selected }: NodeProps<BrowserNodeData>) => {
  const [url, setUrl] = useState(data.url || "");
  const [isLoading, setIsLoading] = useState(false);
  const [content, setContent] = useState(data.content || "");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleLoad = async () => {
    if (!url.trim()) return;

    setIsLoading(true);
    try {
      // 抓取网页内容
      const response = await fetch(`/api/web/scrape?url=${encodeURIComponent(url)}`);
      if (response.ok) {
        const data = await response.json();
        setContent(data.content);
      }
    } catch (error) {
      console.error("加载网页失败:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleLoad();
    }
  };

  return (
    <Card
      className={`min-w-[400px] ${
        selected ? "ring-2 ring-primary" : ""
      }`}
    >
      {/* 节点头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">{data.label}</span>
        </div>
      </div>

      {/* 节点内容 */}
      <div className="p-4 space-y-3">
        {/* URL 输入 */}
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="输入网址..."
            className="text-sm"
            disabled={isLoading}
          />
          <Button
            size="sm"
            onClick={handleLoad}
            disabled={isLoading || !url.trim()}
            className="gap-2 shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ExternalLink className="h-3 w-3" />
            )}
          </Button>
        </div>

        {/* 浏览器预览 */}
        {url && !isLoading && (
          <div className="border border-border rounded-lg overflow-hidden bg-white">
            <iframe
              ref={iframeRef}
              src={url}
              className="w-full h-[300px]"
              sandbox="allow-same-origin allow-scripts"
              title="Browser preview"
            />
          </div>
        )}

        {/* 内容预览 */}
        {content && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3 w-3" />
              <span>抓取的内容</span>
            </div>
            <div className="p-3 rounded-lg bg-muted text-xs whitespace-pre-wrap max-h-[150px] overflow-y-auto">
              {content}
            </div>
          </div>
        )}
      </div>

      {/* 输出连接点 (网页内容作为上下文) */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-blue-500"
      />
    </Card>
  );
});

BrowserNode.displayName = "BrowserNode";
