import JSZip from 'jszip'
import type { Flow } from '@/types/flow'
import { cloneFlowValue } from '@/lib/flow/clone'
import {
  checksumBlob,
  deleteLocalResource,
  getLocalResourceMeta,
  loadLocalResourceBlob,
  storeLocalResource,
} from '@/lib/resource-storage'
import { safeFileName, saveBlobToFile } from '@/lib/file-save'
import { useFlowStore } from '@/stores/use-flow-store'

export const MAX_FLOW_BACKUP_FILE_BYTES = 500 * 1024 * 1024

interface BackupResource {
  resourceId: string
  path: string
  fileName: string
  mimeType: string
  size: number
  checksum: string
}

interface FlowBackupManifest {
  format: 'cnote-flow-backup'
  version: 1
  /** Versioned domain schema metadata for future Web/Desktop migration. */
  schemaVersion?: 1
  sourceRuntime?: 'web-preview' | 'desktop'
  capabilities?: string[]
  warnings?: string[]
  exportedAt: string
  flow: Flow
  resources: BackupResource[]
}

export interface FlowRestoreResult {
  flowId: string | null
  warnings: string[]
}

export class FlowBackupError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'FlowBackupError'
    this.code = code
  }
}

function collectResources(flow: Flow) {
  const resources = new Map<string, { resourceId: string; fileName: string; mimeType: string; size: number; checksum: string }>()
  const visit = (value: unknown, fallbackName = 'resource') => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const resourceId = typeof record.resourceId === 'string' && record.resourceId.startsWith('sha256-') ? record.resourceId : undefined
    if (resourceId && !resources.has(resourceId)) {
      const fileName = typeof record.fileName === 'string'
        ? record.fileName
        : typeof record.label === 'string' ? record.label : fallbackName
      resources.set(resourceId, {
        resourceId,
        fileName: safeFileName(fileName),
        mimeType: typeof record.mimeType === 'string' ? record.mimeType : 'application/octet-stream',
        size: Number(record.size || 0),
        checksum: typeof record.checksum === 'string' ? record.checksum : '',
      })
    }
    Object.entries(record).forEach(([key, child]) => visit(child, key === 'references' ? 'reference' : fallbackName))
  }
  visit(flow.nodes, 'flow-resource')
  return [...resources.values()]
}

export async function createFlowBackup(flow: Flow) {
  const zip = new JSZip()
  const resources: BackupResource[] = []
  const localResources = collectResources(flow)

  for (let index = 0; index < localResources.length; index += 1) {
    const resource = localResources[index]
    const meta = await getLocalResourceMeta(resource.resourceId)
    const metadata = {
      ...resource,
      mimeType: resource.mimeType === 'application/octet-stream' ? (meta?.mimeType || resource.mimeType) : resource.mimeType,
      size: resource.size || meta?.size || 0,
      checksum: resource.checksum || meta?.checksum || '',
    }
    if (metadata.size > MAX_FLOW_BACKUP_FILE_BYTES) {
      throw new FlowBackupError('RESOURCE_TOO_LARGE', '画布中有文件超过 500 MiB，备份失败，请自行手动备份。')
    }
    const blob = await loadLocalResourceBlob(resource.resourceId)
    if (!blob) throw new FlowBackupError('RESOURCE_MISSING', `本地文件“${resource.fileName}”已丢失，无法完成备份。`)
    if (blob.size > MAX_FLOW_BACKUP_FILE_BYTES) {
      throw new FlowBackupError('RESOURCE_TOO_LARGE', '画布中有文件超过 500 MiB，备份失败，请自行手动备份。')
    }
    const extension = metadata.fileName.includes('.') ? '' : `.${metadata.mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin'}`
    const path = `resources/${String(index + 1).padStart(4, '0')}-${safeFileName(metadata.fileName)}${extension}`
    zip.file(path, blob, { binary: true, compression: 'STORE' })
    resources.push({ ...metadata, path, size: blob.size, checksum: metadata.checksum || await checksumBlob(blob) })
  }

  const manifest: FlowBackupManifest = {
    format: 'cnote-flow-backup',
    version: 1,
    schemaVersion: 1,
    sourceRuntime: window.cnoteDesktop ? 'desktop' : 'web-preview',
    capabilities: [
      'flow',
      'local-resources',
      ...(window.cnoteDesktop ? ['desktop-native-browser-snapshots'] : []),
    ],
    warnings: ['浏览器 Cookie、登录态、API Key、后台任务和系统路径不会写入普通备份。'],
    exportedAt: new Date().toISOString(),
    flow: cloneFlowValue(flow),
    resources,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function saveFlowBackup(flow: Flow) {
  const backup = await createFlowBackup(flow)
  await saveBlobToFile(backup, `${safeFileName(flow.name, 'flow')}.cnote.zip`, {
    description: 'Cnote 完整 Flow 备份',
    extension: '.zip',
  })
}

function validateManifest(value: unknown): FlowBackupManifest {
  if (!value || typeof value !== 'object') throw new FlowBackupError('INVALID_BACKUP', '备份文件格式无效。')
  const manifest = value as Partial<FlowBackupManifest>
  if (manifest.format !== 'cnote-flow-backup' || manifest.version !== 1 || !manifest.flow || !Array.isArray(manifest.resources)) {
    throw new FlowBackupError('INVALID_BACKUP', '这不是受支持的 Cnote Flow 备份。')
  }
  if (manifest.schemaVersion !== undefined && manifest.schemaVersion !== 1) {
    throw new FlowBackupError('UNSUPPORTED_SCHEMA', `备份 schema 版本 ${String(manifest.schemaVersion)} 暂不支持。`)
  }
  return manifest as FlowBackupManifest
}

export async function restoreFlowBackup(file: Blob) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new FlowBackupError('INVALID_BACKUP', '备份中缺少 manifest.json。')
  const manifest = validateManifest(JSON.parse(await manifestFile.async('string')))
  const warnings = new Set<string>(Array.isArray(manifest.warnings) ? manifest.warnings.filter((warning): warning is string => typeof warning === 'string' && Boolean(warning.trim())) : [])
  if (manifest.schemaVersion === undefined) warnings.add('这是早期格式备份，已按 schema 1 兼容恢复。')
  if (manifest.sourceRuntime === 'desktop') warnings.add('Desktop 专属浏览器会话和后台任务不会随 Flow 备份迁移。')
  const referencedResourceIds = new Set(collectResources(manifest.flow).map((resource) => resource.resourceId))
  const archivedResourceIds = new Set(manifest.resources.map((resource) => resource.resourceId))
  const missingResource = [...referencedResourceIds].find((resourceId) => !archivedResourceIds.has(resourceId))
  if (missingResource) {
    throw new FlowBackupError('RESOURCE_MISSING', '备份缺少 Flow 引用的本地资源，已取消恢复。')
  }
  const temporaryResourceIds: string[] = []

  try {
    for (const resource of manifest.resources) {
      if (resource.size > MAX_FLOW_BACKUP_FILE_BYTES) {
        throw new FlowBackupError('RESOURCE_TOO_LARGE', '备份中有文件超过 500 MiB，无法恢复。')
      }
      const entry = zip.file(resource.path)
      if (!entry) throw new FlowBackupError('RESOURCE_MISSING', `备份中缺少资源“${resource.fileName}”。`)
      const bytes = await entry.async('uint8array')
      const copiedBytes = new Uint8Array(bytes.byteLength)
      copiedBytes.set(bytes)
      const blob = new Blob([copiedBytes.buffer], { type: resource.mimeType || 'application/octet-stream' })
      if (blob.size > MAX_FLOW_BACKUP_FILE_BYTES) {
        throw new FlowBackupError('RESOURCE_TOO_LARGE', '备份中有文件超过 500 MiB，无法恢复。')
      }
      const stored = await storeLocalResource(blob)
      if (stored.resourceId !== resource.resourceId) {
        await deleteLocalResource(stored.resourceId)
        throw new FlowBackupError('RESOURCE_CHECKSUM_MISMATCH', `资源“${resource.fileName}”校验失败。`)
      }
      temporaryResourceIds.push(stored.resourceId)
    }

    useFlowStore.getState().importFlowFromJSON(JSON.stringify(manifest.flow))
    await Promise.all(temporaryResourceIds.map((resourceId) => deleteLocalResource(resourceId)))
    return { flowId: useFlowStore.getState().currentFlowId, warnings: [...warnings] } satisfies FlowRestoreResult
  } catch (error) {
    await Promise.all(temporaryResourceIds.map((resourceId) => deleteLocalResource(resourceId)))
    throw error
  }
}
