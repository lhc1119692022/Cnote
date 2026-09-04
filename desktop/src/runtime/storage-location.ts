import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const STORAGE_CONFIG_DIRECTORY = 'Cnote'
const STORAGE_CONFIG_FILE = 'storage-location.json'
// Capture Electron's platform-specific default before any override is applied.
const DEFAULT_USER_DATA_PATH = path.resolve(app.getPath('userData'))

export interface StorageLocationInfo {
  /** Directory used by Electron for cookies, cache, IndexedDB and session data. */
  currentPath: string
  /** Default Electron user-data directory used when no custom location is configured. */
  defaultPath: string
  /** Location selected for the next launch, when it differs from currentPath. */
  configuredPath?: string
  restartRequired: boolean
}

function configPath() {
  return path.join(app.getPath('appData'), STORAGE_CONFIG_DIRECTORY, STORAGE_CONFIG_FILE)
}

function normalizePath(value: string) {
  return path.resolve(value)
}

function readConfiguredPath() {
  try {
    const raw = readFileSync(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as { sessionDataPath?: unknown }
    if (typeof parsed.sessionDataPath !== 'string' || !path.isAbsolute(parsed.sessionDataPath)) return undefined
    return normalizePath(parsed.sessionDataPath)
  } catch {
    return undefined
  }
}

function writeConfiguredPath(sessionDataPath: string) {
  const file = configPath()
  const directory = path.dirname(file)
  mkdirSync(directory, { recursive: true })
  const temporary = `${file}.writing-${process.pid}-${Date.now()}`
  writeFileSync(temporary, JSON.stringify({ sessionDataPath }, null, 2), 'utf8')
  renameSync(temporary, file)
}

function validateDirectory(value: string) {
  const candidate = String(value || '').trim()
  if (!candidate || !path.isAbsolute(candidate)) throw new Error('存储位置必须是绝对路径。')
  const resolved = normalizePath(candidate)
  mkdirSync(resolved, { recursive: true })
  return resolved
}

/** Apply the persisted app-data location before Electron creates sessions. */
export function configureStorageLocation() {
  const configured = readConfiguredPath()
  if (!configured) return
  try {
    const target = validateDirectory(configured)
    if (DEFAULT_USER_DATA_PATH !== target) {
      // Keep the app journal/secrets and Chromium session data together.
      app.setPath('userData', target)
      app.setPath('sessionData', target)
    }
  } catch (error) {
    // Keep the default path if a removable drive or stale directory is gone.
    console.warn('Cnote custom storage location is unavailable:', error instanceof Error ? error.message : String(error))
  }
}

export function getStorageLocationInfo(): StorageLocationInfo {
  const defaultPath = DEFAULT_USER_DATA_PATH
  const currentPath = normalizePath(app.getPath('userData'))
  const configuredPath = readConfiguredPath()
  return {
    currentPath,
    defaultPath,
    ...(configuredPath ? { configuredPath } : {}),
    restartRequired: configuredPath ? configuredPath !== currentPath : currentPath !== defaultPath,
  }
}

export function setStorageLocation(value: string) {
  const target = validateDirectory(value)
  const defaultPath = DEFAULT_USER_DATA_PATH
  if (target === defaultPath) {
    resetStorageLocation()
    return getStorageLocationInfo()
  }
  writeConfiguredPath(target)
  return getStorageLocationInfo()
}

export function resetStorageLocation() {
  try {
    rmSync(configPath(), { force: true })
  } catch (error) {
    throw new Error(`无法恢复默认存储位置：${error instanceof Error ? error.message : String(error)}`)
  }
  return getStorageLocationInfo()
}
