import { Node } from "reactflow";
import { toPng } from "html-to-image";

// Flow导出功能

// 1. 导出为PNG图片
export async function exportFlowAsPNG(
  elementId: string,
  fileName: string = "flow-diagram.png"
): Promise<void> {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error("未找到画布元素");
  }

  try {
    const dataUrl = await toPng(element, {
      backgroundColor: "#ffffff",
      cacheBust: true,
    });

    const link = document.createElement("a");
    link.download = fileName;
    link.href = dataUrl;
    link.click();
  } catch (error) {
    console.error("导出PNG失败:", error);
    throw error;
  }
}

// 2. 导出为简化JSON（只包含结构）
export function exportFlowAsJSON(
  nodes: Node[],
  edges: any[],
  fileName: string = "flow-structure.json"
): void {
  const flowData = {
    version: "1.0",
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        label: node.data.label,
        // 不包含大型内容数据
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };

  const jsonString = JSON.stringify(flowData, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  link.click();

  URL.revokeObjectURL(url);
}

// 3. 导出为完整包（包含所有数据和资源）
export function exportFlowAsFullPackage(
  nodes: Node[],
  edges: any[],
  flowName: string,
  fileName: string = "flow-package.json"
): void {
  const flowPackage = {
    version: "1.0",
    name: flowName,
    exportedAt: new Date().toISOString(),
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data, // 包含完整数据
    })),
    edges: edges,
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      types: [...new Set(nodes.map((n) => n.type))],
    },
  };

  const jsonString = JSON.stringify(flowPackage, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  link.click();

  URL.revokeObjectURL(url);
}

// 4. 导入Flow包
export function importFlowPackage(file: File): Promise<{
  nodes: Node[];
  edges: any[];
  name: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const flowPackage = JSON.parse(content);

        if (!flowPackage.nodes || !flowPackage.edges) {
          throw new Error("无效的Flow包格式");
        }

        resolve({
          nodes: flowPackage.nodes,
          edges: flowPackage.edges,
          name: flowPackage.name || "导入的流程",
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("读取文件失败"));
    };

    reader.readAsText(file);
  });
}

// 5. 保存Flow为模板
export async function saveFlowAsTemplate(
  nodes: Node[],
  edges: any[],
  templateName: string,
  templateCategory: string,
  templateDescription?: string
): Promise<void> {
  // 导入模板API
  const { createTemplate } = await import("@/lib/db/template-library-api");

  try {
    await createTemplate({
      name: templateName,
      description: templateDescription,
      category: templateCategory,
      nodes: JSON.stringify(nodes),
      edges: JSON.stringify(edges),
    });
  } catch (error) {
    console.error("保存模板失败:", error);
    throw error;
  }
}

// 6. 获取Flow统计信息
export function getFlowStats(nodes: Node[], edges: any[]) {
  const nodeTypes = nodes.reduce((acc, node) => {
    acc[node.type || "unknown"] = (acc[node.type || "unknown"] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    nodeTypes,
    isEmpty: nodes.length === 0,
  };
}
