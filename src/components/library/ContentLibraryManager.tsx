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
import { Plus, Search, Trash2, Edit, FileText, Video, Image, Table, Link, Globe, FileType, Tag } from "lucide-react";
import {
  getAllContentLibrary,
  createContentLibrary,
  updateContentLibrary,
  deleteContentLibrary,
  searchContentLibrary,
  getContentLibraryByCategory,
} from "@/lib/db/content-library-api";

interface ContentLibraryItem {
  id: string;
  title: string;
  type: string;
  content: string;
  metadata?: string | null;
  tags?: string | null;
  category?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CATEGORIES = ["提示词", "品牌资料", "研究素材", "常用文本", "模板", "其他"];

const TYPE_ICONS: Record<string, any> = {
  text: FileText,
  youtube: Video,
  pdf: FileType,
  image: Image,
  video: Video,
  table: Table,
  web: Globe,
  url: Link,
};

const TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-500/10 text-blue-500",
  youtube: "bg-red-500/10 text-red-500",
  pdf: "bg-purple-500/10 text-purple-500",
  image: "bg-green-500/10 text-green-500",
  video: "bg-orange-500/10 text-orange-500",
  table: "bg-cyan-500/10 text-cyan-500",
  web: "bg-indigo-500/10 text-indigo-500",
  url: "bg-pink-500/10 text-pink-500",
};

export default function ContentLibraryManager() {
  const [items, setItems] = useState<ContentLibraryItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<ContentLibraryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ContentLibraryItem | null>(null);

  // 表单状态
  const [formData, setFormData] = useState({
    title: "",
    type: "text",
    content: "",
    category: "",
    tags: "",
  });

  // 加载内容库
  useEffect(() => {
    loadItems();
  }, []);

  // 过滤内容
  useEffect(() => {
    filterItems();
  }, [items, searchQuery, selectedCategory]);

  const loadItems = async () => {
    try {
      const allItems = await getAllContentLibrary();
      setItems(allItems);
    } catch (error) {
      console.error("加载内容库失败:", error);
    }
  };

  const filterItems = async () => {
    let filtered = items;

    // 按分类过滤
    if (selectedCategory !== "all") {
      filtered = filtered.filter((item) => item.category === selectedCategory);
    }

    // 按搜索词过滤
    if (searchQuery) {
      filtered = filtered.filter(
        (item) =>
          item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (item.tags && item.tags.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    setFilteredItems(filtered);
  };

  const handleAdd = async () => {
    try {
      await createContentLibrary({
        title: formData.title,
        type: formData.type,
        content: formData.content,
        category: formData.category || undefined,
        tags: formData.tags || undefined,
      });
      await loadItems();
      setShowAddDialog(false);
      resetForm();
    } catch (error) {
      console.error("添加内容失败:", error);
    }
  };

  const handleEdit = async () => {
    if (!selectedItem) return;

    try {
      await updateContentLibrary(selectedItem.id, {
        title: formData.title,
        content: formData.content,
        category: formData.category || undefined,
        tags: formData.tags || undefined,
      });
      await loadItems();
      setShowEditDialog(false);
      setSelectedItem(null);
      resetForm();
    } catch (error) {
      console.error("更新内容失败:", error);
    }
  };

  const handleDelete = async () => {
    if (!selectedItem) return;

    try {
      await deleteContentLibrary(selectedItem.id);
      setItems(items.filter((item) => item.id !== selectedItem.id));
      setShowDeleteDialog(false);
      setSelectedItem(null);
    } catch (error) {
      console.error("删除内容失败:", error);
    }
  };

  const openEditDialog = (item: ContentLibraryItem) => {
    setSelectedItem(item);
    setFormData({
      title: item.title,
      type: item.type,
      content: item.content,
      category: item.category || "",
      tags: item.tags || "",
    });
    setShowEditDialog(true);
  };

  const openDeleteDialog = (item: ContentLibraryItem) => {
    setSelectedItem(item);
    setShowDeleteDialog(true);
  };

  const resetForm = () => {
    setFormData({
      title: "",
      type: "text",
      content: "",
      category: "",
      tags: "",
    });
  };

  const getTypeIcon = (type: string) => {
    const Icon = TYPE_ICONS[type] || FileText;
    return <Icon className="h-4 w-4" />;
  };

  const getTypeColor = (type: string) => {
    return TYPE_COLORS[type] || "bg-gray-500/10 text-gray-500";
  };

  return (
    <div className="space-y-6">
      {/* 顶部操作栏 */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto space-y-3 sm:space-y-0 sm:flex sm:items-center sm:gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索内容..."
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
          添加到内容库
        </Button>
      </div>

      {/* 内容列表 */}
      {filteredItems.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">
            {searchQuery || selectedCategory !== "all" ? "没有找到内容" : "内容库为空"}
          </h3>
          <p className="text-muted-foreground mb-4">
            {searchQuery || selectedCategory !== "all"
              ? "尝试调整搜索条件"
              : "保存常用内容以便在工作流中快速复用"}
          </p>
          {!searchQuery && selectedCategory === "all" && (
            <Button
              onClick={() => {
                resetForm();
                setShowAddDialog(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              添加第一个内容
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => (
            <Card key={item.id} className="p-4 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2 flex-1">
                  <div className={`p-2 rounded-lg ${getTypeColor(item.type)}`}>
                    {getTypeIcon(item.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{item.title}</h3>
                    {item.category && (
                      <p className="text-xs text-muted-foreground">{item.category}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEditDialog(item)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openDeleteDialog(item)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                {item.content}
              </p>

              {item.tags && (
                <div className="flex flex-wrap gap-1">
                  {item.tags.split(",").map((tag, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs">
                      {tag.trim()}
                    </Badge>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* 添加对话框 */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>添加到内容库</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">标题</Label>
              <Input
                id="title"
                placeholder="给内容起个名字"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="type">类型</Label>
                <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">文本</SelectItem>
                    <SelectItem value="youtube">YouTube</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="image">图片</SelectItem>
                    <SelectItem value="video">视频</SelectItem>
                    <SelectItem value="table">表格</SelectItem>
                    <SelectItem value="web">网页</SelectItem>
                    <SelectItem value="url">链接</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">分类</Label>
                <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择分类" />
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">内容</Label>
              <Textarea
                id="content"
                placeholder="输入内容..."
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                rows={8}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">标签</Label>
              <Input
                id="tags"
                placeholder="用逗号分隔，例如: 提示词, AI, 总结"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              取消
            </Button>
            <Button onClick={handleAdd} disabled={!formData.title || !formData.content}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑对话框 */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑内容</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">标题</Label>
              <Input
                id="edit-title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-category">分类</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="选择分类" />
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
              <Label htmlFor="edit-content">内容</Label>
              <Textarea
                id="edit-content"
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                rows={8}
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
            <DialogTitle>删除内容</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            确定要删除 &quot;{selectedItem?.title}&quot; 吗？此操作无法撤销。
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
