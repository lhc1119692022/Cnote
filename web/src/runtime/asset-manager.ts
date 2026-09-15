/**
 * ContentAsset lifecycle on top of `@/storage/asset-store`.
 *
 * Bytes live in resource-storage. This manager only translates ids,
 * caches metadata in runtime store, and mirrors ref-count release.
 */

import type { ContentAsset } from '@/domain'
import {
  loadAssetMeta,
  loadAssetUrl,
  releaseAsset as releaseStoredAsset,
  retainAsset as retainStoredAsset,
  storeAsset,
} from '@/storage/asset-store'
import { useRuntimeStore, type RuntimeStore } from '@/stores/runtime-store'

export type AssetStoreGetter = () => RuntimeStore

export interface AssetManagerOptions {
  getStore?: AssetStoreGetter
}

export class AssetManager {
  private readonly getStore: AssetStoreGetter

  constructor(options: AssetManagerOptions = {}) {
    this.getStore = options.getStore ?? (() => useRuntimeStore.getState())
  }

  async importAsset(file: Blob, fileName?: string): Promise<ContentAsset> {
    const asset = await storeAsset(file, fileName)
    this.getStore().upsertAsset(asset)
    return asset
  }

  /** 先查 runtime store；未命中再读 storage meta。因此为 Promise。 */
  async getAsset(id: string): Promise<ContentAsset | undefined> {
    const cached = this.getStore().assets[id]
    if (cached) return cached
    const meta = await loadAssetMeta(id)
    if (!meta) return undefined
    this.getStore().upsertAsset(meta)
    return meta
  }

  async retainAsset(id: string): Promise<void> {
    await retainStoredAsset(id)
  }

  /**
   * storage 按引用计数回收。仅当磁盘 meta 已消失时从 runtime store 去掉缓存；
   * 仍有引用则保留元数据，供节点继续解析 assetId。
   */
  async releaseAsset(id: string): Promise<void> {
    await releaseStoredAsset(id)
    const meta = await loadAssetMeta(id)
    if (!meta) this.getStore().removeAsset(id)
  }

  resolveAssetUrl(id: string): Promise<string | null> {
    return loadAssetUrl(id)
  }
}
