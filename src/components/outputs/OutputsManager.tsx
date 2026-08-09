"use client";

import { useState } from "react";
import { Plus, Search, Trash2, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

interface Output {
  id: string;
  flowName: string;
  content: string;
  createdAt: Date;
}

export function OutputsManager() {
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // 搜索过滤
  const filteredOutputs = outputs.filter((output) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      output.flowName?.toLowerCase().includes(query) ||
      output.content?.toLowerCase().includes(query)
    );
  });

  // 删除输出
  const handleDelete = (id: string) => {
    if (confirm("确定要删除这个输出吗？")) {
      setOutputs(outputs.filter((o) => o.id !== id));
    }
  };

  // 导出为文本
  const handleExport = (output: Output) => {
    const blob = new Blob([output.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${output.flowName}-${output.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <div className="space-y-6">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">输出管理</h1>
            <p className="text-muted-foreground">
              查看和管理工作流的执行结果
            </p>
          </div>
        </div>

        {/* 搜索栏 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索输出..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* 输出列表 */}
        {filteredOutputs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {searchQuery ? "没有找到匹配的输出" : "还没有输出"}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              {searchQuery
                ? "尝试使用不同的搜索词"
                : "运行工作流后，输出结果会显示在这里"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOutputs.map((output) => (
              <Card key={output.id} className="group relative p-6 hover:shadow-md transition-shadow">
                {/* 删除按钮 */}
                <button
                  onClick={() => handleDelete(output.id)}
                  className="absolute top-4 right-4 z-10 h-8 w-8 rounded-full bg-background/80 hover:bg-destructive hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                {/* 内容区域 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">{output.flowName}</h3>
                    <span className="text-xs text-muted-foreground">
                      {output.createdAt.toLocaleString("zh-CN")}
                    </span>
                  </div>

                  <div className="p-4 rounded-lg bg-muted/30 font-mono text-sm max-h-40 overflow-y-auto">
                    {output.content}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExport(output)}
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      导出 TXT
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
