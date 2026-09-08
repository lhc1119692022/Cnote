import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SecretPort } from './types'

type EncryptedSecrets = Record<string, string>

export class SafeStorageSecretStore implements SecretPort {
  private readonly filePath: string
  private loaded: EncryptedSecrets | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'secrets.json')
  }

  private async read(): Promise<EncryptedSecrets> {
    const cached = this.loaded
    if (cached) return cached
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      const entries = parsed && typeof parsed === 'object'
        ? Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        : []
      this.loaded = Object.fromEntries(entries) as EncryptedSecrets
    } catch (error) {
      console.warn('Cnote SafeStorage journal could not be read:', error)
      this.loaded = {}
      try {
        await fs.copyFile(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
      } catch {
        // The file may simply not exist yet.
      }
    }
    return this.loaded
  }

  private async flush(secrets: EncryptedSecrets) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(secrets, null, 2), 'utf8')
  }

  private mutate(mutator: (secrets: EncryptedSecrets) => void) {
    const operation = this.mutationQueue.then(async () => {
      const secrets = await this.read()
      mutator(secrets)
      await this.flush(secrets)
    })
    this.mutationQueue = operation.catch(() => undefined)
    return operation
  }

  async has(name: string) {
    const secrets = await this.read()
    return typeof secrets[name] === 'string'
  }

  async set(name: string, value: string) {
    if (!name.trim()) throw new Error('Secret name is required')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS secure storage is unavailable')
    }
    await this.mutate((secrets) => {
      secrets[name] = safeStorage.encryptString(value).toString('base64')
    })
  }

  async get(name: string) {
    const secrets = await this.read()
    const encoded = secrets[name]
    if (!encoded) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      return null
    }
  }

  async delete(name: string) {
    await this.mutate((secrets) => {
      if (name in secrets) delete secrets[name]
    })
  }
}
