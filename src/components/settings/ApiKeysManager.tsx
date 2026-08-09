"use client";

import { useState } from "react";
import { Plus, Trash2, Eye, EyeOff, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

interface ApiKey {
  id: string;
  service: string;
  key: string;
  createdAt: Date;
}

const supportedServices = [
  { value: "openai", label: "OpenAI", placeholder: "sk-..." },
  { value: "anthropic", label: "Anthropic (Claude)", placeholder: "sk-ant-..." },
  { value: "google", label: "Google AI", placeholder: "AI..." },
  { value: "deepseek", label: "DeepSeek", placeholder: "sk-..." },
  { value: "firecrawl", label: "Firecrawl", placeholder: "fc-..." },
];

export function ApiKeysManager() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedService, setSelectedService] = useState(supportedServices[0].value);
  const [keyInput, setKeyInput] = useState("");
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  // 添加 API Key
  const handleAddKey = () => {
    if (!keyInput.trim()) {
      alert("请输入 API Key");
      return;
    }

    const serviceInfo = supportedServices.find((s) => s.value === selectedService);
    const newKey: ApiKey = {
      id: Date.now().toString(),
      service: serviceInfo?.label || selectedService,
      key: keyInput,
      createdAt: new Date(),
    };

    setApiKeys([...apiKeys, newKey]);
    setIsDialogOpen(false);
    setKeyInput("");
    setSelectedService(supportedServices[0].value);
  };

  // 删除 API Key
  const handleDeleteKey = (id: string) => {
    if (confirm("确定要删除这个 API Key 吗？")) {
      setApiKeys(apiKeys.filter((k) => k.id !== id));
    }
  };

  // 切换可见性
  const toggleVisibility = (id: string) => {
    const newVisible = new Set(visibleKeys);
    if (newVisible.has(id)) {
      newVisible.delete(id);
    } else {
      newVisible.add(id);
    }
    setVisibleKeys(newVisible);
  };

  // 隐藏 Key
  const maskKey = (key: string) => {
    if (key.length <= 8) return "••••••••";
    return key.slice(0, 4) + "•".repeat(key.length - 8) + key.slice(-4);
  };

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <div className="space-y-6">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">API Keys</h1>
            <p className="text-muted-foreground">
              管理您的 AI 服务 API 密钥
            </p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            添加 Key
          </Button>
        </div>

        {/* API Keys 列表 */}
        {apiKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Key className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">还没有 API Key</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              添加 AI 服务的 API Key 来使用工作流功能
            </p>
            <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              添加第一个 Key
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {apiKeys.map((apiKey) => (
              <Card key={apiKey.id} className="group relative p-6 hover:shadow-md transition-shadow">
                {/* 删除按钮 */}
                <button
                  onClick={() => handleDeleteKey(apiKey.id)}
                  className="absolute top-4 right-4 z-10 h-8 w-8 rounded-full bg-background/80 hover:bg-destructive hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                {/* 内容区域 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between pr-12">
                    <h3 className="font-semibold text-lg">{apiKey.service}</h3>
                    <span className="text-xs text-muted-foreground">
                      添加于 {apiKey.createdAt.toLocaleDateString("zh-CN")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex-1 p-3 rounded-lg bg-muted/30 font-mono text-sm">
                      {visibleKeys.has(apiKey.id) ? apiKey.key : maskKey(apiKey.key)}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleVisibility(apiKey.id)}
                    >
                      {visibleKeys.has(apiKey.id) ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 添加对话框 */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>添加 API Key</DialogTitle>
            <DialogDescription>
              添加 AI 服务的 API 密钥以使用相关功能
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* 服务选择 */}
            <div className="space-y-2">
              <Label htmlFor="service">服务</Label>
              <select
                id="service"
                value={selectedService}
                onChange={(e) => setSelectedService(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {supportedServices.map((service) => (
                  <option key={service.value} value={service.value}>
                    {service.label}
                  </option>
                ))}
              </select>
            </div>

            {/* API Key 输入 */}
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder={
                  supportedServices.find((s) => s.value === selectedService)?.placeholder
                }
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAddKey}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
