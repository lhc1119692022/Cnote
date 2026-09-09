import assert from 'node:assert/strict'

const models = {
  'seedance-2-mini': { durations: [5, 10], resolutions: ['480p', '720p'], maxImages: 9, maxVideos: 3, maxAudios: 3 },
  'gemini-omni-1.1': { durations: [3, 4, 5, 6, 7, 8, 9, 10], resolutions: ['360p', '720p', '1080p', '4k'], maxImages: 8, maxVideos: 3, maxAudios: 0 },
}

function normalizeResolution(value = '720p') {
  const aliases = { '360': '360p', '640x360': '360p', '480': '480p', '854x480': '480p', '720': '720p', '1280x720': '720p', '1080': '1080p', '1920x1080': '1080p', '4k': '4k', '2160p': '4k' }
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '')
  return aliases[normalized] || normalized
}

function validate(modelId, input) {
  const model = models[modelId]
  assert(model, 'mock model exists')
  assert(Number.isInteger(input.seconds) && input.seconds > 0, 'seconds is a positive integer')
  assert(model.durations.includes(input.seconds), 'duration is supported')
  assert(model.resolutions.includes(normalizeResolution(input.resolution)), 'resolution is supported')
  if (input.lastFrame && !input.firstFrame) throw new Error('尾帧必须同时提供首帧')
  if (input.audioCount && !model.maxAudios) throw new Error('模型不支持参考音频')
  if (input.audioCount && !input.imageCount && !input.videoCount && modelId !== 'seedance-2.5-pro') throw new Error('参考音频需要图片或视频')
  if (input.videoCount && modelId === 'gemini-omni-1.1' && !input.imageCount && !input.firstFrame) throw new Error('Omni 参考视频需要图片或首帧')
  return { ...input, resolution: normalizeResolution(input.resolution) }
}

async function runMock({ create, poll, download }, input) {
  let stage = 'validation'
  let prepared
  try {
    prepared = validate(input.model, input)
    stage = 'creation'
    const created = await create(prepared)
    assert(created.id && created.status === 'queued', 'creation returns queued task')
    stage = 'polling'
    let task = await poll(created.id)
    while (task.status === 'queued' || task.status === 'in_progress') task = await poll(created.id)
    assert.equal(task.status, 'completed')
    stage = 'download'
    const content = await download(created.id)
    assert.equal(content.mimeType, 'video/mp4')
    assert(content.bytes > 0, 'download is non-empty')
    return { stage: 'completed', taskId: created.id, content }
  } catch (error) {
    const wrapped = new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`)
    wrapped.stage = stage
    throw wrapped
  }
}

const calls = []
const result = await runMock({
  create: async (body) => { calls.push(['create', body]); return { id: 'task_mock_1', status: 'queued' } },
  poll: async (id) => { calls.push(['poll', id]); return calls.filter(([kind]) => kind === 'poll').length === 1 ? { id, status: 'in_progress' } : { id, status: 'completed' } },
  download: async (id) => { calls.push(['download', id]); return { mimeType: 'video/mp4', bytes: 128 } },
}, { model: 'seedance-2-mini', prompt: 'mock', seconds: 5, resolution: '1280x720', imageCount: 0, videoCount: 0, audioCount: 0 })
assert.equal(result.stage, 'completed')
assert.deepEqual(calls.map(([kind]) => kind), ['create', 'poll', 'poll', 'download'])
assert.equal(calls[0][1].resolution, '720p')

await assert.rejects(() => runMock({ create: async () => ({ id: 'never', status: 'queued' }), poll: async () => ({ status: 'completed' }), download: async () => ({ mimeType: 'video/mp4', bytes: 1 }) }, { model: 'seedance-2-mini', prompt: 'mock', seconds: 6, resolution: '720p', imageCount: 0, videoCount: 0, audioCount: 0 }), (error) => error.stage === 'validation' && error.message.startsWith('validation:'))
await assert.rejects(() => runMock({ create: async () => { throw new Error('HTTP 400') }, poll: async () => ({ status: 'completed' }), download: async () => ({ mimeType: 'video/mp4', bytes: 1 }) }, { model: 'seedance-2-mini', prompt: 'mock', seconds: 5, resolution: '720p', imageCount: 0, videoCount: 0, audioCount: 0 }), (error) => error.stage === 'creation')
await assert.rejects(() => runMock({ create: async () => ({ id: 'task_mock_2', status: 'queued' }), poll: async () => { throw new Error('HTTP 503') }, download: async () => ({ mimeType: 'video/mp4', bytes: 1 }) }, { model: 'seedance-2-mini', prompt: 'mock', seconds: 5, resolution: '720p', imageCount: 0, videoCount: 0, audioCount: 0 }), (error) => error.stage === 'polling')
await assert.rejects(() => runMock({ create: async () => ({ id: 'task_mock_3', status: 'queued' }), poll: async () => ({ status: 'completed' }), download: async () => { throw new Error('empty content') } }, { model: 'seedance-2-mini', prompt: 'mock', seconds: 5, resolution: '720p', imageCount: 0, videoCount: 0, audioCount: 0 }), (error) => error.stage === 'download')

console.log('video-api mock contract: PASS')
console.log('covered: validation, creation, polling, download, resolution alias, staged errors')
