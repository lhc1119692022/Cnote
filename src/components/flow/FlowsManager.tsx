"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, Trash2, FileText } from "lucide-react";
import { getAllFlows, deleteFlow } from "@/lib/db/flows-api";

interface Flow {
  id: string;
  name: string;
  description?: string | null;
  nodes: string;
  edges: string;
  createdAt: Date;
  updatedAt: Date;
}

export default function FlowsManager() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null);

  // 加载所有流程
  useEffect(() => {
    loadFlows();
  }, []);

  const loadFlows = async () => {
    try {
      const allFlows = await getAllFlows();
      setFlows(allFlows);
    } catch (error) {
      console.error("加载流程失败:", error);
    }
  };

  // 过滤流程
  const filteredFlows = flows.filter((flow) =>
    flow.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 删除流程
  const handleDelete = async () => {
    if (!selectedFlow) return;

    try {
      await deleteFlow(selectedFlow.id);
      setFlows(flows.filter((f) => f.id !== selectedFlow.id));
      setShowDeleteDialog(false);
      setSelectedFlow(null);
    } catch (error) {
      console.error("删除流程失败:", error);
    }
  };

  // 打开流程编辑器
  const handleOpenFlow = (flow: Flow) => {
    window.location.href = `/dashboard/flows?id=${flow.id}`;
  };

  return (
    <div className="space-y-6">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索流程..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Button onClick={() => window.location.href = "/dashboard/flows"}>
          <Plus className="h-4 w-4 mr-2" />
          新建流程
        </Button>
      </div>

      {/* 流程列表 */}
      {filteredFlows.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">暂无流程</h3>
          <p className="text-muted-foreground mb-4">
            创建您的第一个工作流程
          </p>
          <Button onClick={() => window.location.href = "/dashboard/flows"}>
            <Plus className="h-4 w-4 mr-2" />
            新建流程
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFlows.map((flow) => (
            <div key={flow.id} onClick={() => handleOpenFlow(flow)}>
              <Card className="p-4 hover:shadow-lg transition-shadow cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">{flow.name}</h3>
                  {flow.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {flow.description}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFlow(flow);
                    setShowDeleteDialog(true);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>
                  节点: {flow.nodes ? JSON.parse(flow.nodes).length : 0}
                </span>
                <span>
                  更新: {new Date(flow.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </Card>
            </div>
          ))}
        </div>
      )}

      {/* 删除确认对话框 */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除流程</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            确定要删除流程 &quot;{selectedFlow?.name}&quot; 吗？此操作无法撤销。
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
