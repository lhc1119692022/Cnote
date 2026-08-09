"use client";

import { useState } from "react";
import { Plus, Search, Star, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: number;
  isBuiltIn?: boolean;
}

const builtInTemplates: Template[] = [
  {
    id: "1",
    name: "文章摘要生成",
    description: "从网页或文本中提取内容，使用 AI 生成摘要",
    category: "内容处理",
    nodes: 3,
    isBuiltIn: true,
  },
  {
    id: "2",
    name: "YouTube 视频转文章",
    description: "提取 YouTube 视频字幕，转换为文章格式",
    category: "视频处理",
    nodes: 4,
    isBuiltIn: true,
  },
  {
    id: "3",
    name: "多语言翻译",
    description: "将内容翻译成多种语言并输出",
    category: "翻译",
    nodes: 5,
    isBuiltIn: true,
  },
  {
    id: "4",
    name: "SEO 优化文案",
    description: "根据关键词生成 SEO 优化的文章内容",
    category: "营销",
    nodes: 4,
    isBuiltIn: true,
  },
];

export function TemplatesManager() {
  const [templates, setTemplates] = useState<Template[]>(builtInTemplates);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("全部");

  const categories = ["全部", ...Array.from(new Set(templates.map((t) => t.category)))];

  // 搜索和分类过滤
  const filteredTemplates = templates.filter((template) => {
    const matchesSearch =
      !searchQuery ||
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === "全部" || template.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  // 应用模板
  const handleApplyTemplate = (template: Template) => {
    console.log("应用模板:", template);
    // TODO: 创建新流程并应用模板
  };

  // 复制模板
  const handleCopyTemplate = (template: Template) => {
    const newTemplate: Template = {
      ...template,
      id: Date.now().toString(),
      name: `${template.name} (副本)`,
      isBuiltIn: false,
    };
    setTemplates([...templates, newTemplate]);
  };

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <div className="space-y-6">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">模板库</h1>
            <p className="text-muted-foreground">
              使用预设模板快速创建工作流
            </p>
          </div>
        </div>

        {/* 搜索和分类 */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索模板..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2">
            {categories.map((category) => (
              <Button
                key={category}
                variant={selectedCategory === category ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(category)}
                className="whitespace-nowrap"
              >
                {category}
              </Button>
            ))}
          </div>
        </div>

        {/* 模板网格 */}
        {filteredTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Star className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">没有找到匹配的模板</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              尝试使用不同的搜索词或分类
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <Card key={template.id} className="group relative p-6 hover:shadow-md transition-shadow">
                {/* 内置标签 */}
                {template.isBuiltIn && (
                  <div className="absolute top-4 right-4">
                    <Badge variant="secondary" className="text-xs">
                      内置
                    </Badge>
                  </div>
                )}

                {/* 内容区域 */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-semibold text-lg pr-16">{template.name}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {template.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {template.category}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {template.nodes} 个节点
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      size="sm"
                      onClick={() => handleApplyTemplate(template)}
                      className="flex-1"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      使用模板
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyTemplate(template)}
                    >
                      <Copy className="h-4 w-4" />
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
