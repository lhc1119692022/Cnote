// API 协议类型
export type ProtocolType = 'responses' | 'chatCompletions';

// 模型配置
export interface ModelConfig {
  id: string;
  name: string;
  enabled: boolean;
  contextLength?: number;
  maxTokens?: number;
}

// 提供商配置
export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: ProtocolType;
  models: ModelConfig[];
  enabled: boolean;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

// AI 请求参数
export interface AIRequestParams {
  provider: ProviderConfig;
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

// AI 响应
export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// 测试连接结果
export interface TestConnectionResult {
  success: boolean;
  message: string;
  latency?: number;
}
