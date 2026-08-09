"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Trash2, Edit, FileText, Play, Tag } from "lucide-react";
import {
  getAllTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplatesByCategory,
} from "@/lib/db/template-library-api";

interface Template {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  nodes: string;
  edges: string;
  thumbnail?: string | null;
  tags?: string | null;
  isBuiltIn?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

const CATEGORIES = ["内容处理", "视频处理", "翻译", "营销", "研究分析", "其他"];

const CATEGORY_COLORS: Record<string, string> = {
  内容处理: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  视频处理: "bg-red-500/10 text-red-500 border-red-500/20",
  翻译: "bg-green-500/10 text-green-500 border-green-500/20",
  营销: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  研究分析: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  其他: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

export default function TemplateLibraryManager() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<Template[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // 表单状态
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "内容处理",
    tags: "",
  });

  // 加载模板库
  useEffect(() => {
    loadTemplates();
  }, []);

  // 过滤模板
  useEffect(() => {
    filterTemplates();
  }, [templates, searchQuery, selectedCategory]);

  const loadTemplates = async () => {
    try {
      const allTemplates = await getAllTemplates();
      setTemplates(allTemplates);
    } catch (error) {
      console.error("加载模板库失败:", error);
    }
  };

  const filterTemplates = () => {
    let filtered = templates;

    // 按分类过滤
    if (selectedCategory !== "all") {
      filtered = filtered.filter((template) => template.category === selectedCategory);
    }

    // 按搜索词过滤
    if (searchQuery) {
      filtered = filtered.filter(
        (template) =>
          template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (template.description && template.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (template.tags && template.tags.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    setFilteredTemplates(filtered);
  };

  const handleAdd = async () => {
    try {
      // 创建空模板（包含基础节点结构）
      const emptyNodes = JSON.stringify([]);
      const emptyEdges = JSON.stringify([]);

      await createTemplate({
        name: formData.name,
        description: formData.description || undefined,
        category: formData.category,
        nodes: emptyNodes,
        edges: emptyEdges,
        tags: formData.tags || undefined,
      });
      await loadTemplates();
      setShowAddDialog(false);
      resetForm();
    } catch (error) {
      console.error("添加模板失败:", error);
    }
  };

  const handleEdit = async () => {
    if (!selectedTemplate) return;

    try {
      await updateTemplate(selectedTemplate.id, {
        name: formData.name,
        description: formData.description || undefined,
        category: formData.category,
        tags: formData.tags || undefined,
      });
      await loadTemplates();
      setShowEditDialog(false);
      setSelectedTemplate(null);
      resetForm();
    } catch (error) {
      console.error("更新模板失败:", error);
    }
  };

  const handleDelete = async () => {
    if (!selectedTemplate) return;

    try {
      await deleteTemplate(selectedTemplate.id);
      setTemplates(templates.filter((template) => template.id !== selectedTemplate.id));
      setShowDeleteDialog(false);
      setSelectedTemplate(null);
    } catch (error) {
      console.error("删除模板失败:", error);
    }
  };

  const handleUseTemplate = (template: Template) => {
    // 跳转到流程编辑器，并传递模板数据
    const nodes = JSON.parse(template.nodes);
    const edges = JSON.parse(template.edges);

    // 将模板数据存储到 sessionStorage
    sessionStorage.setItem("templateData", JSON.stringify({ nodes, edges, name: template.name }));

    // 跳转到新建流程页面
    window.location.href = "/dashboard/flows";
  };

  const openEditDialog = (template: Template) => {
    setSelectedTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || "",
      category: template.category,
      tags: template.tags || "",
    });
    setShowEditDialog(true);
  };

  const openDeleteDialog = (template: Template) => {
    setSelectedTemplate(template);
    setShowDeleteDialog(true);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      category: "内容处理",
      tags: "",
    });
  };

  const getCategoryColor = (category: string) => {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS["其他"];
  };

  return (
    <div className="space-y-6">
      {/* 顶部操作栏 */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto space-y-3 sm:space-y-0 sm:flex sm:items-center sm:gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索模板..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="选择分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={() => {
            resetForm();
            setShowAddDialog(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          创建模板
        </Button>
      </div>

      {/* 模板列表 */}
      {filteredTemplates.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">
            {searchQuery || selectedCategory !== "all" ? "没有找到模板" : "模板库为空"}
          </h3>
          <p className="text-muted-foreground mb-4">
            {searchQuery || selectedCategory !== "all"
              ? "尝试调整搜索条件"
              : "保存常用工作流为模板，快速创建新项目"}
          </p>
          {!searchQuery && selectedCategory === "all" && (
            <Button
              onClick={() => {
                resetForm();
                setShowAddDialog(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              创建第一个模板
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => (
            <Card key={template.id} className="p-5 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className={getCategoryColor(template.category)} variant="outline">
                      {template.category}
                    </Badge>
                    {template.isBuiltIn && (
                      <Badge variant="secondary" className="text-xs">
                        内置
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-semibold text-lg mb-1 truncate">{template.name}</h3>
                  {template.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                      {template.description}
                    </p>
                  )}
                </div>
              </div>

              {template.tags && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {template.tags.split(",").map((tag, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs">
                      {tag.trim()}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 pt-3 border-t">
                <Button
                  className="flex-1"
                  size="sm"
                  onClick={() => handleUseTemplate(template)}
                >
                  <Play className="h-3 w-3 mr-1" />
                  使用模板
                </Button>
                {!template.isBuiltIn && (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditDialog(template)}
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openDeleteDialog(template)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 添加对话框 */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建模板</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">模板名称</Label>
              <Input
                id="name"
                placeholder="例如: YouTube视频总结"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">分类</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                placeholder="简要描述这个模板的用途..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">标签</Label>
              <Input
                id="tags"
                placeholder="用逗号分隔，例如: AI, 总结, 自动化"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              取消
            </Button>
            <Button onClick={handleAdd} disabled={!formData.name}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑对话框 */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑模板</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">模板名称</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-category">分类</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">描述</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-tags">标签</Label>
              <Input
                id="edit-tags"
                placeholder="用逗号分隔"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              取消
            </Button>
            <Button onClick={handleEdit}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除模板</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            确定要删除模板 &quot;{selectedTemplate?.name}&quot; 吗？此操作无法撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              取消
            </Button>
            <Button variant="default" onClick={handleDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
