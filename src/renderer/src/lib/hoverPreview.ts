type PreviewHandlers = {
  onShow: () => void
  onFrame: (time: number) => void
  onFail: () => void
}

const STEPS = 10
const HOLD_MS = 1000

function sceneAt(duration: number, index: number): number {
  const t = (duration * ((index % STEPS) + 1)) / STEPS
  return Math.min(Math.max(0.05, t), Math.max(0, duration - 0.12))
}

function waitEvent(el: HTMLMediaElement, event: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean): void => {
      window.clearTimeout(timer)
      el.removeEventListener(event, onOk)
      el.removeEventListener('error', onErr)
      resolve(ok)
    }
    const onOk = (): void => finish(true)
    const onErr = (): void => finish(false)
    const timer = window.setTimeout(() => finish(false), ms)
    el.addEventListener(event, onOk)
    el.addEventListener('error', onErr)
  })
}

export function startHoverPreview(
  video: HTMLVideoElement,
  src: string,
  hintDuration: number | null,
  handlers: PreviewHandlers
): () => void {
  let stopped = false
  let holdTimer: number | null = null
  let step = 0

  const stopHold = (): void => {
    if (holdTimer != null) {
      window.clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  const hold = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      stopHold()
      holdTimer = window.setTimeout(resolve, ms)
    })

  const durationOf = (): number => {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
    if (hintDuration && hintDuration > 0) return hintDuration
    return 0
  }

  const onTime = (): void => {
    if (!stopped) handlers.onFrame(video.currentTime)
  }

  const seekTo = async (target: number): Promise<void> => {
    if (Math.abs(video.currentTime - target) < 0.08) return
    const pending = waitEvent(video, 'seeked', 5000)
    try {
      video.currentTime = target
    } catch {
      return
    }
    await pending
  }

  const playMuted = async (): Promise<boolean> => {
    video.muted = true
    video.defaultMuted = true
    video.volume = 0
    try {
      await video.play()
      return true
    } catch {
      return false
    }
  }

  const run = async (): Promise<void> => {
    video.muted = true
    video.defaultMuted = true
    video.volume = 0
    video.playsInline = true
    video.preload = 'auto'
    video.disableRemotePlayback = true

    const meta = video.readyState >= 1 ? Promise.resolve(true) : waitEvent(video, 'loadedmetadata', 12000)
    video.src = src
    const loaded = await meta
    if (stopped) return
    if (!loaded && durationOf() <= 0) {
      handlers.onFail()
      return
    }

    video.addEventListener('timeupdate', onTime)

    const duration = durationOf()
    if (duration > 1) {
      await seekTo(sceneAt(duration, step))
      step += 1
    }
    if (stopped) return

    if (!(await playMuted())) {
      if (!stopped) handlers.onFail()
      return
    }
    if (stopped) return

    handlers.onShow()
    handlers.onFrame(video.currentTime)

    while (!stopped) {
      await hold(HOLD_MS)
      if (stopped) return
      const nextDuration = durationOf()
      if (nextDuration <= 1) continue
      video.pause()
      await seekTo(sceneAt(nextDuration, step))
      step += 1
      if (stopped) return
      if (!(await playMuted())) {
        if (!stopped) handlers.onFail()
        return
      }
      handlers.onFrame(video.currentTime)
    }
  }

  void run().catch(() => {
    if (!stopped) handlers.onFail()
  })

  return () => {
    stopped = true
    stopHold()
    video.removeEventListener('timeupdate', onTime)
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
}
