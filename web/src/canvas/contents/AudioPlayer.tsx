import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { desktopFetch } from '@/lib/desktop-fetch'
import { useUiStore } from '@/stores/ui-store'
import { createAudioTrimCopy, trimAudioBlob } from '../audio-trim'
import { audioWaveformBars, extractAudioWaveform } from '../audio-waveform'

import { formatAudioTime as clock, parseAudioTime } from '../audio-trim-layout'

function AudioTimeField({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(clock(value))
  useEffect(() => setDraft(clock(value)), [value])
  const commit = () => {
    const parsed = parseAudioTime(draft)
    if (parsed === null) { setDraft(clock(value)); return }
    const next = Math.max(min, Math.min(max, parsed))
    onChange(next)
    setDraft(clock(next))
  }
  return <input aria-label={label} aria-invalid={parseAudioTime(draft) === null} title="分:秒（例如 03:25）" type="text" value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} className="h-7 w-20 rounded-md border border-border bg-transparent px-2 text-center tabular-nums outline-none focus:border-primary" />
}

export function AudioPlayer({ src, nodeId }: { src: string; nodeId: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  const waveform = useRef<HTMLDivElement>(null)
  const player = useRef<HTMLDivElement>(null)
  const sourceBlob = useRef<Blob | null>(null)
  const generation = useRef<AbortController | null>(null)
  const waveformReady = useRef<string | null>(null)
  const mounted = useRef(true)
  const [width, setWidth] = useState(480)
  const trimming = useUiStore((state) => state.nodeChrome[nodeId]?.audioTrim === true)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [busy, setBusy] = useState(false)
  const [decodeError, setDecodeError] = useState('波形正在准备，请稍候。')
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [peaks, setPeaks] = useState<number[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!waveform.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)))
    observer.observe(waveform.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (!trimming) return
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || player.current?.contains(target)
        || target.closest('[data-node-id]')?.getAttribute('data-node-id') === nodeId
        || target.closest('[data-audio-trim-toolbar]')?.getAttribute('data-audio-trim-toolbar') === nodeId) return
      useUiStore.getState().setNodeChrome(nodeId, { audioTrim: false })
    }
    document.addEventListener('pointerdown', outside, true)
    return () => { document.removeEventListener('pointerdown', outside, true); generation.current?.abort() }
  }, [trimming, nodeId])
  useEffect(() => {
    const controller = new AbortController()
    if (waveformReady.current !== src) {
      waveformReady.current = null
      sourceBlob.current = null
      setPeaks([])
      setTime(0)
      setDuration(0)
      setPlaying(false)
      setError('')
    }
    if (waveformReady.current === src) return
    setDecodeError('波形正在准备，请稍候。')
    let context: AudioContext | undefined
    void (async () => {
      try {
        const response = await desktopFetch(src, { signal: controller.signal })
        if (!response.ok) throw new Error('音频读取失败，无法截取。')
        const blob = await response.blob()
        if (controller.signal.aborted) return
        if (blob.size > 30_000_000) throw new Error('音频超过本地截取的 30 MB 处理上限，仍可正常播放。')
        context = new AudioContext()
        const buffer = await context.decodeAudioData(await blob.arrayBuffer())
        if (controller.signal.aborted) return
        sourceBlob.current = blob
        setDuration(buffer.duration)
        setEnd(buffer.duration)
        setStart(0)
        setPeaks(extractAudioWaveform(buffer))
        waveformReady.current = src
        setDecodeError('')
      } catch (failure) { if (!controller.signal.aborted) setDecodeError(failure instanceof Error ? failure.message : '当前音频无法解码，不能截取。') }
      finally { if (context && context.state !== 'closed') await context.close().catch(() => undefined) }
    })()
    return () => { controller.abort(); sourceBlob.current = null; generation.current?.abort(); if (context && context.state !== 'closed') void context.close().catch(() => undefined) }
  }, [src])
  const bars = useMemo(() => audioWaveformBars(peaks, width), [peaks, width])
  const trimDuration = duration
  const closeTrim = () => useUiStore.getState().setNodeChrome(nodeId, { audioTrim: false })
  const generate = async () => {
    if (!sourceBlob.current || busy) return
    const controller = new AbortController()
    generation.current = controller
    setBusy(true); setError(''); audio.current?.pause()
    try {
      const blob = await trimAudioBlob(sourceBlob.current, start, end, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      await createAudioTrimCopy(nodeId, blob)
      closeTrim()
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '截取失败，原文件未修改。') }
    finally { setBusy(false) }
  }
  const progress = duration > 0 ? time / duration : 0
  return <div ref={player} className="flex h-full min-h-0 flex-1 flex-col gap-3 rounded-xl bg-card p-3 text-foreground" onPointerDown={(event) => event.stopPropagation()}>
    <audio ref={audio} src={src} preload="metadata" onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setError('当前环境无法播放此音频格式，文件仍保留。')} />
    <div className="relative flex min-h-16 flex-1 rounded-xl bg-muted px-2">
    <div ref={waveform} className="relative flex min-w-0 flex-1 items-center">
      <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" className="absolute inset-x-0 top-[12.5%] h-3/4 w-full text-muted-foreground" aria-label={peaks.length ? '音频波形' : '波形暂不可用'}>
        {bars.length ? bars.map((peak, index) => <line key={index} x1={index * 5 + 2} x2={index * 5 + 2} y1={50 - Math.max(1, peak * 46)} y2={50 + Math.max(1, peak * 46)} stroke="currentColor" strokeWidth="2" opacity={index / bars.length <= progress ? 0.85 : 0.35} />) : null}
      </svg>
      {!peaks.length && <span role="status" className="pointer-events-none absolute inset-x-4 text-center text-xs text-muted-foreground">{decodeError || '波形暂不可用，仍可播放。'}</span>}
      <div className="pointer-events-none absolute bottom-2 top-2 w-0.5 bg-rose-500" style={{ left: `${progress * 100}%` }} />
      <input aria-label="音频播放进度" type="range" min="0" max={duration || 1} step="0.01" value={time} disabled={!duration} onChange={(event) => { if (audio.current) { audio.current.currentTime = Number(event.target.value); setTime(Number(event.target.value)) } }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      {trimming && trimDuration > 0 && <>
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-background/75" style={{ width: `${start / trimDuration * 100}%` }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-background/75" style={{ width: `${(1 - end / trimDuration) * 100}%` }} />
        <div className="pointer-events-none absolute inset-y-1 rounded-lg border-[3px] border-primary" style={{ left: `${start / trimDuration * 100}%`, width: `${(end - start) / trimDuration * 100}%` }} />
        {(['start', 'end'] as const).map((boundary) => <button key={boundary} type="button" aria-label={boundary === 'start' ? '拖动截取起点' : '拖动截取终点'} disabled={busy} title={boundary === 'start' ? '拖动截取起点' : '拖动截取终点'} className={`group absolute inset-y-1 z-10 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${boundary === 'start' ? 'rounded-l-md' : 'rounded-r-md'}`} style={{ left: `${(boundary === 'start' ? start : end) / trimDuration * 100}%` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); audio.current?.pause() }} onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !waveform.current) return
          const rect = waveform.current.getBoundingClientRect()
          const value = Math.max(0, Math.min(trimDuration, Math.round((event.clientX - rect.left) / rect.width * trimDuration)))
          setError('')
          if (boundary === 'start') setStart(Math.min(value, end - 0.01)); else setEnd(Math.max(value, start + 0.01))
        }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}><span className="h-4 w-0.5 rounded-full bg-primary-foreground transition-colors group-hover:bg-white group-focus-visible:bg-white" /></button>)}
        <span aria-label="截取时长" className="pointer-events-none absolute z-20 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-xl bg-card px-3 py-1.5 text-sm font-bold tabular-nums text-foreground">{clock(end - start)}</span>
      </>}
    </div>
    </div>
    {trimming && <div className="order-2 flex h-9 shrink-0 items-center gap-2 border-t border-border/60 pt-2 text-xs">
      <button type="button" title="取消截取" aria-label="取消截取" onClick={closeTrim} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
      <span>截取</span>
      <AudioTimeField label="截取开始时间" value={start} min={0} max={Math.max(0, end - 1)} disabled={busy} onChange={(value) => { setStart(value); setError('') }} />
      <span>—</span>
      <AudioTimeField label="截取结束时间" value={end} min={Math.min(trimDuration, start + 1)} max={trimDuration} disabled={busy} onChange={(value) => { setEnd(value); setError('') }} />
      <button type="button" title="生成 WAV 截取副本，保留原音频" disabled={busy || !sourceBlob.current || !!decodeError || end <= start} onClick={() => void generate()} className="ml-auto h-7 rounded-md bg-primary px-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">{busy ? '生成中' : '生成'}</button>
    </div>}
    {trimming && decodeError && <p role="status" className="text-xs text-destructive">{decodeError}</p>}
    <div className="grid h-9 shrink-0 grid-cols-3 items-center text-sm text-muted-foreground">
      <span className="tabular-nums">{clock(time)} / {clock(duration)}</span>
      <button type="button" aria-label={playing ? '暂停音频' : '播放音频'} className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground hover:bg-muted" onClick={() => { if (playing) audio.current?.pause(); else void audio.current?.play().catch(() => setError('无法播放音频，请检查文件格式。')) }}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
    </div>
    {error && <p role="status" className="text-xs text-destructive">{error}</p>}
  </div>
}
