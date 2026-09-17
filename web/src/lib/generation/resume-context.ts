import type { GenerationTask, GenerationTaskStatus, GenerationRunStatus } from '@/domain'
import type { GenerationChannel, GenerationModel, GenerationProtocolId, GenerationProviderId } from '@/stores/use-generation-store'
import type { GenerationTaskRequestSnapshot } from '@/types/flow'

const PROVIDER_IDS = new Set<GenerationProviderId>(['openai', 'google', 'video', 'custom'])
const PROTOCOL_IDS = new Set<GenerationProtocolId>([
  'openai-images',
  'google-images',
  'video-api',
  'video-808relay',
  'video-kacang',
])
const TERMINAL_SKIP_STATUSES = new Set<GenerationTaskStatus>(['completed', 'cancelled'])

export interface GenerationResumeRequestContext {
  channel: GenerationChannel
  model: GenerationModel
  config: GenerationTaskRequestSnapshot['config']
  variant: GenerationTaskRequestSnapshot['variant']
}

function providerIdFromSnapshot(value: string, fallback?: GenerationProviderId): GenerationProviderId {
  if (PROVIDER_IDS.has(value as GenerationProviderId)) return value as GenerationProviderId
  return fallback || 'custom'
}

function protocolFromSnapshot(value: string | undefined, fallback?: GenerationProtocolId): GenerationProtocolId | undefined {
  if (value && PROTOCOL_IDS.has(value as GenerationProtocolId)) return value as GenerationProtocolId
  return fallback
}

export function generationRunStatusFromTasks(tasks: readonly Pick<GenerationTask, 'status'>[]): GenerationRunStatus {
  if (!tasks.length) return 'created'
  if (tasks.some((task) => task.status === 'queued' || task.status === 'running')) return 'running'
  if (tasks.some((task) => task.status === 'validating')) return 'validating'
  if (tasks.every((task) => task.status === 'completed')) return 'completed'
  if (tasks.every((task) => task.status === 'idle')) return 'created'
  if (tasks.some((task) => task.status === 'failed')) return 'failed'
  if (tasks.some((task) => task.status === 'cancelled' || task.status === 'idle')) return 'cancelled'
  return 'running'
}

export function generationTaskResumeBlockReason(
  task: Pick<GenerationTask, 'status' | 'remoteTaskId' | 'requestSnapshot'>,
): string | undefined {
  if (TERMINAL_SKIP_STATUSES.has(task.status)) return undefined
  if (!task.remoteTaskId) return '缺少远程任务，无法继续查询'
  if (!task.requestSnapshot?.baseURL) return '缺少请求快照，无法继续查询'
  return undefined
}

export function isGenerationTaskResumable(
  task: Pick<GenerationTask, 'status' | 'remoteTaskId' | 'requestSnapshot'>,
): boolean {
  if (TERMINAL_SKIP_STATUSES.has(task.status)) return false
  return !generationTaskResumeBlockReason(task)
}

export function generationRequestContextFromSnapshot(
  snapshot: GenerationTaskRequestSnapshot,
  current?: { channel?: GenerationChannel; model?: GenerationModel },
): GenerationResumeRequestContext {
  const currentChannel = current?.channel
  const protocol = protocolFromSnapshot(snapshot.protocol, currentChannel?.protocol)
  const adapterId = snapshot.adapterId || snapshot.config.adapterId
  const snapshotAdapter = protocol
    ? {
      id: adapterId || protocol,
      protocol,
      ...(snapshot.mediaTransport ? { mediaTransport: snapshot.mediaTransport } : {}),
      ...(snapshot.mediaUploadPath ? { mediaUploadPath: snapshot.mediaUploadPath } : {}),
      ...(snapshot.mediaUploadURL ? { mediaUploadURL: snapshot.mediaUploadURL } : {}),
    }
    : undefined

  const channel: GenerationChannel = {
    id: snapshot.channelId,
    providerId: providerIdFromSnapshot(snapshot.providerId, currentChannel?.providerId),
    name: currentChannel?.name || snapshot.channelId,
    baseURL: snapshot.baseURL,
    modelIds: currentChannel?.modelIds?.length ? currentChannel.modelIds : [snapshot.model],
    enabled: currentChannel?.enabled ?? true,
    apiKey: currentChannel?.apiKey,
    encryptedKey: currentChannel?.encryptedKey,
    secretName: currentChannel?.secretName || snapshot.secretName,
    mediaUploadApiKey: currentChannel?.mediaUploadApiKey,
    encryptedMediaUploadKey: currentChannel?.encryptedMediaUploadKey,
    mediaUploadSecretName: currentChannel?.mediaUploadSecretName || snapshot.mediaUploadSecretName,
  }
  if (currentChannel?.presetId) channel.presetId = currentChannel.presetId
  else if (snapshot.presetId) channel.presetId = snapshot.presetId
  if (currentChannel?.presetVersion) channel.presetVersion = currentChannel.presetVersion
  else if (snapshot.presetVersion) channel.presetVersion = snapshot.presetVersion
  if (protocol) channel.protocol = protocol
  if (snapshot.mediaTransport) channel.mediaTransport = snapshot.mediaTransport
  else if (currentChannel?.mediaTransport) channel.mediaTransport = currentChannel.mediaTransport
  if (snapshot.mediaUploadPath) channel.mediaUploadPath = snapshot.mediaUploadPath
  else if (currentChannel?.mediaUploadPath) channel.mediaUploadPath = currentChannel.mediaUploadPath
  if (snapshot.mediaUploadURL) channel.mediaUploadURL = snapshot.mediaUploadURL
  else if (currentChannel?.mediaUploadURL) channel.mediaUploadURL = currentChannel.mediaUploadURL
  if (currentChannel?.mediaUploadField) channel.mediaUploadField = currentChannel.mediaUploadField
  if (currentChannel?.mediaUploadResponsePath) channel.mediaUploadResponsePath = currentChannel.mediaUploadResponsePath
  if (currentChannel?.supportsImage !== undefined) channel.supportsImage = currentChannel.supportsImage
  if (currentChannel?.supportsVideo !== undefined) channel.supportsVideo = currentChannel.supportsVideo
  if (currentChannel?.modelCatalog) channel.modelCatalog = currentChannel.modelCatalog
  if (currentChannel?.videoRequestContract) channel.videoRequestContract = currentChannel.videoRequestContract
  if (snapshotAdapter) channel.adapters = [snapshotAdapter]
  else if (currentChannel?.adapters) channel.adapters = currentChannel.adapters

  const currentModel = current?.model?.id === snapshot.model ? current.model : undefined
  const model: GenerationModel = currentModel
    ? (adapterId && currentModel.adapterId !== adapterId ? { ...currentModel, adapterId } : currentModel)
    : {
      id: snapshot.model,
      name: snapshot.model,
      capabilities: [],
      ...(adapterId ? { adapterId } : {}),
    }

  return {
    channel,
    model,
    config: {
      ...snapshot.config,
      channelId: snapshot.config.channelId || snapshot.channelId,
      model: snapshot.config.model || snapshot.model,
      ...(adapterId ? { adapterId } : {}),
      references: snapshot.config.references.map((reference) => ({ ...reference })),
    },
    variant: snapshot.variant,
  }
}
