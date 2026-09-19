import { inspectMediaBlob, prepareOfficialMediaInput } from '../../src/lib/generation/media-inspection'
import type { GenerationReference } from '../../src/types/flow'
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from 'mediabunny'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function png(width: number, height: number, noise = false) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')!
  if (noise) {
    const image = context.createImageData(width, height)
    let seed = 918273
    for (let index = 0; index < image.data.length; index += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0
      image.data[index] = seed & 255
      image.data[index + 1] = (seed >>> 8) & 255
      image.data[index + 2] = (seed >>> 16) & 255
      image.data[index + 3] = 255
    }
    context.putImageData(image, 0, 0)
  } else {
    context.fillStyle = '#265577'
    context.fillRect(0, 0, width, height)
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  canvas.width = 1
  canvas.height = 1
  return blob
}

export function wave(seconds: number) {
  const sampleRate = 8000
  const sampleBytes = sampleRate * seconds * 2
  const bytes = new ArrayBuffer(44 + sampleBytes)
  const view = new DataView(bytes)
  const text = (offset: number, value: string) => Array.from(value).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + sampleBytes, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, sampleBytes, true)
  for (let sample = 0; sample < sampleBytes / 2; sample++) view.setInt16(44 + sample * 2, Math.sin(sample / sampleRate * 440 * Math.PI * 2) * (0.15 + 0.65 * Math.abs(Math.sin(sample / sampleRate * 3))) * 32767, true)
  return new Blob([bytes], { type: 'audio/wav' })
}

async function mp4() {
  const canvas = new OffscreenCanvas(1280, 720)
  const context = canvas.getContext('2d')!
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 1_000_000 })
  output.addVideoTrack(source)
  await output.start()
  for (let frame = 0; frame < 48; frame++) {
    context.fillStyle = `rgb(${frame * 5},80,120)`
    context.fillRect(0, 0, 1280, 720)
    await source.add(frame / 24, 1 / 24)
  }
  await output.finalize()
  return new Blob([output.target.buffer!], { type: 'video/mp4' })
}

export async function runMediaRuntimeCases() {
  const reference: GenerationReference = { id: 'runtime', type: 'image', fileName: 'runtime.png', source: 'local', order: 0 }
  const small = await png(1024, 1024)
  const meta = await inspectMediaBlob(small, 'image')
  assert(meta.format === 'png' && meta.width === 1024 && meta.height === 1024, 'Actual PNG inspection failed')
  const unchanged = await prepareOfficialMediaInput({ modelId: 'wan-3', reference, blob: small, adaptImages: true })
  assert(!unchanged.adapted && unchanged.blob === small && !unchanged.violations.length, 'Compliant image must stay unchanged')
  const renamed = new Blob([small], { type: 'image/jpeg' })
  assert((await inspectMediaBlob(renamed, 'image')).format === 'png', 'Inspection trusted declared MIME instead of bytes')
  const large = await png(2600, 2600, true)
  assert(large.size > 20_000_000, 'Noise fixture must exceed the Wan limit')
  const strict = await prepareOfficialMediaInput({ modelId: 'wan-3', reference, blob: large, adaptImages: false })
  assert(strict.violations.some((item) => item.code === 'bytes') && !strict.adapted, 'Disabled adaptation must reject oversized PNG')
  let ticks = 0
  const timer = setInterval(() => ticks++, 10)
  const start = performance.now()
  const adapted = await prepareOfficialMediaInput({ modelId: 'wan-3', reference, blob: large, adaptImages: true })
  const elapsed = performance.now() - start
  clearInterval(timer)
  assert(adapted.adapted && adapted.blob?.type === 'image/webp' && !adapted.violations.length, `WebP adaptation failed: ${JSON.stringify(adapted.violations)}`)
  assert(adapted.metadata?.width === 2600 && adapted.metadata?.height === 2600, 'Byte-only adaptation changed dimensions')
  assert(ticks > 0, 'Worker blocked renderer event loop')
  const unfixable = await prepareOfficialMediaInput({ modelId: 'wan-3', reference, blob: await png(3000, 3000, true), adaptImages: true })
  assert(unfixable.adapted && unfixable.violations.some((item) => item.code === 'bytes') && unfixable.metadata?.width === 3000, 'Unfixable file must fail without lowering quality or dimensions')
  const wide = await png(8200, 1200)
  const resized = await prepareOfficialMediaInput({ modelId: 'wan-3', reference, blob: wide, adaptImages: true })
  assert(resized.adapted && resized.metadata?.width === 8000, `Dimension adaptation failed: ${JSON.stringify(resized.violations)}`)
  const wrongRatio = await png(3000, 300)
  const rejected = await prepareOfficialMediaInput({ modelId: 'seedance-2.0', reference, blob: wrongRatio, adaptImages: true })
  assert(!rejected.adapted && rejected.violations.some((item) => item.code === 'ratio'), 'Ratio mismatch must not be cropped or padded')
  const invalid = await prepareOfficialMediaInput({ modelId: 'wan-3', reference, blob: new Blob(['broken'], { type: 'image/png' }), adaptImages: true })
  assert(invalid.violations.some((item) => item.code === 'unverifiable'), 'Corrupt image must not pass')
  const audio = await inspectMediaBlob(wave(2), 'audio')
  assert(audio.format === 'wav' && Math.abs(audio.duration! - 2) < 0.001, `WAV metadata failed: ${JSON.stringify(audio)}`)
  const videoBlob = await mp4()
  const video = await inspectMediaBlob(videoBlob, 'video')
  assert(video.format === 'mp4' && video.videoCodec === 'h264' && video.width === 1280 && video.height === 720 && Math.abs(video.fps! - 24) < 0.001, `MP4 inspection failed: ${JSON.stringify(video)}`)
  const checkedVideo = await prepareOfficialMediaInput({ modelId: 'seedance-2.0', reference: { ...reference, type: 'video' }, blob: videoBlob, adaptImages: true })
  assert(!checkedVideo.adapted && !checkedVideo.violations.length, `MP4 validation failed: ${JSON.stringify(checkedVideo.violations)}`)
  const controller = new AbortController()
  controller.abort()
  let cancelled = false
  try { await inspectMediaBlob(small, 'image', controller.signal) } catch (error) { cancelled = error instanceof DOMException && error.name === 'AbortError' }
  assert(cancelled, 'Cancelled operation did not abort')
  const runningController = new AbortController()
  const cancelledWork = prepareOfficialMediaInput({ modelId: 'wan-3', reference, blob: large, adaptImages: true, signal: runningController.signal })
  const cancelTimer = setTimeout(() => runningController.abort(), 20)
  let cancelledWhileRunning = false
  try { await cancelledWork } catch (error) { cancelledWhileRunning = error instanceof DOMException && error.name === 'AbortError' }
  clearTimeout(cancelTimer)
  assert(cancelledWhileRunning, 'In-flight worker was not cancelled')
  assert((await inspectMediaBlob(wave(3), 'audio')).duration === 3, 'Cancellation blocked the next queued inspection')
  return { passed: true, originalBytes: large.size, compatibleBytes: adapted.blob!.size, adaptationMs: Math.round(elapsed), rendererTicks: ticks, wavDuration: audio.duration, video }
}
