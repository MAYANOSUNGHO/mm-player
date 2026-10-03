export type CaptureResult = {
  dataUrl: string
  duration: number
  width: number
  height: number
}

export function captureThumbnail(src: string): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = src

    const fail = (): void => {
      cleanup()
      reject(new Error('thumbnail failed'))
    }

    const timer = window.setTimeout(fail, 12000)

    const cleanup = (): void => {
      window.clearTimeout(timer)
      video.onloadedmetadata = null
      video.onseeked = null
      video.onerror = null
      video.pause()
      video.removeAttribute('src')
      video.load()
    }

    video.onerror = fail
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const seek = duration > 0 ? Math.min(Math.max(duration * 0.08, 0.4), 10) : 0.4
      try {
        video.currentTime = seek
      } catch {
        fail()
      }
    }
    video.onseeked = () => {
      try {
        const width = video.videoWidth || 16
        const height = video.videoHeight || 9
        const w = 480
        const h = Math.max(1, Math.round((height / width) * w))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no canvas')
        ctx.drawImage(video, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
        const duration = Number.isFinite(video.duration) ? video.duration : 0
        cleanup()
        resolve({ dataUrl, duration, width, height })
      } catch {
        fail()
      }
    }
  })
}
