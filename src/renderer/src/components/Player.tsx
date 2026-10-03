import { useEffect, useMemo, useRef } from 'react'
import type { LibraryState } from '../../../shared/types'

type Props = {
  library: LibraryState
  videoId: string
  position?: string
  autoNext?: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onEnded: () => void
}

const SKIP_SEC = 5

export default function Player({
  library,
  videoId,
  position,
  autoNext,
  onClose,
  onPrev,
  onNext,
  onEnded
}: Props) {
  const video = useMemo(() => library.videos.find((v) => v.id === videoId), [library.videos, videoId])
  const mediaRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      const el = mediaRef.current
      if (!el) return
      const delta = e.key === 'ArrowLeft' ? -SKIP_SEC : SKIP_SEC
      const next = el.currentTime + delta
      const max = Number.isFinite(el.duration) ? el.duration : Number.POSITIVE_INFINITY
      el.currentTime = Math.min(Math.max(0, next), max)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const skip = (delta: number): void => {
    const el = mediaRef.current
    if (!el) return
    const next = el.currentTime + delta
    const max = Number.isFinite(el.duration) ? el.duration : Number.POSITIVE_INFINITY
    el.currentTime = Math.min(Math.max(0, next), max)
  }

  if (!video) return null

  return (
    <div className="player-back">
      <div className="player-top">
        <span>
          {position ? `${position}  ·  ` : ''}
          {video.name}
        </span>
        <div className="tools">
          {autoNext ? <span className="player-hint">연속 재생</span> : null}
          <button className="btn" onClick={() => skip(-SKIP_SEC)}>
            -5초
          </button>
          <button className="btn" onClick={() => skip(SKIP_SEC)}>
            +5초
          </button>
          <button className="btn" onClick={onPrev}>
            이전
          </button>
          <button className="btn" onClick={onNext}>
            다음
          </button>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
      <div className="player-stage">
        <video
          ref={mediaRef}
          key={video.id}
          src={window.api.videoUrl(video.id)}
          controls
          autoPlay
          onEnded={onEnded}
        />
      </div>
    </div>
  )
}
