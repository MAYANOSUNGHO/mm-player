import React, { useEffect, useRef, useState } from 'react'
import type { LibraryState, VideoRecord } from '../../../shared/types'
import { captureThumbnail } from '../lib/capture'
import { startHoverPreview } from '../lib/hoverPreview'
import { formatDuration, formatSize } from '../lib/format'

type Props = {
  library: LibraryState
  videos: VideoRecord[]
  selected: Set<string>
  density: 's' | 'm' | 'l'
  emptyText?: string
  thumbEpoch?: number
  onSelect: (e: React.MouseEvent, id: string, index: number) => void
  onOpen: (id: string) => void
  onContext: (e: React.MouseEvent, id: string) => void
  onMeta: (state: LibraryState) => void
  onChangeSelection?: (ids: Set<string>) => void
  onMarqueeDone?: () => void
}

const WIDTH = { s: '148px', m: '200px', l: '268px' }

export function forgetThumbFailures(ids: string[]): void {
  for (const id of ids) failed.delete(id)
}

export default function VideoGrid({
  library,
  videos,
  selected,
  density,
  emptyText,
  thumbEpoch = 0,
  onSelect,
  onOpen,
  onContext,
  onMeta,
  onChangeSelection,
  onMarqueeDone
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [band, setBand] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const startMarquee = (e: React.MouseEvent): void => {
    if (e.button !== 0 || !onChangeSelection) return
    const target = e.target as HTMLElement
    if (target.closest('button, input, a')) return
    if (target.closest('.card') && !e.shiftKey) return
    const sx = e.clientX
    const sy = e.clientY
    const additive = e.shiftKey
    const base = new Set(selected)
    let moved = false
    const onMove = (ev: MouseEvent): void => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
      moved = true
      const left = Math.min(sx, ev.clientX)
      const top = Math.min(sy, ev.clientY)
      const right = Math.max(sx, ev.clientX)
      const bottom = Math.max(sy, ev.clientY)
      setBand({ left, top, width: right - left, height: bottom - top })
      const hits: string[] = []
      rootRef.current?.querySelectorAll<HTMLElement>('.card[data-id]').forEach((el) => {
        const rect = el.getBoundingClientRect()
        if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) {
          if (el.dataset.id) hits.push(el.dataset.id)
        }
      })
      const next = additive ? new Set(base) : new Set<string>()
      for (const id of hits) next.add(id)
      onChangeSelection(next)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setBand(null)
      if (!moved) return
      onMarqueeDone?.()
      const stopClick = (ev: MouseEvent): void => {
        ev.preventDefault()
        ev.stopPropagation()
        window.removeEventListener('click', stopClick, true)
      }
      window.addEventListener('click', stopClick, true)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (!videos.length) {
    return (
      <div className="empty">
        <div className="empty-card">
          <div className="kicker">Empty</div>
          <h2>표시할 영상이 없습니다.</h2>
          <p>{emptyText ?? '다른 폴더나 태그를 고르거나, 검색어를 바꿔 보세요.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid-wrap" ref={rootRef} onMouseDown={startMarquee}>
      <div className="grid" style={{ ['--card-w' as string]: WIDTH[density] }}>
        {videos.map((video, index) => (
          <VideoCard
            key={video.id}
            video={video}
            tags={library.tags.filter((t) => video.tagIds.includes(t.id)).map((t) => t.name)}
            selected={selected.has(video.id)}
            selectedIds={selected}
            index={index}
            thumbEpoch={thumbEpoch}
            onSelect={onSelect}
            onOpen={onOpen}
            onContext={onContext}
            onMeta={onMeta}
          />
        ))}
      </div>
      {band ? <div className="marquee" style={band} /> : null}
    </div>
  )
}

function VideoCard({
  video,
  tags,
  selected,
  selectedIds,
  index,
  thumbEpoch,
  onSelect,
  onOpen,
  onContext,
  onMeta
}: {
  video: VideoRecord
  tags: string[]
  selected: boolean
  selectedIds: Set<string>
  index: number
  thumbEpoch: number
  onSelect: (e: React.MouseEvent, id: string, index: number) => void
  onOpen: (id: string) => void
  onContext: (e: React.MouseEvent, id: string) => void
  onMeta: (state: LibraryState) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const hoverTimer = useRef<number | null>(null)
  const stopHover = useRef<(() => void) | null>(null)
  const [visible, setVisible] = useState(false)
  const [thumb, setThumb] = useState<string | null>(null)
  const [previewOn, setPreviewOn] = useState(false)
  const [previewTime, setPreviewTime] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true)
      },
      { rootMargin: '240px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!video.hasThumb) {
      setThumb(null)
      return
    }
    let cancelled = false
    void window.api.thumbUrl(video.id).then((url) => {
      if (!cancelled && url) setThumb(url)
    })
    return () => {
      cancelled = true
    }
  }, [video.hasThumb, video.id])

  useEffect(() => {
    if (!visible || thumb || video.missing || failed.has(video.id)) return
    let cancelled = false
    const run = async (): Promise<void> => {
      await acquire()
      try {
        if (cancelled) return
        const existing = await window.api.thumbUrl(video.id)
        if (existing) {
          if (!cancelled) setThumb(existing)
          return
        }
        if (window.api.captureThumb) {
          const cap = await window.api.captureThumb(video.id)
          if (cancelled) return
          if (cap) {
            setThumb(cap.url)
            if (cap.duration != null || cap.width != null || cap.height != null) {
              onMeta(
                await window.api.setMeta(video.id, {
                  duration: cap.duration,
                  width: cap.width,
                  height: cap.height
                })
              )
            }
          }
          return
        }
        const cap = await captureThumbnail(window.api.videoUrl(video.id))
        if (cancelled) return
        const url = await window.api.saveThumb(video.id, cap.dataUrl)
        const next = await window.api.setMeta(video.id, {
          duration: cap.duration,
          width: cap.width,
          height: cap.height
        })
        if (!cancelled) {
          setThumb(url)
          onMeta(next)
        }
      } catch {
        failed.add(video.id)
      } finally {
        release()
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [visible, thumb, video.id, video.missing, video.hasThumb, onMeta, thumbEpoch])

  const stopPreview = (): void => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    stopHover.current?.()
    stopHover.current = null
    setPreviewOn(false)
    setPreviewTime(null)
  }

  useEffect(() => () => stopPreview(), [])

  return (
    <div
      ref={ref}
      data-id={video.id}
      className={`card ${selected ? 'selected' : ''} ${video.missing ? 'is-missing' : ''}`}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        if (e.shiftKey) {
          e.preventDefault()
          return
        }
        stopPreview()
        const ids = selectedIds.has(video.id) ? [...selectedIds] : [video.id]
        e.dataTransfer.setData('application/x-video-ids', JSON.stringify(ids))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(e) => {
        if (video.missing && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          onOpen(video.id)
          return
        }
        onSelect(e, video.id, index)
      }}
      onDoubleClick={() => onOpen(video.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContext(e, video.id)
      }}
      title={video.path}
    >
      <div
        className="thumb"
        onMouseEnter={() => {
          if (video.missing) return
          if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
          hoverTimer.current = window.setTimeout(() => {
            const el = previewRef.current
            if (!el) return
            stopHover.current?.()
            setPreviewOn(true)
            stopHover.current = startHoverPreview(el, window.api.videoUrl(video.id), video.duration, {
              onShow: () => setPreviewOn(true),
              onFrame: (time) => {
                setPreviewOn(true)
                setPreviewTime(time)
              },
              onFail: () => {
                stopHover.current = null
                setPreviewOn(false)
                setPreviewTime(null)
              }
            })
          }, 160)
        }}
        onMouseLeave={stopPreview}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            draggable={false}
            onError={() => {
              failed.add(video.id)
              setThumb(null)
            }}
          />
        ) : null}
        <video ref={previewRef} className={`thumb-preview ${previewOn ? 'on' : ''}`} muted playsInline preload="none" />
        {video.duration || previewTime != null ? (
          <span className="badge">{formatDuration(previewTime ?? video.duration)}</span>
        ) : null}
        {video.missing ? <span className="missing" title="경로를 다시 지정하려면 클릭">×</span> : null}
      </div>
      <div className="card-title">{video.name}</div>
      <div className="card-meta">
        <span>{formatSize(video.size)}</span>
        {tags.slice(0, 3).map((tag) => (
          <span key={tag} className="pill">
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}

const failed = new Set<string>()
let active = 0
const waiters: Array<() => void> = []

function acquire(): Promise<void> {
  if (active < 2) {
    active += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1
      resolve()
    })
  })
}

function release(): void {
  active = Math.max(0, active - 1)
  const next = waiters.shift()
  if (next) next()
}
