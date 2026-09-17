import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { StoragePort } from './types'

const MAX_KEY_LENGTH = 256

export function resolveCnoteStorageDirectory(userDataPath: string) {
  return path.join(userDataPath, 'Cnote', 'storage')
}

export function encodeStorageKey(key: string) {
  if (typeof key !== 'string' || key.length === 0) throw new Error('storage key is required')
  if (key.length > MAX_KEY_LENGTH) throw new Error('storage key is too long')
  if (key.includes('\0')) throw new Error('storage key is invalid')
  return `${Buffer.from(key, 'utf8').toString('base64url')}.bin`
}

function isNotFound(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'ENOENT')
}

function assertInsideDirectory(root: string, target: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('storage key is invalid')
  }
  return resolvedTarget
}

export class NativeStoragePort implements StoragePort {
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly rootDirectory: string) {
    if (!this.rootDirectory || !path.isAbsolute(this.rootDirectory)) {
      throw new Error('storage root must be an absolute path')
    }
  }

  private resolveKeyPath(key: string) {
    const fileName = encodeStorageKey(key)
    if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      throw new Error('storage key is invalid')
    }
    return assertInsideDirectory(this.rootDirectory, path.join(this.rootDirectory, fileName))
  }

  async keys(): Promise<string[]> {
    await this.writeChain
    try {
      return (await fs.readdir(this.rootDirectory)).filter(name => name.endsWith('.bin')).map(name => Buffer.from(name.slice(0, -4), 'base64url').toString('utf8')).filter(key => encodeStorageKey(key).endsWith('.bin'))
    } catch (error) { if (isNotFound(error)) return []; throw error }
  }

  async read(key: string) {
    const target = this.resolveKeyPath(key)
    try {
      return new Uint8Array(await fs.readFile(target))
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async write(key: string, data: Uint8Array) {
    if (!(data instanceof Uint8Array)) throw new Error('storage data is invalid')
    const target = this.resolveKeyPath(key)
    const operation = this.writeChain.then(() => this.writeAtomically(target, data))
    this.writeChain = operation.catch(() => undefined)
    return operation
  }

  async remove(key: string) {
    const target = this.resolveKeyPath(key)
    const operation = this.writeChain.then(async () => {
      await fs.rm(target, { force: true })
    })
    this.writeChain = operation.catch(() => undefined)
    return operation
  }

  private async writeAtomically(target: string, data: Uint8Array) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.writing-${process.pid}-${randomUUID()}`
    try {
      await fs.writeFile(temporary, data)
      try {
        await fs.rename(temporary, target)
      } catch {
        // Windows cannot always rename onto an existing path.
        await fs.copyFile(temporary, target)
        await fs.rm(temporary, { force: true })
      }
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
