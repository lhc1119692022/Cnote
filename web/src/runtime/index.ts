/**
 * Browser / content runtime orchestration.
 *
 * Pure TS: no React components, no DOM create/append.
 * React (stage 6) mounts webview/iframe and bridges via BrowserAdapter.
 */

export {
  browserViewId,
  desktopBrowserAdapter,
  iframeBrowserAdapter,
} from './browser-adapter'
export type { BrowserAdapter, BrowserView } from './browser-adapter'

export {
  desktopContentParser,
  passthroughContentParser,
} from './content-service'
export type { ContentParser, ParsedPageContent } from './content-service'

export { BrowserSessionManager } from './session-manager'
export type { BrowserSessionManagerOptions, RuntimeStoreGetter } from './session-manager'

export { AssetManager } from './asset-manager'
export type { AssetManagerOptions, AssetStoreGetter } from './asset-manager'

export { legacyFlowToDocument, migrateLegacyFlows } from './legacy-loader'

