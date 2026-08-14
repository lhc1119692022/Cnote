import JSZip from 'jszip'
import type { Node } from 'reactflow'
import type { Flow } from '@/types/flow'
import { cloneFlowValue } from '@/lib/flow/clone'
import {
  checksumBlob,
  deleteLocalResource,
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
  exportedAt: string
  flow: Flow
  resources: BackupResource[]
}

export class FlowBackupError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'FlowBackupError'
    this.code = code
  }
}

function localResource(node: Node) {
  const source = node.data?.source
  if (source?.kind === 'file') {
    return {
      resourceId: String(source.resourceId),
      fileName: safeFileName(String(source.fileName || node.data?.label || 'file')),
      mimeType: String(source.mimeType || 'application/octet-stream'),
      size: Number(source.size || 0),
      checksum: String(source.checksum || ''),
    }
  }
  if (source?.kind === 'clipboard-image') {
    return {
      resourceId: String(source.resourceId),
      fileName: safeFileName(`${node.data?.label || 'clipboard-image'}`),
      mimeType: String(source.mimeType || 'image/png'),
      size: Number(source.size || 0),
      checksum: String(source.checksum || ''),
    }
  }
  return undefined
}

function collectResources(flow: Flow) {
  const resources = new Map<string, ReturnType<typeof localResource>>()
  flow.nodes.forEach((node) => {
    const resource = localResource(node)
    if (resource && !resources.has(resource.resourceId)) resources.set(resource.resourceId, resource)
  })
  return [...resources.values()].filter((resource): resource is NonNullable<typeof resource> => Boolean(resource))
}

export async function createFlowBackup(flow: Flow) {
  const zip = new JSZip()
  const resources: BackupResource[] = []
  const localResources = collectResources(flow)

  for (let index = 0; index < localResources.length; index += 1) {
    const resource = localResources[index]
    if (resource.size > MAX_FLOW_BACKUP_FILE_BYTES) {
      throw new FlowBackupError('RESOURCE_TOO_LARGE', '画布中有文件超过 500 MiB，备份失败，请自行手动备份。')
    }
    const blob = await loadLocalResourceBlob(resource.resourceId)
    if (!blob) throw new FlowBackupError('RESOURCE_MISSING', `本地文件“${resource.fileName}”已丢失，无法完成备份。`)
    if (blob.size > MAX_FLOW_BACKUP_FILE_BYTES) {
      throw new FlowBackupError('RESOURCE_TOO_LARGE', '画布中有文件超过 500 MiB，备份失败，请自行手动备份。')
    }
    const extension = resource.fileName.includes('.') ? '' : `.${resource.mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin'}`
    const path = `resources/${String(index + 1).padStart(4, '0')}-${safeFileName(resource.fileName)}${extension}`
    zip.file(path, blob, { binary: true, compression: 'STORE' })
    resources.push({ ...resource, path, size: blob.size, checksum: resource.checksum || await checksumBlob(blob) })
  }

  const manifest: FlowBackupManifest = {
    format: 'cnote-flow-backup',
    version: 1,
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
  return manifest as FlowBackupManifest
}

export async function restoreFlowBackup(file: Blob) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new FlowBackupError('INVALID_BACKUP', '备份中缺少 manifest.json。')
  const manifest = validateManifest(JSON.parse(await manifestFile.async('string')))
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
    return useFlowStore.getState().currentFlowId
  } catch (error) {
    await Promise.all(temporaryResourceIds.map((resourceId) => deleteLocalResource(resourceId)))
    throw error
  }
}
