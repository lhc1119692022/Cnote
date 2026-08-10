import { Node, Edge } from 'reactflow';

// 类型别名用于 Flow 执行引擎
export type FlowNode = Node
export type FlowEdge = Edge

// 节点类型
export type NodeType =
  | 'content'
  | 'ai'
  | 'browser'
  | 'sticky'
  | 'editor'
  | 'output';

// Content 节点模式
export type ContentMode =
  | 'text'
  | 'image'
  | 'video'
  | 'table'
  | 'youtube'
  | 'pdf';

// 节点数据基类
export interface BaseNodeData {
  label: string;
  description?: string;
}

// Content 节点数据
export interface ContentNodeData extends BaseNodeData {
  mode: ContentMode;
  content: string;
  metadata?: {
    url?: string;
    transcript?: string;
    wordCount?: number;
  };
}

// AI 节点数据
export interface AINodeData extends BaseNodeData {
  providerId: string;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  output?: string;
}

// Browser 节点数据
export interface BrowserNodeData extends BaseNodeData {
  url: string;
  extractedContent?: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

// Sticky 节点数据
export interface StickyNodeData extends BaseNodeData {
  content: string;
  color: 'yellow' | 'pink' | 'green' | 'blue' | 'purple';
  background: 'solid' | 'none';
}

// Editor 节点数据
export interface EditorNodeData extends BaseNodeData {
  content: string;
  format: 'html' | 'markdown';
}

// Output 节点数据
export interface OutputNodeData extends BaseNodeData {
  content: string;
  format: 'html' | 'markdown' | 'text';
  savedAt?: number;
}

// Flow 定义
export interface Flow {
  id: string;
  name: string;
  title: string;
  description?: string;
  nodes: Node[];
  edges: Edge[];
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
  thumbnail?: string;
  folderId?: string;
  createdAt: number;
  updatedAt: number;
}

// Folder 定义
export interface Folder {
  id: string;
  name: string;
  color?: string;
  createdAt: number;
}

// Template 定义
export interface Template {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  nodes: Node[];
  edges: Edge[];
  category?: string;
  usageCount: number;
  createdAt: number;
}

// Source 定义（内容库）
export interface Source {
  id: string;
  title: string;
  content: string;
  type: ContentMode;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

// Output 定义（输出历史）
export interface Output {
  id: string;
  title: string;
  content: string;
  format: 'html' | 'markdown' | 'text';
  flowId?: string;
  nodeId?: string;
  wordCount: number;
  createdAt: number;
}
