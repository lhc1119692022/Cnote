import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { OpenFileRequest, OpenFileResult, SaveFileRequest, SystemPort } from './types'

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
}
