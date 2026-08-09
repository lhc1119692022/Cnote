import type { FlowNode, FlowEdge } from '@/types/flow'
import type { ChatMessage } from '@/lib/api'
import { topologicalSort, getPredecessors } from './graph'
import { AIClient } from '@/lib/api'

/**
 * 节点执行上下文
 */
export interface ExecutionContext {
  nodeId: string
  inputs: Record<string, any>
  output?: any
  error?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startTime?: number
  endTime?: number
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  success: boolean
  contexts: Map<string, ExecutionContext>
  error?: string
}

/**
 * Flow 执行引擎
 */
export class FlowExecutor {
  private nodes: FlowNode[]
  private edges: FlowEdge[]
  private contexts: Map<string, ExecutionContext>
  private aiClient?: AIClient

  constructor(nodes: FlowNode[], edges: FlowEdge[], aiClient?: AIClient) {
    this.nodes = nodes
    this.edges = edges
    this.contexts = new Map()
    this.aiClient = aiClient
  }

  /**
   * 执行整个 Flow
   */
  async execute(): Promise<ExecutionResult> {
    try {
      // 拓扑排序获取执行顺序
      const order = topologicalSort(this.nodes, this.edges)

      // 初始化所有节点的上下文
      this.nodes.forEach((node) => {
        this.contexts.set(node.id, {
          nodeId: node.id,
          inputs: {},
          status: 'pending',
        })
      })

      // 按顺序执行节点
      for (const nodeId of order) {
        const node = this.nodes.find((n) => n.id === nodeId)
        if (!node) continue

        await this.executeNode(node)
      }

      return {
        success: true,
        contexts: this.contexts,
      }
    } catch (error) {
      return {
        success: false,
        contexts: this.contexts,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * 执行单个节点
   */
  private async executeNode(node: FlowNode): Promise<void> {
    const context = this.contexts.get(node.id)!
    context.status = 'running'
    context.startTime = Date.now()

    try {
      // 收集输入数据
      const inputs = this.collectInputs(node.id)
      context.inputs = inputs

      // 根据节点类型执行
      let output: any

      switch (node.type) {
        case 'content':
          output = await this.executeContentNode(node, inputs)
          break
        case 'ai':
          output = await this.executeAINode(node, inputs)
          break
        case 'browser':
          output = await this.executeBrowserNode(node, inputs)
          break
        case 'output':
          output = await this.executeOutputNode(node, inputs)
          break
        case 'editor':
          output = await this.executeEditorNode(node, inputs)
          break
        case 'pdf':
          output = await this.executePDFNode(node, inputs)
          break
        case 'sticky':
          output = await this.executeStickyNode(node, inputs)
          break
        case 'group':
          output = await this.executeGroupNode(node, inputs)
          break
        default:
          throw new Error(`Unknown node type: ${node.type}`)
      }

      context.output = output
      context.status = 'completed'
      context.endTime = Date.now()
    } catch (error) {
      context.status = 'failed'
      context.error = error instanceof Error ? error.message : 'Unknown error'
      context.endTime = Date.now()
      throw error
    }
  }

  /**
   * 收集节点的输入数据
   */
  private collectInputs(nodeId: string): Record<string, any> {
    const predecessors = getPredecessors(nodeId, this.edges)
    const inputs: Record<string, any> = {}

    predecessors.forEach((predId) => {
      const predContext = this.contexts.get(predId)
      if (predContext && predContext.output !== undefined) {
        inputs[predId] = predContext.output
      }
    })

    return inputs
  }

  /**
   * 执行 Content 节点
   */
  private async executeContentNode(
    node: FlowNode,
    inputs: Record<string, any>
  ): Promise<any> {
    const data = node.data as any

    // 如果有输入，合并输入内容
    const inputTexts = Object.values(inputs).filter((v) => typeof v === 'string')
    const mergedInput = inputTexts.join('\n\n')

    switch (data.mode) {
      case 'text':
        return data.content || mergedInput
      case 'youtube':
        return {
          type: 'youtube',
          url: data.content,
          input: mergedInput,
        }
      case 'image':
        return {
          type: 'image',
          url: data.content,
          input: mergedInput,
        }
      case 'video':
        return {
          type: 'video',
          url: data.content,
          input: mergedInput,
        }
      case 'table':
        return {
          type: 'table',
          data: data.tableData || [],
          input: mergedInput,
        }
      default:
        return data.content || mergedInput
    }
  }

  /**
   * 执行 AI 节点
   */
  private async executeAINode(
    node: FlowNode,
    inputs: Record<string, any>
  ): Promise<string> {
    if (!this.aiClient) {
      throw new Error('AI client not initialized')
    }

    const data = node.data as any

    // 构建提示词
    const inputTexts = Object.values(inputs)
      .filter((v) => typeof v === 'string')
      .join('\n\n')

    const systemPrompt = data.systemPrompt || '你是一个有用的助手。'
    const userPrompt = data.prompt || inputTexts

    // 调用 AI API
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    const response = await this.aiClient.chatCompletion({
      model: data.model || 'gpt-3.5-turbo',
      messages,
      temperature: data.temperature || 0.7,
      max_tokens: 4096,
    })

    // 处理流式响应
    if (Symbol.asyncIterator in Object(response)) {
      let fullText = ''
      for await (const chunk of response as AsyncIterable<any>) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          fullText += content
        }
      }
      return fullText
    }

    // 处理普通响应
    return (response as any).choices[0]?.message?.content || ''
  }

  /**
   * 执行 Browser 节点
   */
  private async executeBrowserNode(
    node: FlowNode,
    _inputs: Record<string, any>
  ): Promise<string> {
    const data = node.data as any
    const url = data.url

    if (!url) {
      throw new Error('Browser node requires URL')
    }

    // TODO: 实现实际的网页抓取逻辑
    // 这里需要配合 Cloudflare Workers 实现
    return `[Scraped content from ${url}]`
  }

  /**
   * 执行 Output 节点
   */
  private async executeOutputNode(
    node: FlowNode,
    inputs: Record<string, any>
  ): Promise<any> {
    const data = node.data as any

    // 合并所有输入
    const content = Object.values(inputs).join('\n\n')

    return {
      format: data.format || 'text',
      content,
      timestamp: Date.now(),
    }
  }

  /**
   * 执行 Editor 节点
   */
  private async executeEditorNode(
    node: FlowNode,
    _inputs: Record<string, any>
  ): Promise<string> {
    const data = node.data as any
    const inputText = Object.values(_inputs).join('\n\n')

    return data.content || inputText
  }

  /**
   * 执行 PDF 节点
   */
  private async executePDFNode(
    node: FlowNode,
    _inputs: Record<string, any>
  ): Promise<string> {
    const data = node.data as any

    // TODO: 实现 PDF 文本提取
    return data.extractedText || '[PDF content]'
  }

  /**
   * 执行 Sticky 节点
   */
  private async executeStickyNode(
    node: FlowNode,
    _inputs: Record<string, any>
  ): Promise<string> {
    const data = node.data as any
    return data.content || ''
  }

  /**
   * 执行 Group 节点
   */
  private async executeGroupNode(
    _node: FlowNode,
    inputs: Record<string, any>
  ): Promise<any> {
    // Group 节点只是组织作用，直接传递输入
    return inputs
  }

  /**
   * 获取执行统计
   */
  getStats() {
    const stats = {
      total: this.contexts.size,
      completed: 0,
      failed: 0,
      pending: 0,
      running: 0,
      totalTime: 0,
    }

    this.contexts.forEach((context) => {
      switch (context.status) {
        case 'completed':
          stats.completed++
          break
        case 'failed':
          stats.failed++
          break
        case 'pending':
          stats.pending++
          break
        case 'running':
          stats.running++
          break
      }

      if (context.startTime && context.endTime) {
        stats.totalTime += context.endTime - context.startTime
      }
    })

    return stats
  }
}
