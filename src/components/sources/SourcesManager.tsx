"use client";

import { useState, useEffect } from "react";
import { Plus, Search, Trash2, FileText, Link as LinkIcon, Video, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { createSource, deleteSource, getAllSources } from "@/lib/db/api";

type SourceType = "text" | "url" | "web" | "youtube" | "pdf" | "image" | "video" | "table";

interface Source {
  id: string;
  type: SourceType;
  title: string;
  rawText?: string;
  meta?: {
    url?: string;
    imageUrl?: string;
    videoUrl?: string;
    videoMimeType?: string;
    tableData?: string[][];
  };
  createdAt?: Date;
}

const contentTypes = [
  { value: "text", label: "文本", icon: FileText },
  { value: "url", label: "网址", icon: LinkIcon },
  { value: "youtube", label: "YouTube", icon: Video },
  { value: "web", label: "网页", icon: Globe },
];

export function SourcesManager() {
  const [sources, setSources] = useState<Source[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<SourceType>("text");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");

  // 加载所有内容源
  useEffect(() => {
    const loadSources = async () => {
      try {
        const allSources = await getAllSources();
        const mappedSources: Source[] = allSources.map((s) => ({
          id: s.id,
          type: s.type as SourceType,
          title: s.title,
          rawText: s.content,
          meta: s.metadata ? JSON.parse(s.metadata) : undefined,
          createdAt: s.createdAt,
        }));
        setSources(mappedSources);
      } catch (error) {
        console.error("加载内容源失败:", error);
      }
    };
    loadSources();
  }, []);

  // 搜索过滤
  const filteredSources = sources.filter(source => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      source.title?.toLowerCase().includes(query) ||
      source.type.toLowerCase().includes(query) ||
      source.rawText?.toLowerCase().includes(query)
    );
  });

  // 添加内容源
  const handleAddSource = async () => {
    // 验证
    if (selectedType === "text" && !content.trim()) {
      alert("请输入文本内容");
      return;
    }
    if (selectedType !== "text" && !url.trim()) {
      alert("请输入网址");
      return;
    }

    let rawText = selectedType === "text" ? content : undefined;
    const meta: Source["meta"] = {};

    // 根据类型处理内容
    if (selectedType === "youtube" && url.trim()) {
      meta.url = url;
      // 提取YouTube字幕
      try {
        const response = await fetch(`/api/youtube/transcript?url=${encodeURIComponent(url)}`);
        if (response.ok) {
          const data = await response.json();
          rawText = data.transcript;
        }
      } catch (error) {
        console.error("获取YouTube字幕失败:", error);
      }
    } else if (selectedType === "web" && url.trim()) {
      meta.url = url;
      // 抓取网页内容
      try {
        const response = await fetch(`/api/web/scrape?url=${encodeURIComponent(url)}`);
        if (response.ok) {
          const data = await response.json();
          rawText = data.content;
        }
      } catch (error) {
        console.error("抓取网页内容失败:", error);
      }
    } else if (selectedType === "url") {
      meta.url = url;
    }

    const newSource: Source = {
      id: Date.now().toString(),
      type: selectedType,
      title: title || `${selectedType} 内容`,
      rawText,
      meta,
      createdAt: new Date(),
    };

    // 保存到数据库
    try {
      const sourceToSave = {
        type: selectedType,
        title: title || `${selectedType} 内容`,
        content: rawText || "",
        metadata: JSON.stringify(meta),
      };
      const saved = await createSource(sourceToSave);
      setSources([...sources, { ...newSource, id: saved.id }]);
    } catch (error) {
      console.error("保存内容源失败:", error);
      setSources([...sources, newSource]);
    }

    // 重置表单
    setIsDialogOpen(false);
    setTitle("");
    setContent("");
    setUrl("");
    setSelectedType("text");
  };

  // 删除内容源
  const handleDeleteSource = async (id: string) => {
    if (confirm("确定要删除这个内容源吗？")) {
      try {
        await deleteSource(id);
        setSources(sources.filter(s => s.id !== id));
      } catch (error) {
        console.error("删除内容源失败:", error);
        setSources(sources.filter(s => s.id !== id));
      }
    }
  };

  // 获取类型图标
  const getTypeIcon = (type: SourceType) => {
    switch (type) {
      case "youtube": return Video;
      case "web": case "url": return Globe;
      case "pdf": return FileText;
      default: return FileText;
    }
  };

  // 获取类型颜色
  const getTypeColor = (type: SourceType) => {
    switch (type) {
      case "youtube": return "bg-red-500/10 text-red-500";
      case "web": case "url": return "bg-blue-500/10 text-blue-500";
      case "text": return "bg-green-500/10 text-green-500";
      default: return "bg-gray-500/10 text-gray-500";
    }
  };

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <div className="space-y-6">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">内容源</h1>
            <p className="text-muted-foreground">
              管理您的文本、网页、视频等内容源
            </p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            添加内容
          </Button>
        </div>

        {/* 搜索栏 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索内容源..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* 内容列表 */}
        {filteredSources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {searchQuery ? "没有找到匹配的内容" : "还没有内容源"}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              {searchQuery
                ? "尝试使用不同的搜索词"
                : "添加文本、网页链接、YouTube 视频或上传文件作为内容源"}
            </p>
            {!searchQuery && (
              <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                添加内容源
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSources.map((source) => {
              const TypeIcon = getTypeIcon(source.type);
              return (
                <Card key={source.id} className="group relative p-4 hover:shadow-md transition-shadow">
                  {/* 类型标签 */}
                  <div className="absolute top-3 left-3 z-10">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${getTypeColor(source.type)}`}>
                      <TypeIcon className="h-3.5 w-3.5" />
                      <span className="capitalize">{source.type}</span>
                    </div>
                  </div>

                  {/* 删除按钮 */}
                  <button
                    onClick={() => handleDeleteSource(source.id)}
                    className="absolute top-3 right-3 z-10 h-7 w-7 rounded-full bg-background/80 hover:bg-destructive hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>

                  {/* 内容区域 */}
                  <div className="pt-10 space-y-2">
                    <h3 className="font-semibold text-sm line-clamp-2">{source.title}</h3>
                    {source.rawText && (
                      <p className="text-xs text-muted-foreground line-clamp-3">
                        {source.rawText}
                      </p>
                    )}
                    {source.meta?.url && (
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {source.meta.url}
                      </p>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 添加对话框 */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>添加内容源</DialogTitle>
            <DialogDescription>
              添加文本、网页链接或 YouTube 视频作为内容源
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* 类型选择 */}
            <div className="grid grid-cols-4 gap-2 p-1 bg-muted/30 rounded-lg">
              {contentTypes.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedType(value as SourceType)}
                  className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-md text-xs font-medium transition-all ${
                    selectedType === value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* 标题输入 */}
            <div className="space-y-2">
              <Label htmlFor="title">标题（可选）</Label>
              <Input
                id="title"
                placeholder="为这个内容源命名..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* 内容输入 */}
            {selectedType === "text" ? (
              <div className="space-y-2">
                <Label htmlFor="content">文本内容</Label>
                <Textarea
                  id="content"
                  rows={6}
                  placeholder="输入或粘贴文本内容..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="resize-none font-mono text-sm"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="url">
                  {selectedType === "youtube" ? "YouTube 链接" :
                   selectedType === "web" ? "网页链接" : "URL"}
                </Label>
                <Input
                  id="url"
                  type="url"
                  placeholder="https://..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="font-mono text-sm"
                />
                {selectedType === "web" && (
                  <p className="text-xs text-muted-foreground">
                    将自动抓取网页内容
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAddSource}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
