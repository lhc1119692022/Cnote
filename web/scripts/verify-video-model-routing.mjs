import assert from 'node:assert/strict'
import { sourceLoader } from './helpers/load-source.mjs'

const load = sourceLoader()
const { identifyVideoModel } = load('lib/generation/video-model-identity.ts')
const { officialMediaProfile } = load('lib/generation/official-media-rules.ts')
const { resolveVideoModelAdapter, resolveKacangModel, resolve808WanModel, videoRequestMode } = load('lib/generation/video-catalog.ts')
const relay = { protocol: 'video-808relay', baseURL: 'https://api.808relay.com' }
const kacang = { protocol: 'video-kacang', baseURL: 'https://newapi.prompt-hubs.com/v1' }
const renamedModels = [
  ['供应商A/Seedance-2.5-720p-新线路', 'seedance', '2.5', 'seedance-2.5'],
  ['foo-seedance v2.5 pro', 'seedance', '2.5', 'seedance-2.5'],
  ['【线路】ＳＤ２－５－７２０Ｐ', 'seedance', '2.5', 'seedance-2.5'],
  ['镜像S-满血2.0-速用', 'seedance', '2.0', 'seedance-2.0'],
  ['private/high-seedance-2.0-fast-720p', 'seedance', '2.0', 'seedance-2.0'],
  ['seedance-2.5/sd2-5', 'seedance', '2.5', 'seedance-2.5'],
  ...['S20', 'SD20', 'seedance20', 'S2-720', 'SD2_1080', 'seedance2.720', 'doubao2-1080'].map(id => [id, 'seedance', '2.0', 'seedance-2.0']),
  ...['S25', 'SD25', 'doubao2.5', 'Doubao-2-5', 'sd25-1080', 'S25-720', 'SD2-5-720', 'doubao2.5-1080'].map(id => [id, 'seedance', '2.5', 'seedance-2.5']),
  ['newbrand:Wan3.0-fast', 'wan', '3.0', 'wan-3'],
  ['线路/万相3.0-1080p', 'wan', '3.0', 'wan-3'],
  ['provider/MiniMax-H3-Max', 'minimax-h3', '3.0', 'minimax-h3'],
  ['H3-四步采样版-线路七', 'minimax-h3', '3.0', 'minimax-h3'],
  ['第三方/grok-imagine-video-1.5-高速', 'grok-video', '1.5', undefined],
]
for (const [id, family, version, profileId] of renamedModels) {
  assert.deepEqual(identifyVideoModel(id), { family, version }, id)
  assert.equal(officialMediaProfile(id)?.id, profileId, id)
  if (family === 'seedance') {
    const relayAdapter = resolveVideoModelAdapter(relay, id)
    const kacangAdapter = resolveVideoModelAdapter(kacang, id)
    assert.equal(relayAdapter.modeStrategy, 'explicit-seedance')
    assert.equal(kacangAdapter.modeStrategy, 'media-fields', 'Kacang has an explicit family adapter, not a skipped branch')
    assert.equal(relayAdapter.requestContract.durationField, 'seconds')
    assert.equal(kacangAdapter.requestContract.durationField, 'duration_seconds')
    assert.equal(kacangAdapter.requestContract.imageReferencesField, 'reference_images')
    assert.equal(resolveKacangModel(kacang, id).id, id, 'do not rewrite the real API model ID')
    const config = { capability: 'reference-to-video', references: [{ type: 'image', role: 'reference_image' }] }
    assert.equal(videoRequestMode(relay, id, config), 'reference-to-video')
    assert.equal(videoRequestMode(kacang, id, config), undefined)
  }
}
for (const id of ['seedance-2.0/sd2-5', 'seedance-2.5-Wan3.0', 'H3-Seedance2.5', 'opaque-model', 'csd2-5', 'seedance2.5custom', 'seedance2.5.1', '即梦2.5', '豆包2.5', '字节2.5', 'Jimeng2.5', 'JM2.5', 'DB2.5', 'Seed2.5', '满血2.5', '933', '2.5', 's2p5', 'sd2p5', 'S-720', 'SD1080', 'doubao-1080', 'S25-S20', 'doubao2.5-seedance2.0']) {
  assert.equal(identifyVideoModel(id), undefined, `ambiguous or missing model features must not be guessed: ${id}`)
  assert.equal(resolveVideoModelAdapter(relay, id), undefined)
  assert.equal(resolveVideoModelAdapter(kacang, id), undefined)
}
for (const id of ['S250', 'sd2.50', 'S-2.6', 'wan3.1', 'H30', 'grok-imagine-video-2.0']) {
  assert.equal(officialMediaProfile(id), undefined)
  assert.equal(resolveVideoModelAdapter(relay, id), undefined, 'unsupported versions cannot inherit another version')
  assert.equal(resolveVideoModelAdapter(kacang, id), undefined)
}
assert.equal(resolve808WanModel(relay, '线路/万相3.0-1080p').videoRequestContract.imageReferencesField, 'image_urls')
assert.equal(resolveVideoModelAdapter(kacang, '线路/万相3.0-1080p'), undefined)
assert.equal(resolveVideoModelAdapter(relay, 'H3-四步采样版-线路七'), undefined)
assert.equal(resolveVideoModelAdapter(kacang, 'H3-四步采样版-线路七').requestContract.videoReferencesField, 'reference_videos')
assert.equal(resolveVideoModelAdapter(kacang, '新渠道/doubao_seedance_2_5-极速').requestContract.firstFrameField, 'start_frame')
assert.equal(resolveVideoModelAdapter(kacang, '新渠道/doubao_seedance_2_5-极速').requestContract.requiresFramePair, true)
assert.equal(resolveVideoModelAdapter(kacang, 'S-2.5-任意新名字').requestContract.firstFrameField, undefined, 'a renamed S alias must not borrow the Doubao frame protocol')
const decoratedMini = resolveKacangModel(kacang, '新渠道/S-2.0mini-线路三-镜像')
const legacyFaceModel = resolveKacangModel(kacang, 'S-2.5-301010-内置过脸')
const publicFaceModel = resolveKacangModel(kacang, 'S-2.5-301010-25 秒-线路三')
assert.equal(officialMediaProfile(legacyFaceModel.id)?.id, 'seedance-2.5')
assert.equal(legacyFaceModel.mediaRulesSource, 'custom')
for (const id of ['minimax_h3', 'MiniMax-H3-漫剧优化', 'MiniMax-H3-四步采样版', '供应商/H3-新线路']) {
  const h3 = resolveKacangModel(kacang, id)
  assert.equal(h3.audioGeneration, 'prompt')
  assert.equal(h3.videoRequestContract.generateAudioField, undefined, 'prompt-driven audio must not invent a wire switch')
}
for (const id of ['doubao-seedance-2.0', 'doubao-seedance-2.5']) {
  const range = resolveKacangModel(kacang, id)
  assert.equal(range.allowedDurations, undefined, 'continuous ranges use the numeric duration control')
  assert.equal(range.minDuration, 4)
  assert.equal(range.maxDuration, id.endsWith('2.5') ? 30 : 15)
}
assert.deepEqual(resolveKacangModel(kacang, 'S-2.0-933-线路六').allowedDurations, [15], 'fixed duration constraints are preserved')
assert.deepEqual(legacyFaceModel.inputTypes, ['image', 'video', 'audio'])
assert.equal(legacyFaceModel.maxImages, 30)
assert.equal(legacyFaceModel.maxVideos, 10)
assert.equal(legacyFaceModel.maxAudios, 10)
assert.equal(legacyFaceModel.minDuration, 4)
assert.equal(legacyFaceModel.maxDuration, 30)
assert.deepEqual(legacyFaceModel.resolutions, ['720p'])
assert.deepEqual(legacyFaceModel.aspectRatios, ['16:9', '9:16'])
assert.deepEqual(legacyFaceModel.videoRequestContract.referenceLimits, { image: 30, video: 10, audio: 10 })
assert.equal(legacyFaceModel.videoRequestContract.videoReferencesField, 'reference_videos')
assert.equal(legacyFaceModel.videoRequestContract.maxReferenceCount, 40)
assert.equal(legacyFaceModel.videoRequestContract.imageReferencesField, 'reference_images')
assert.equal(legacyFaceModel.videoRequestContract.audioReferencesField, 'reference_audios')
assert.equal(legacyFaceModel.videoRequestContract.durationField, 'duration_seconds')
assert.deepEqual(publicFaceModel.inputTypes, ['image', 'audio'])
assert.equal(publicFaceModel.maxImages, 30)
assert.equal(publicFaceModel.maxVideos, undefined)
assert.equal(publicFaceModel.maxAudios, 10)
assert.equal(publicFaceModel.minDuration, 4)
assert.equal(publicFaceModel.maxDuration, 25)
assert.deepEqual(publicFaceModel.resolutions, ['720p'])
assert.deepEqual(publicFaceModel.aspectRatios, ['16:9', '4:3', '9:16', '3:4', '1:1'])
assert.equal(publicFaceModel.videoRequestContract.videoReferencesField, undefined)
assert.equal(publicFaceModel.videoRequestContract.maxReferenceCount, undefined)
assert.equal(publicFaceModel.mediaRulesSource, 'custom')
assert.equal(decoratedMini.id, '新渠道/S-2.0mini-线路三-镜像')
assert.equal(decoratedMini.videoRequestContract.referenceLimits.video, 0)
assert.equal(decoratedMini.videoRequestContract.maxDurationByResolution['720p'], 12)
assert.equal(resolveKacangModel(kacang, '新渠道/S-2.5-九图-线路三-镜像').videoRequestContract.referenceLimits.image, 9)
assert.equal(resolveVideoModelAdapter({ ...relay, protocol: 'video-kacang', presetId: 'video-808relay' }, 'sd2-5').channel, 'kacang')
assert.equal(resolveVideoModelAdapter({ ...kacang, protocol: 'video-api', presetId: 'video-808relay' }, 'sd2-5').channel, '808relay')
assert.equal(resolveVideoModelAdapter({ ...relay, protocol: 'video-api', presetId: 'video-kacang' }, 'sd2-5').channel, 'kacang')
assert.equal(resolveVideoModelAdapter({ ...relay, protocol: 'video-api' }, 'sd2-5').channel, '808relay')
assert.equal(resolveVideoModelAdapter({ ...kacang, protocol: 'video-api' }, 'sd2-5').channel, 'kacang')
assert.equal(resolveVideoModelAdapter({ protocol: 'video-api', baseURL: 'https://api.808relay.com.other.test' }, 'sd2-5'), undefined)
console.log('Video family/version recognition, renamed IDs, channel-specific adapters, constraints and ambiguity guards: PASS')
