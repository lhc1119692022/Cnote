import type { BrowserWindow } from 'electron'
import { BrowserSessionManager } from './browser-session-manager'
import { NativeContentPort } from './content-port'
import { JobManager } from './job-manager'
import { NativeJobRunner } from './native-job-runner'
import { NativeNetworkPort } from './network-port'
import { SafeStorageSecretStore } from './secret-store'
import { NativeSystemPort } from './system-port'
import type { RuntimePorts } from './types'

export class DesktopRuntime {
  readonly ports: RuntimePorts
  private readonly browserSessions: BrowserSessionManager
  private readonly jobManager: JobManager
  private hostWindow: BrowserWindow | null = null

  constructor() {
    this.browserSessions = new BrowserSessionManager()
    this.jobManager = new JobManager()
    const network = new NativeNetworkPort()
    const content = new NativeContentPort()
    const secrets = new SafeStorageSecretStore()
    this.ports = {
      network,
      browser: this.browserSessions,
      content,
      system: new NativeSystemPort(() => this.hostWindow),
      secrets,
      jobs: this.jobManager,
      nativeJobs: new NativeJobRunner(
        this.jobManager,
        network,
        content,
        secrets,
      ),
    }
  }

  attachHostWindow(window: BrowserWindow) {
    this.hostWindow = window
    this.browserSessions.setHostWindow(window)
  }

  detachHostWindow() {
    this.browserSessions.clearHostWindow()
    this.hostWindow = null
  }
}
