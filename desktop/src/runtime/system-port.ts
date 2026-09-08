import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getStorageLocationInfo, resetStorageLocation, setStorageLocation } from './storage-location'
import type { DirectoryDialogRequest, OpenFileRequest, OpenFileResult, SaveFileRequest, SystemPort } from './types'

const MAX_OPEN_BYTES = 600 * 1024 * 1024

function normalizeFilters(filters?: OpenFileRequest['filters']) {
  return (filters || []).map((filter) => ({
    name: String(filter.name || '文件'),
    extensions: filter.extensions.map((extension) => extension.replace(/^\./, '').toLowerCase()).filter(Boolean),
  })).filter((filter) => filter.extensions.length > 0)
}

function safeSuggestedPath(value: string) {
  const fileName = path.basename(String(value || 'cnote-file'))
  return path.join(app.getPath('documents'), fileName || 'cnote-file')
}

export class NativeSystemPort implements SystemPort {
  constructor(private readonly getParentWindow: () => BrowserWindow | null) {}

  async openFile(request: OpenFileRequest = {}): Promise<OpenFileResult | null> {
    const options = {
      title: request.title || '打开 Cnote 文件',
      properties: ['openFile'] as Array<'openFile'>,
      filters: normalizeFilters(request.filters),
    }
    const parent = this.getParentWindow()
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const stat = await fs.stat(filePath)
    if (stat.size > MAX_OPEN_BYTES) throw new Error('文件超过 600 MiB，无法导入。')
    return {
      name: path.basename(filePath),
      data: new Uint8Array(await fs.readFile(filePath)),
    }
  }

  async saveFile(request: SaveFileRequest) {
    if (!(request.data instanceof Uint8Array)) throw new Error('要保存的数据无效。')
    const options = {
      title: request.title || '保存 Cnote 文件',
      defaultPath: safeSuggestedPath(request.suggestedName),
      filters: normalizeFilters(request.filters),
    }
    const parent = this.getParentWindow()
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false

    const target = result.filePath
    const temporary = `${target}.cnote-writing-${process.pid}-${Date.now()}`
    try {
      await fs.writeFile(temporary, request.data)
      await fs.rename(temporary, target)
      return true
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async saveResource(request: { resourceId: string; fileName: string; data: Uint8Array }) {
    if (!(request.data instanceof Uint8Array)) throw new Error('资源数据无效。')
    if (!/^sha256-[a-f0-9]{64}$/.test(request.resourceId)) throw new Error('资源 ID 无效。')
    const extension = path.extname(path.basename(request.fileName)).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.bin'
    const resourceDirectory = path.join(app.getPath('userData'), 'resources')
    const target = path.join(resourceDirectory, request.resourceId + extension)
    await fs.mkdir(resourceDirectory, { recursive: true })
    const temporary = target + '.cnote-writing-' + process.pid + '-' + randomUUID()
    try {
      await fs.writeFile(temporary, request.data)
      await fs.rename(temporary, target)
      return target
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async selectDirectory(request: DirectoryDialogRequest = {}) {
    const options = {
      title: request.title || '选择 Cnote 本地数据位置',
      defaultPath: request.defaultPath && path.isAbsolute(request.defaultPath) ? request.defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }
    const parent = this.getParentWindow()
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return path.resolve(result.filePaths[0])
  }

  async getStorageLocation() {
    return getStorageLocationInfo()
  }

  async setStorageLocation(value: string) {
    return setStorageLocation(value)
  }

  async resetStorageLocation() {
    return resetStorageLocation()
  }

  async restart() {
    app.relaunch()
    app.exit(0)
  }
}
