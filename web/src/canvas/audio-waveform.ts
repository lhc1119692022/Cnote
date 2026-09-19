export function extractAudioWaveform(buffer: Pick<AudioBuffer, 'length' | 'numberOfChannels' | 'getChannelData'>) {
  const count = Math.min(2048, buffer.length)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * buffer.length / count)
    const end = Math.floor((index + 1) * buffer.length / count)
    const stride = Math.max(1, Math.floor((end - start) / 256))
    let energy = 0
    let samples = 0
    for (const channel of channels) {
      for (let position = start; position < end; position += stride) {
        energy += channel[position] ** 2
        samples++
      }
    }
    return samples ? Math.sqrt(energy / samples) : 0
  })
}

export function audioWaveformBars(peaks: number[], width: number) {
  if (!peaks.length) return []
  const count = Math.min(peaks.length, 512, Math.max(1, Math.floor(width / 5)))
  const maximum = Math.max(...peaks)
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * peaks.length / count)
    const end = Math.floor((index + 1) * peaks.length / count)
    let energy = 0
    for (let position = start; position < end; position++) energy += peaks[position] ** 2
    return maximum > 0 ? Math.sqrt(energy / (end - start)) / maximum : 0
  })
}
