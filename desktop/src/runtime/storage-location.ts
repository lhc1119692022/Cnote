import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertMigrationPaths, canonicalDirectory, migrateDataDirectory } from './data-directory'

const DEFAULT_USER_DATA_PATH = path.resolve(app.getPath('userData'))
const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
const PORTABLE_DATA_PATH = portableRoot ? path.join(portableRoot, 'CnoteData') : undefined
interface LocationConfig { sessionDataPath: string; migrateFrom?: string; migrationId?: string }
export interface StorageLocationInfo {
  currentPath: string
  defaultPath: string
  configuredPath?: string
  restartRequired: boolean
}
function configPath() {
  return portableRoot ? path.join(portableRoot, 'cnote-storage-location.json') : path.join(app.getPath('appData'), 'Cnote', 'storage-location.json')
}
function readConfig(): LocationConfig | undefined {
  if (!existsSync(configPath())) return undefined
  const config = JSON.parse(readFileSync(configPath(), 'utf8')) as LocationConfig
  if (!config.sessionDataPath || !path.isAbsolute(config.sessionDataPath)) throw new Error('数据目录配置损坏，已停止启动以保护原数据：' + configPath())
  return config
}
function writeConfig(config: LocationConfig) {
  const file = configPath()
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = file + '.writing-' + randomUUID()
  writeFileSync(temporary, JSON.stringify(config), 'utf8')
  renameSync(temporary, file)
}
function validateDirectory(value: string) {
  const target = canonicalDirectory(value)
  mkdirSync(target, { recursive: true })
  const probe = path.join(target, '.cnote-write-probe-' + randomUUID())
  closeSync(openSync(probe, 'wx'))
  unlinkSync(probe)
  return target
}
export function configureStorageLocation() {
  const config = readConfig()
  const target = config?.sessionDataPath || PORTABLE_DATA_PATH || DEFAULT_USER_DATA_PATH
  if (config?.migrateFrom) {
    const receipt = path.join(target, '.cnote-migration-complete')
    const completed = existsSync(receipt) && readFileSync(receipt, 'utf8') === config.migrationId
    if (!completed) {
      migrateDataDirectory(config.migrateFrom, target)
      writeFileSync(receipt, config.migrationId || '', 'utf8')
    }
    writeConfig({ sessionDataPath: target })
  }
  if (config && !existsSync(target)) throw new Error('指定的数据目录不存在：' + target)
  const location = validateDirectory(target)
  app.setPath('userData', location)
  app.setPath('sessionData', location)
  const temporary = path.join(location, 'temp')
  mkdirSync(temporary, { recursive: true })
  app.setPath('temp', temporary)
  app.setAppLogsPath(path.join(location, 'logs'))
  const crash = path.join(location, 'Crashpad')
  mkdirSync(crash, { recursive: true })
  app.setPath('crashDumps', crash)
}
export function needsStorageSetup() {
  return !portableRoot && !readConfig() && !existsSync(path.join(app.getPath('userData'), 'Cnote', 'storage'))
}
export function getStorageLocationInfo(): StorageLocationInfo {
  const currentPath = path.resolve(app.getPath('userData'))
  const configuredPath = readConfig()?.sessionDataPath
  return { currentPath, defaultPath: PORTABLE_DATA_PATH || DEFAULT_USER_DATA_PATH, configuredPath, restartRequired: Boolean(configuredPath && configuredPath !== currentPath) }
}
export function setStorageLocation(value: string) {
  const current = app.getPath('userData')
  if (path.resolve(value) === path.resolve(current)) { writeConfig({ sessionDataPath: current }); return getStorageLocationInfo() }
  const { to } = assertMigrationPaths(current, value)
  validateDirectory(to)
  writeConfig({ sessionDataPath: to, migrateFrom: current, migrationId: randomUUID() })
  return getStorageLocationInfo()
}
export function resetStorageLocation() {
  writeConfig({ sessionDataPath: app.getPath('userData') })
  return getStorageLocationInfo()
}
