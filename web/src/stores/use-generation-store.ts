import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { localForageStorage } from '@/lib/localforage-storage'
import { decryptAPIKey, encryptAPIKey } from '@/lib/secure-storage'
import type { GenerationCapability } from '@/types/flow'

export type GenerationProviderId = '808' | 'newapi' | 'meaicc' | 'fmage' | 'custom'

export interface GenerationModel {
  id: string
  name: string
  capabilities: GenerationCapability[]
  inputTypes?: Array<'image' | 'video' | 'audio'>
  maxImages?: number
  maxVideos?: number
  maxAudios?: number
  maxDuration?: number
  minDuration?: number
  pollIntervalMs?: number
  resolutions?: string[]
  aspectRatios?: string[]
}

export interface GenerationChannel {
  id: string
  name: string
  providerId: GenerationProviderId
  baseURL: string
  apiKey?: string
  encryptedKey?: string
  modelIds: string[]
  enabled: boolean
}

export const GENERATION_PROVIDER_LABELS: Record<GenerationProviderId, string> = {
  '808': '808 Relay',
  newapi: '卡藏 / NewAPI',
  meaicc: 'MEAICC',
  fmage: 'Fmage',
  custom: '自定义生成渠道',
}

export const GENERATION_MODEL_CATALOG: Record<GenerationProviderId, GenerationModel[]> = {
  '808': [
    {
      id: 'sd2-5-720p',
      name: 'sd2-5-720p',
      capabilities: ['reference-to-video', 'generate-audio'],
      inputTypes: ['image', 'video', 'audio'],
      maxDuration: 30,
      minDuration: 1,
      pollIntervalMs: 10000,
      resolutions: ['720p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
    },
  ],
  newapi: [
    {
      id: 'nano-banana-pro',
      name: 'Nano Banana Pro',
      capabilities: ['text-to-image', 'image-to-image'],
      inputTypes: ['image'],
      resolutions: ['1k', '2k', '4k'],
      aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
    },
    {
      id: 'gpt-image-2-1k',
      name: 'GPT Image 2 · 1K',
      capabilities: ['text-to-image', 'image-to-image'],
      inputTypes: ['image'],
      resolutions: ['1k'],
      aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
    },
    {
      id: 'gpt-image-2',
      name: 'GPT Image 2',
      capabilities: ['text-to-image', 'image-to-image'],
      inputTypes: ['image'],
      resolutions: ['1k', '2k', '4k'],
      aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
    },
    {
      id: 'seedance-2.0',
      name: 'Seedance S-2.0',
      capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference'],
      inputTypes: ['image', 'video'],
      pollIntervalMs: 10000,
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16'],
    },
    {
      id: 'seedance-2.0-fast',
      name: 'Seedance S-2.0 Fast',
      capabilities: ['text-to-video', 'image-to-video', 'reference-to-video'],
      inputTypes: ['image', 'video'],
      pollIntervalMs: 10000,
      resolutions: ['720p'],
      aspectRatios: ['16:9', '9:16'],
    },
    {
      id: 'seedance-2.5',
      name: 'Seedance S-2.5',
      capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference', 'audio-reference', 'video-edit'],
      inputTypes: ['image', 'video', 'audio'],
      pollIntervalMs: 10000,
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
    },
    {
      id: 'seedance-2.5-fast',
      name: 'Seedance S-2.5 Fast',
      capabilities: ['text-to-video', 'image-to-video', 'reference-to-video'],
      inputTypes: ['image', 'video'],
      pollIntervalMs: 10000,
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16'],
    },
    {
      id: 'S-2.0-9图版',
      name: 'S-2.0-9图版',
      capabilities: ['image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference'],
      inputTypes: ['image', 'video'],
      maxImages: 9,
      maxVideos: 3,
      minDuration: 4,
      maxDuration: 15,
      pollIntervalMs: 10000,
      resolutions: ['720p'],
      aspectRatios: ['16:9', '9:16'],
    },
    {
      id: 'S-2.5特惠15s-线路六',
      name: 'S-2.5 特惠 15s · 线路六',
      capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-reference', 'audio-reference'],
      inputTypes: ['image', 'video', 'audio'],
      maxImages: 30,
      maxVideos: 3,
      maxAudios: 10,
      minDuration: 4,
      maxDuration: 15,
      pollIntervalMs: 10000,
      resolutions: ['480p', '720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '21:9', '4:3', '1:1', '3:4'],
    },
    {
      id: 'S-2.0满血-线路六',
      name: 'S-2.0 满血 · 线路六',
      capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-reference', 'audio-reference'],
      inputTypes: ['image', 'video', 'audio'],
      maxImages: 9,
      maxVideos: 3,
      maxAudios: 3,
      minDuration: 4,
      maxDuration: 15,
      pollIntervalMs: 10000,
      resolutions: ['480p', '720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '21:9', '4:3', '1:1', '3:4'],
    },
    {
      id: 'S-2.0满血mini',
      name: 'S-2.0 满血 mini',
      capabilities: ['text-to-video', 'generate-audio'],
      minDuration: 4,
      maxDuration: 15,
      pollIntervalMs: 10000,
      resolutions: ['480p', '720p'],
      aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    },
    {
      id: 'S-2.5-10s',
      name: 'S-2.5 · 10s',
      capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'audio-reference'],
      inputTypes: ['image', 'audio'],
      maxImages: 30,
      maxAudios: 10,
      minDuration: 4,
      maxDuration: 10,
      pollIntervalMs: 10000,
      aspectRatios: ['16:9', '9:16', '1:1'],
    },
    {
      id: 'minimax_h3',
      name: 'MiniMax H3',
      capabilities: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-to-video', 'video-reference', 'audio-reference'],
      inputTypes: ['image', 'video', 'audio'],
      maxImages: 9,
      maxVideos: 3,
      maxAudios: 3,
      minDuration: 4,
      maxDuration: 15,
      pollIntervalMs: 20000,
      resolutions: ['768', '1080p', '2K', '4K'],
      aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    },
    {
      id: 'MiniMax-H3-漫剧优化',
      name: 'MiniMax-H3-漫剧优化',
      capabilities: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-to-video', 'video-reference', 'audio-reference'],
      inputTypes: ['image', 'video', 'audio'],
      maxImages: 9,
      maxVideos: 3,
      maxAudios: 3,
      minDuration: 4,
      maxDuration: 15,
      pollIntervalMs: 20000,
      resolutions: ['768', '2K', '4K'],
      aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    },
    {
      id: 'MiniMax-H3-量化版',
      name: 'MiniMax-H3-量化版',
      capabilities: ['text-to-video', 'image-to-video', 'reference-to-video'],
      inputTypes: ['image', 'video'],
      minDuration: 4,
      maxDuration: 15,
      pollIntervalMs: 20000,
      resolutions: ['768', '2K', '4K'],
      aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    },
  ],
  meaicc: [
    {
      id: 'sd-2-c1',
      name: 'MiniMax H3 / sd-2-c1',
      capabilities: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-to-video', 'video-reference', 'audio-reference'],
      inputTypes: ['image', 'video', 'audio'],
      maxImages: 9,
      maxVideos: 3,
      maxAudios: 3,
      minDuration: 4,
      maxDuration: 15,
      pollIntervalMs: 20000,
      resolutions: ['768', '2K', '4K'],
      aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    },
  ],
  fmage: [
    {
      id: 'openai-images',
      name: 'OpenAI Images',
      capabilities: ['text-to-image', 'image-to-image'],
      inputTypes: ['image'],
      resolutions: ['1k', '2k', '4k'],
      aspectRatios: ['1:1', '16:9', '9:16'],
    },
  ],
  custom: [],
}

interface GenerationState {
  channels: GenerationChannel[]
  addChannel: (input?: Partial<GenerationChannel>) => GenerationChannel
  updateChannel: (id: string, updates: Partial<GenerationChannel>) => void
  removeChannel: (id: string) => void
  getChannel: (id: string) => GenerationChannel | undefined
  getAPIKey: (id: string) => string | null
  getModels: (channelId?: string) => GenerationModel[]
}

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set, get) => ({
      channels: [],
      addChannel: (input = {}) => {
        const providerId = input.providerId || 'custom'
        const catalog = GENERATION_MODEL_CATALOG[providerId]
        const channel: GenerationChannel = {
          id: nanoid(),
          name: input.name || `${GENERATION_PROVIDER_LABELS[providerId]} 渠道`,
          providerId,
          baseURL: input.baseURL || '',
          apiKey: input.apiKey || '',
          modelIds: input.modelIds || catalog.map((model) => model.id),
          enabled: input.enabled ?? true,
        }
        set((state) => ({ channels: [...state.channels, channel] }))
        return channel
      },
      updateChannel: (id, updates) => set((state) => ({
        channels: state.channels.map((channel) => {
          if (channel.id !== id) return channel
          const keyUpdates = updates.apiKey === undefined
            ? {}
            : { encryptedKey: updates.apiKey ? encryptAPIKey(updates.apiKey) : undefined }
          return { ...channel, ...updates, ...keyUpdates }
        }),
      })),
      removeChannel: (id) => set((state) => ({ channels: state.channels.filter((channel) => channel.id !== id) })),
      getChannel: (id) => get().channels.find((channel) => channel.id === id),
      getAPIKey: (id) => {
        const channel = get().getChannel(id)
        if (!channel) return null
        return channel.apiKey || (channel.encryptedKey ? decryptAPIKey(channel.encryptedKey) : null)
      },
      getModels: (channelId) => {
        const channel = channelId ? get().getChannel(channelId) : undefined
        if (!channel) return []
        const catalog = GENERATION_MODEL_CATALOG[channel.providerId]
        return channel.modelIds.map((id) => catalog.find((model) => model.id === id) || {
          id,
          name: id,
          capabilities: [],
        })
      },
    }),
    {
      name: 'cnote-generation',
      storage: createJSONStorage(() => localForageStorage),
      partialize: (state) => ({
        channels: state.channels.map((channel) => ({
          ...channel,
          apiKey: undefined,
          encryptedKey: channel.apiKey ? encryptAPIKey(channel.apiKey) : channel.encryptedKey,
        })),
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<GenerationState> | undefined
        return {
          ...current,
          ...stored,
          channels: (stored?.channels || []).map((channel) => ({
            ...channel,
            apiKey: channel.apiKey || (channel.encryptedKey ? decryptAPIKey(channel.encryptedKey) : ''),
          })),
        }
      },
    },
  ),
)
