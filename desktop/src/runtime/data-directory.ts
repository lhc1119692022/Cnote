import * as fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const cacheNames = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'ShaderCache', 'GrShaderCache', 'CacheStorage', 'Crashpad', 'temp', 'logs'])
const transientNames = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile', 'DevToolsActivePort'])

export function canonicalDirectory(value: string): string {
  if (!path.isAbsolute(value)) throw new Error('数据目录必须为绝对路径')
  let existing = path.resolve(value)
  const tail: string[] = []
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing))
    const parent = path.dirname(existing)
    if (parent === existing) throw new Error('数据磁盘不可用')
    existing = parent
  }
  return path.join(fs.realpathSync(existing), ...tail)
}

export function assertMigrationPaths(source: string, target: string) {
  const from = canonicalDirectory(source)
  const to = canonicalDirectory(target)
  const inside = (parent: string, child: string) => {
    const relative = path.relative(parent, child)
    return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  }
  if (inside(from, to) || inside(to, from)) throw new Error('新旧数据目录不能相同或互相包含')
  if (fs.existsSync(to) && fs.readdirSync(to).length) throw new Error('请选择空文件夹，避免覆盖已有数据')
  return { from, to }
}

function digest(file: string) {
  const hash = createHash('sha256')
  const handle = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let length: number
    while ((length = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length))
  } finally { fs.closeSync(handle) }
  return hash.digest('hex')
}

export function directoryUsage(root: string) {
  const totals = { resources: 0, data: 0, cache: 0, total: 0 }
  function walk(directory: string, cached = false) {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(directory, entry.name)
      const isCache = cached || cacheNames.has(entry.name)
      if (entry.isDirectory()) { walk(full, isCache); continue }
      if (!entry.isFile()) continue
      const size = fs.statSync(full).size
      const key = entry.name.endsWith('.bin') ? Buffer.from(entry.name.slice(0, -4), 'base64url').toString('utf8') : ''
      const category = isCache || key.startsWith('gallery-thumb:') ? 'cache' : key.startsWith('resource:') || directory === path.join(root, 'resources') ? 'resources' : 'data'
      totals[category] += size
      totals.total += size
    }
  }
  walk(root)
  return totals
}

export function migrateDataDirectory(source: string, target: string) {
  const { from, to } = assertMigrationPaths(source, target)
  if (!fs.existsSync(from)) throw new Error('原数据目录不可用，未切换存储位置')
  fs.mkdirSync(path.dirname(to), { recursive: true })
  const available = fs.statfsSync(path.dirname(to))
  if (available.bavail * available.bsize < directoryUsage(from).total + 64 * 1024 * 1024) throw new Error('目标磁盘可用空间不足')
  const staging = path.join(path.dirname(to), '.cnote-migration-' + randomUUID())
  fs.mkdirSync(staging)
  function copy(directory: string, destination: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (cacheNames.has(entry.name) || transientNames.has(entry.name)) continue
      if (entry.isSymbolicLink()) throw new Error('数据目录含链接，请先检查：' + entry.name)
      const input = path.join(directory, entry.name)
      const output = path.join(destination, entry.name)
      if (entry.isDirectory()) { fs.mkdirSync(output); copy(input, output) }
      else if (entry.isFile()) {
        fs.copyFileSync(input, output, fs.constants.COPYFILE_EXCL)
        if (digest(input) !== digest(output)) throw new Error('数据校验失败：' + entry.name)
      }
    }
  }
  try {
    copy(from, staging)
    if (fs.existsSync(to)) fs.rmdirSync(to)
    fs.renameSync(staging, to)
  } catch (error) {
    throw new Error('迁移未完成，原数据未删除。临时副本：' + staging + '。' + String(error))
  }
}
