import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownUp, ExternalLink, RefreshCw, Star, Trash2, Play } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { askConfirmation, showMessage } from '@/lib/app-dialog'
import { loadLocalResourceBlob } from '@/lib/resource-storage'
import { galleryFavorites, loadGallery, permanentlyDeleteResource, resourceImpact, setGalleryFavorite, removeResourceFromFlow } from '@/storage/resource-library'
import type { GalleryEntry } from '@/storage/gallery-index'
import storage from '@/lib/localforage-storage'
import { thumbnailKey } from '@/storage/resource-policy'

let activePreviews = 0
const previewQueue: (() => void)[] = []
async function thumbnail(entry: GalleryEntry, cancelled: () => boolean): Promise<Blob | null> {
  if (activePreviews >= 2) await new Promise<void>(resolve => previewQueue.push(resolve))
  else activePreviews++
  try { return cancelled() ? null : await buildThumbnail(entry) }
  finally {
    const next = previewQueue.shift()
    if (next) next(); else activePreviews--
  }
}
async function buildThumbnail(entry: GalleryEntry): Promise<Blob | null> {
  const key = await thumbnailKey(entry.identity)
  const cached = await storage.getItem<string>(key)
  if (cached) return (await fetch(cached)).blob()
  if (!entry.identity.startsWith('sha256-')) return null
  const blob = await loadLocalResourceBlob(entry.identity)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  const media = entry.kind === 'image' ? new Image() : document.createElement('video')
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { dispose(); reject(new Error('预览超时')) }, 15000)
      const dispose = () => { clearTimeout(timer); media.onload = null; media.onloadeddata = null; media.onerror = null }
      const ready = () => { dispose(); resolve() }
      media.onerror = () => { dispose(); reject(new Error('预览不可用')) }
      if (media instanceof HTMLVideoElement) { media.preload = 'auto'; media.muted = true; media.onloadeddata = ready }
      else media.onload = ready
      media.src = url
    })
    const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
    const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
    if (!width || !height) return null
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 360 / width, 260 / height)
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    canvas.getContext('2d')!.drawImage(media, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', 0.8)
    await storage.setItem(key, data)
    return (await fetch(data)).blob()
  } finally { media.removeAttribute('src'); if (media instanceof HTMLVideoElement) media.load(); URL.revokeObjectURL(url) }
}
function Preview({ entry }: { entry: GalleryEntry }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const [playback, setPlayback] = useState('')
  useEffect(() => () => { if (playback.startsWith('blob:')) URL.revokeObjectURL(playback) }, [playback])
  const play = async () => {
    try {
      if (entry.identity.startsWith('sha256-')) {
        const blob = await loadLocalResourceBlob(entry.identity)
        if (blob) setPlayback(URL.createObjectURL(blob)); else setFailed(true)
      } else if (/^https?:/.test(entry.identity)) setPlayback(entry.identity)
    } catch { setFailed(true) }
  }
  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    const observer = new IntersectionObserver(items => {
      if (!items.some(item => item.isIntersecting)) return
      observer.disconnect()
      void thumbnail(entry, () => cancelled).then(blob => {
        if (cancelled) return
        if (blob) { objectUrl = URL.createObjectURL(blob); setSrc(objectUrl) }
        else if (/^https?:/.test(entry.identity)) setSrc(entry.identity)
        else setFailed(true)
      }).catch(() => { if (!cancelled) setFailed(true) })
    }, { rootMargin: '200px' })
    if (ref.current) observer.observe(ref.current)
    return () => { cancelled = true; observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [entry])
  return <div ref={ref} className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/40">
    {playback ? <video src={playback} controls autoPlay className="h-full w-full object-contain" /> : src && !failed ? entry.kind === 'video' && !src.startsWith('blob:') ? <video src={src} preload="metadata" controls className="h-full w-full object-contain" /> : <img src={src} alt={entry.title} loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(true)} /> : <span className="text-xs text-muted-foreground">{failed ? '预览不可用' : '加载预览…'}</span>}
    {entry.kind === 'video' && !playback && <button className="absolute flex h-10 w-10 items-center justify-center rounded-full bg-card/90 shadow" aria-label="播放视频" title="播放视频" onClick={() => void play()}><Play className="h-5 w-5" /></button>}
  </div>
}
export function Gallery() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<GalleryEntry[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [kind, setKind] = useState<'image' | 'video'>('image')
  const [ascending, setAscending] = useState(false)
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setBusy(true); setError('')
    try { const [items, starred] = await Promise.all([loadGallery(), galleryFavorites()]); setEntries(items); setFavorites(starred) }
    catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const filtered = entries.filter(entry => entry.kind === kind && (!onlyFavorites || favorites.includes(entry.id))).sort((first, second) => (ascending ? 1 : -1) * (first.createdAt - second.createdAt) || first.id.localeCompare(second.id))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 24) - 1))
  const remove = async (entry: GalleryEntry) => {
    setBusy(true)
    try {
      const impact = await resourceImpact(entry.identity)
      const flows = impact.flows.map(flow => flow.name + '（' + flow.nodes + ' 个使用节点）').join('、')
      if (!await askConfirmation('彻底删除这份资源？涉及 ' + flows + '；资料库 ' + impact.sources + ' 项、模板 ' + impact.templates + ' 项。将移除所有使用位置，批次中的其他结果保留，并从撤销记录中移除这份资源。不可撤销；外部原文件和远端服务文件不会删除。')) return
      await permanentlyDeleteResource(entry.identity)
      await refresh()
    } catch (failure) { showMessage(String(failure)) }
    finally { setBusy(false) }
  }
  return <AppShell><div className="flex h-full min-h-0 flex-col">
    <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <h1 className="mr-auto text-lg font-semibold">画廊</h1>
      <div className="flex items-center gap-2">
        {(['image', 'video'] as const).map(value => <Button key={value} size="sm" variant={kind === value ? 'secondary' : 'ghost'} aria-pressed={kind === value} onClick={() => { setKind(value); setPage(0) }}>{value === 'image' ? '图片' : '视频'}</Button>)}
        <Button variant="ghost" size="icon-sm" title="只看收藏" aria-label="只看收藏" aria-pressed={onlyFavorites} onClick={() => { setOnlyFavorites(!onlyFavorites); setPage(0) }}><Star className={'h-4 w-4 ' + (onlyFavorites ? 'fill-current' : '')} /></Button>
        <Button variant="ghost" size="icon-sm" title={ascending ? '最早优先' : '最新优先'} aria-label={ascending ? '最早优先' : '最新优先'} onClick={() => { setAscending(!ascending); setPage(0) }}><ArrowDownUp className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" disabled={busy} title="刷新" aria-label="刷新" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" /></Button>
      </div>
    </header>
    <main className="min-h-0 flex-1 overflow-auto p-6">
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
      {!filtered.length && <p className="py-16 text-center text-sm text-muted-foreground">{busy ? '正在读取生成结果…' : '暂无生成结果'}</p>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">{filtered.slice(currentPage * 24, currentPage * 24 + 24).map(entry => <article key={entry.id} className="overflow-hidden rounded-xl border border-border bg-card">
        <Preview entry={entry} />
        <div className="flex items-center gap-1 px-2 py-2">
          <span className="mr-auto truncate text-xs text-muted-foreground" title={entry.title}>{new Date(entry.createdAt).toLocaleString()}</span>
          <details className="relative"><summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full hover:bg-muted" title="使用位置" aria-label="使用位置"><ExternalLink className="h-4 w-4" /></summary><div className="cnote-menu-surface fixed z-50 max-h-60 max-w-72 overflow-auto">{entry.locations.map(location => <div key={location.flowId + location.nodeId}><button className="cnote-menu-item w-full" onClick={() => navigate('/flows/' + location.flowId + '?node=' + encodeURIComponent(location.nodeId) + '&resource=' + location.resourceIndex)}>跳转：{location.flowName}</button><button disabled={busy} className="cnote-menu-item w-full" onClick={() => { void (async () => { if (!await askConfirmation('只从画布“' + location.flowName + '”移除这份资源？其他画布和原文件不受影响。')) return; setBusy(true); try { await removeResourceFromFlow(location.flowId, entry.identity); await refresh() } catch (failure) { showMessage(String(failure)) } finally { setBusy(false) } })() }}>从此画布移除</button></div>)}</div></details>
          <button disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted" title={favorites.includes(entry.id) ? '取消收藏' : '收藏'} aria-label="收藏" aria-pressed={favorites.includes(entry.id)} onClick={() => { void setGalleryFavorite(entry.id, !favorites.includes(entry.id)).then(() => galleryFavorites()).then(setFavorites).catch(failure => showMessage(String(failure))) }}><Star className={'h-4 w-4 ' + (favorites.includes(entry.id) ? 'fill-current' : '')} /></button>
          <button disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="彻底删除资源" aria-label="彻底删除资源" onClick={() => void remove(entry)}><Trash2 className="h-4 w-4" /></button>
        </div>
      </article>)}</div>
    </main>
    <footer className="flex items-center justify-center gap-4 border-t border-border p-3 text-xs text-muted-foreground"><Button variant="ghost" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页</Button><span>{currentPage + 1} / {Math.max(1, Math.ceil(filtered.length / 24))} · {filtered.length} 项</span><Button variant="ghost" disabled={(currentPage + 1) * 24 >= filtered.length} onClick={() => setPage(currentPage + 1)}>下一页</Button></footer>
  </div></AppShell>
}
