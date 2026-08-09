"use client";

import { useState } from "react";
import { Plus, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface StyleProfile {
  id: string;
  name: string;
  description: string;
  tone: string;
  style: string;
  audience: string;
  isBuiltIn?: boolean;
}

const builtInProfiles: StyleProfile[] = [
  {
    id: "1",
    name: "专业商务",
    description: "正式、简洁的商业文档风格",
    tone: "专业、客观",
    style: "简洁明了，注重数据和事实",
    audience: "商业决策者、企业客户",
    isBuiltIn: true,
  },
  {
    id: "2",
    name: "轻松博客",
    description: "友好、易读的博客文章风格",
    tone: "轻松、友好",
    style: "口语化，使用比喻和例子",
    audience: "普通读者",
    isBuiltIn: true,
  },
  {
    id: "3",
    name: "学术论文",
    description: "严谨的学术写作风格",
    tone: "客观、严谨",
    style: "逻辑清晰，引用充分",
    audience: "学者、研究人员",
    isBuiltIn: true,
  },
  {
    id: "4",
    name: "营销文案",
    description: "吸引眼球的营销内容",
    tone: "热情、说服力强",
    style: "强调价值和好处，行动导向",
    audience: "潜在客户",
    isBuiltIn: true,
  },
];

export function StyleProfilesManager() {
  const [profiles, setProfiles] = useState<StyleProfile[]>(builtInProfiles);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<StyleProfile | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    tone: "",
    style: "",
    audience: "",
  });

  // 打开添加对话框
  const openAddDialog = () => {
    setEditingProfile(null);
    setFormData({
      name: "",
      description: "",
      tone: "",
      style: "",
      audience: "",
    });
    setIsDialogOpen(true);
  };

  // 打开编辑对话框
  const openEditDialog = (profile: StyleProfile) => {
    if (profile.isBuiltIn) return;
    setEditingProfile(profile);
    setFormData({
      name: profile.name,
      description: profile.description,
      tone: profile.tone,
      style: profile.style,
      audience: profile.audience,
    });
    setIsDialogOpen(true);
  };

  // 保存配置
  const handleSave = () => {
    if (!formData.name.trim()) {
      alert("请输入配置名称");
      return;
    }

    if (editingProfile) {
      // 更新
      setProfiles(
        profiles.map((p) =>
          p.id === editingProfile.id ? { ...editingProfile, ...formData } : p
        )
      );
    } else {
      // 新建
      const newProfile: StyleProfile = {
        id: Date.now().toString(),
        ...formData,
        isBuiltIn: false,
      };
      setProfiles([...profiles, newProfile]);
    }

    setIsDialogOpen(false);
  };

  // 删除配置
  const handleDelete = (id: string) => {
    if (confirm("确定要删除这个风格配置吗？")) {
      setProfiles(profiles.filter((p) => p.id !== id));
    }
  };

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <div className="space-y-6">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">写作风格</h1>
            <p className="text-muted-foreground">
              配置和管理内容生成的写作风格
            </p>
          </div>
          <Button onClick={openAddDialog} className="gap-2">
            <Plus className="h-4 w-4" />
            新建风格
          </Button>
        </div>

        {/* 风格配置网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map((profile) => (
            <Card key={profile.id} className="group relative p-6 hover:shadow-md transition-shadow">
              {/* 内置标签 */}
              {profile.isBuiltIn && (
                <div className="absolute top-4 right-4">
                  <Badge variant="secondary" className="text-xs">
                    内置
                  </Badge>
                </div>
              )}

              {/* 操作按钮 */}
              {!profile.isBuiltIn && (
                <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEditDialog(profile)}
                    className="h-8 w-8 rounded-full bg-background/80 hover:bg-accent flex items-center justify-center"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(profile.id)}
                    className="h-8 w-8 rounded-full bg-background/80 hover:bg-destructive hover:text-white flex items-center justify-center"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* 内容区域 */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-lg pr-20">{profile.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {profile.description}
                  </p>
                </div>

                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-muted-foreground">语调：</span>
                    <span className="ml-2">{profile.tone}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">风格：</span>
                    <span className="ml-2">{profile.style}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">受众：</span>
                    <span className="ml-2">{profile.audience}</span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* 添加/编辑对话框 */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {editingProfile ? "编辑风格配置" : "新建风格配置"}
            </DialogTitle>
            <DialogDescription>
              配置写作风格以应用到内容生成流程
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* 名称 */}
            <div className="space-y-2">
              <Label htmlFor="name">配置名称</Label>
              <Input
                id="name"
                placeholder="例如：专业商务"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {/* 描述 */}
            <div className="space-y-2">
              <Label htmlFor="description">描述</Label>
              <Input
                id="description"
                placeholder="简短描述这个风格"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            {/* 语调 */}
            <div className="space-y-2">
              <Label htmlFor="tone">语调</Label>
              <Input
                id="tone"
                placeholder="例如：专业、友好、严谨"
                value={formData.tone}
                onChange={(e) => setFormData({ ...formData, tone: e.target.value })}
              />
            </div>

            {/* 风格 */}
            <div className="space-y-2">
              <Label htmlFor="style">写作风格</Label>
              <Textarea
                id="style"
                rows={3}
                placeholder="描述具体的写作风格特点..."
                value={formData.style}
                onChange={(e) => setFormData({ ...formData, style: e.target.value })}
                className="resize-none"
              />
            </div>

            {/* 目标受众 */}
            <div className="space-y-2">
              <Label htmlFor="audience">目标受众</Label>
              <Input
                id="audience"
                placeholder="例如：商业决策者、普通读者"
                value={formData.audience}
                onChange={(e) => setFormData({ ...formData, audience: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave}>
              {editingProfile ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
