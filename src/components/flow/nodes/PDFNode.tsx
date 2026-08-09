"use client";

import { memo, useState } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileType, Upload } from "lucide-react";
import { processPDFFile, processPDFFromURL } from "@/lib/pdf-processor";

export interface PDFNodeData {
  label: string;
  source: "file" | "url";
  url?: string;
  fileName?: string;
  text?: string;
  pages?: number;
  status?: "idle" | "loading" | "success" | "error";
}

export const PDFNode = memo(({ id, data }: NodeProps<PDFNodeData>) => {
  const [source, setSource] = useState<"file" | "url">(data.source || "file");
  const [url, setUrl] = useState(data.url || "");
  const [fileName, setFileName] = useState(data.fileName || "");
  const [text, setText] = useState(data.text || "");
  const [pages, setPages] = useState(data.pages || 0);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    data.status || "idle"
  );

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("loading");
    setFileName(file.name);

    try {
      const result = await processPDFFile(file);
      setText(result.text);
      setPages(result.pages);
      setStatus("success");
    } catch (error) {
      console.error("PDF处理失败:", error);
      setStatus("error");
    }
  };

  const handleURLProcess = async () => {
    if (!url) return;

    setStatus("loading");

    try {
      const result = await processPDFFromURL(url);
      setText(result.text);
      setPages(result.pages);
      setFileName(url.split("/").pop() || "PDF文档");
      setStatus("success");
    } catch (error) {
      console.error("PDF处理失败:", error);
      setStatus("error");
    }
  };

  return (
    <Card className="w-80 p-4">
      <Handle type="target" position={Position.Top} />

      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <FileType className="h-5 w-5 text-purple-500" />
          <h3 className="font-semibold">{data.label}</h3>
        </div>

        <div className="space-y-2">
          <Label>来源</Label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={source === "file" ? "default" : "outline"}
              onClick={() => setSource("file")}
              className="flex-1"
            >
              文件上传
            </Button>
            <Button
              size="sm"
              variant={source === "url" ? "default" : "outline"}
              onClick={() => setSource("url")}
              className="flex-1"
            >
              URL
            </Button>
          </div>
        </div>

        {source === "file" ? (
          <div className="space-y-2">
            <Label htmlFor={`file-${id}`}>选择PDF文件</Label>
            <Input
              id={`file-${id}`}
              type="file"
              accept=".pdf"
              onChange={handleFileUpload}
              disabled={status === "loading"}
            />
            {fileName && (
              <p className="text-xs text-muted-foreground">已选择: {fileName}</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor={`url-${id}`}>PDF URL</Label>
            <div className="flex gap-2">
              <Input
                id={`url-${id}`}
                placeholder="https://example.com/document.pdf"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={status === "loading"}
              />
              <Button
                size="sm"
                onClick={handleURLProcess}
                disabled={!url || status === "loading"}
              >
                <Upload className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {status === "loading" && (
          <p className="text-sm text-blue-500">处理中...</p>
        )}

        {status === "success" && (
          <div className="text-sm space-y-1">
            <p className="text-green-500">✓ 处理完成</p>
            <p className="text-muted-foreground">页数: {pages}</p>
            <p className="text-muted-foreground">
              字符数: {text.length.toLocaleString()}
            </p>
          </div>
        )}

        {status === "error" && (
          <p className="text-sm text-red-500">✗ 处理失败</p>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
});

PDFNode.displayName = "PDFNode";
