import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SecretPort } from './types'

type EncryptedSecrets = Record<string, string>

export class SafeStorageSecretStore implements SecretPort {
  private readonly filePath: string
  private loaded: EncryptedSecrets | null = null

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'secrets.json')
  }

  private async read(): Promise<EncryptedSecrets> {
    if (this.loaded) return this.loaded
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      this.loaded = parsed && typeof parsed === 'object' ? parsed as EncryptedSecrets : {}
    } catch {
      this.loaded = {}
    }
    return this.loaded
  }

  private async flush(secrets: EncryptedSecrets) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(secrets, null, 2), 'utf8')
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
    const secrets = await this.read()
    secrets[name] = safeStorage.encryptString(value).toString('base64')
    await this.flush(secrets)
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
    const secrets = await this.read()
    if (!(name in secrets)) return
    delete secrets[name]
    await this.flush(secrets)
  }
}
