import { desktopFetch } from '@/lib/desktop-fetch'
import { safeGenerationError } from '@/lib/generation/safe-error'
import type { GenerationChannel } from '@/stores/use-generation-store'
import { analyzeWorkflow, type RHValue, type RHWorkflow } from './workflow'

type Json = Record<string, unknown>
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RunningHub 返回的数据格式无效')
  return value as Json
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`RunningHub 没有返回有效的${label}`)
  return value
}

export interface RHResult { url: string; outputType: string; nodeId?: string }
export interface RHRemoteTask { taskId: string; status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED'; error?: string; results: RHResult[] }
export type RHFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Each method makes exactly one request. Creation must never be automatically retried. */
export function runningHubClient(channel: Pick<GenerationChannel, 'baseURL' | 'enabled'>, apiKey: string, request: RHFetch = desktopFetch) {
  if (!channel.enabled) throw new Error('RunningHub 渠道已禁用')
  if (!apiKey.trim()) throw new Error('请先配置 RunningHub API Key')
  const base = new URL(channel.baseURL)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('RunningHub 接口地址无效')
  const baseURL = base.toString().replace(/\/$/, '')
  function errorText(value: unknown): string {
    return safeGenerationError(String(value || 'RunningHub 请求失败').split(apiKey).join('[密钥已隐藏]'))
  }
  async function call(path: string, body: Json | FormData, signal?: AbortSignal): Promise<Json> {
    const multipart = body instanceof FormData
    let response: Response
    try {
      response = await request(baseURL + path, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, ...(!multipart ? { 'Content-Type': 'application/json' } : {}) },
        body: multipart ? body : JSON.stringify(body), signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new Error(`RunningHub 网络请求失败：${errorText(error instanceof Error ? error.message : error)}`)
    }
    if (!response.ok) throw new Error(`RunningHub HTTP ${response.status}`)
    const value = object(await response.json())
    if ('code' in value && value.code !== 0 && value.code !== '0') throw new Error(errorText(value.msg || value.message || `错误码 ${value.code}`))
    return value
  }
  return {
    async read(workflowId: string, signal?: AbortSignal): Promise<unknown> {
      const value = await call('/api/openapi/getJsonApiFormat', { apiKey, workflowId }, signal)
      const prompt = object(value.data).prompt
      if (typeof prompt !== 'string') throw new Error('RunningHub 没有返回 API 工作流')
      return JSON.parse(prompt) as unknown
    },
    async upload(file: Blob, fileName: string, signal?: AbortSignal): Promise<{ fileName: string; url?: string }> {
      const form = new FormData()
      form.append('file', file, fileName)
      const value = object((await call('/openapi/v2/media/upload/binary', form, signal)).data)
      return { fileName: identifier(value.fileName, '文件名'), url: typeof value.download_url === 'string' ? value.download_url : undefined }
    },
    async create(workflowId: string, nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: RHValue }>, signal?: AbortSignal, instanceType?: string): Promise<string> {
      const value = object((await call('/task/openapi/create', { apiKey, workflowId, nodeInfoList, ...(instanceType ? { instanceType } : {}) }, signal)).data)
      return identifier(value.taskId, '任务 ID')
    },
    async query(taskId: string, signal?: AbortSignal): Promise<RHRemoteTask> {
      const value = await call('/openapi/v2/query', { taskId }, signal)
      const statuses = ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']
      if (typeof value.status !== 'string' || !statuses.includes(value.status)) throw new Error('RunningHub 返回了未知任务状态，请继续查询')
      if (value.taskId !== taskId) throw new Error('RunningHub 返回的任务 ID 不匹配')
      const results: RHResult[] = Array.isArray(value.results) ? value.results.map(item => {
        const output = object(item)
        const url = identifier(output.url, '结果地址')
        if (!/^https?:\/\//i.test(url)) throw new Error('RunningHub 结果地址不是 HTTP 地址')
        return { url, outputType: typeof output.outputType === 'string' ? output.outputType : '', nodeId: typeof output.nodeId === 'string' ? output.nodeId : undefined }
      }) : []
      return { taskId, status: value.status as RHRemoteTask['status'], results, error: value.errorMessage ? errorText(value.errorMessage) : undefined }
    },
    async outputsByNode(taskId: string, signal?: AbortSignal): Promise<RHResult[]> {
      // V2 results do not document nodeId. Use the documented legacy output endpoint only when filtering is requested.
      const value = await call('/task/openapi/outputs', { apiKey, taskId }, signal)
      if (!Array.isArray(value.data)) throw new Error('RunningHub 输出尚不可用，请继续获取结果')
      return value.data.map(item => {
        const output = object(item)
        const url = identifier(output.fileUrl, '结果地址')
        if (!/^https?:\/\//i.test(url)) throw new Error('RunningHub 结果地址不是 HTTP 地址')
        return { url, outputType: typeof output.fileType === 'string' ? output.fileType : '', nodeId: identifier(output.nodeId, '输出节点 ID') }
      })
    },
    async cancel(taskId: string, signal?: AbortSignal): Promise<void> {
      await call('/task/openapi/cancel', { apiKey, taskId }, signal)
    },
  }
}

export function assertWorkflowBindings(workflow: RHWorkflow, raw: unknown): void {
  const live = analyzeWorkflow(raw)
  for (const field of workflow.fields.filter(item => item.enabled || item.seedMode)) {
    const current = live.fields.find(item => item.key === field.key)
    if (!current || current.classType !== field.classType || typeof current.value !== typeof field.value) throw new Error(`平台工作流已变化：“${field.label}”绑定失效，请更新工作流配置`)
  }
  for (const output of workflow.outputs.filter(item => item.enabled)) {
    if (!live.structure[output.nodeId] || live.structure[output.nodeId].classType !== workflow.structure[output.nodeId]?.classType) throw new Error(`平台工作流已变化：“${output.label}”输出失效`)
  }
}
