/**
 * Maps ContentAsset onto the existing checksum-deduped resource layer.
 * Bytes stay in resource-storage; this module only translates ids and metadata.
 *
 * Convention: resourceId `sha256-<hex>` ↔ assetId `asset-<hex>`;
 * ContentAsset.hash is the raw SHA-256 hex (no `sha256-` prefix).
 */

import type { ContentAsset } from '@/domain'
import {
  deleteLocalResource,
  getLocalResourceMeta,
  loadLocalResourceUrl,
  retainLocalResource,
  storeLocalResource,
} from '@/lib/resource-storage'

const RESOURCE_ID_PREFIX = 'sha256-'
const ASSET_ID_PREFIX = 'asset-'

function hexFromId(value: string): string {
  if (value.startsWith(ASSET_ID_PREFIX)) return value.slice(ASSET_ID_PREFIX.length)
  if (value.startsWith(RESOURCE_ID_PREFIX)) return value.slice(RESOURCE_ID_PREFIX.length)
  return value
}

export function assetIdForResource(resourceId: string): string {
  return `${ASSET_ID_PREFIX}${hexFromId(resourceId)}`
}

export function resourceIdForAsset(assetId: string): string {
  return `${RESOURCE_ID_PREFIX}${hexFromId(assetId)}`
}

function assetFromResourceMeta(meta: {
  id: string
  checksum: string
  mimeType: string
  size: number
}): ContentAsset {
  const hash = meta.checksum.startsWith(RESOURCE_ID_PREFIX)
    ? meta.checksum.slice(RESOURCE_ID_PREFIX.length)
    : meta.checksum
  return {
    id: assetIdForResource(meta.id),
    hash,
    mimeType: meta.mimeType,
    size: meta.size,
  }
}

export async function storeAsset(file: Blob, fileName?: string): Promise<ContentAsset> {
  const stored = await storeLocalResource(file, fileName)
  const hash = stored.checksum.startsWith(RESOURCE_ID_PREFIX)
    ? stored.checksum.slice(RESOURCE_ID_PREFIX.length)
    : stored.checksum
  return {
    id: assetIdForResource(stored.resourceId),
    hash,
    mimeType: stored.mimeType,
    size: stored.size,
  }
}

export async function retainAsset(assetId: string): Promise<void> {
  await retainLocalResource(resourceIdForAsset(assetId))
}

export async function releaseAsset(assetId: string): Promise<void> {
  await deleteLocalResource(resourceIdForAsset(assetId))
}

export async function loadAssetUrl(assetId: string): Promise<string | null> {
  return loadLocalResourceUrl(resourceIdForAsset(assetId))
}

export async function loadAssetMeta(assetId: string): Promise<ContentAsset | null> {
  const meta = await getLocalResourceMeta(resourceIdForAsset(assetId))
  if (!meta) return null
  return assetFromResourceMeta(meta)
}
