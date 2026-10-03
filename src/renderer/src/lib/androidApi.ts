import type { DesktopApi } from '../../../shared/api'
import type { ScanProgress } from '../../../shared/types'
import { Capacitor } from '@capacitor/core'
import { MMPlayer } from '../native/mmPlayer'
import { MobileStore } from './mobileStore'

function webSrc(path?: string | null, url?: string | null): string | null {
  if (path) {
    const file = path.startsWith('file:') ? path : `file://${path}`
    return Capacitor.convertFileSrc(file)
  }
  return url ?? null
}

export async function applyAndroidInsets(): Promise<void> {
  try {
    const insets = await MMPlayer.getInsets()
    const top = Number(insets.top)
    const bottom = Number(insets.bottom)
    const status = Number(insets.status)
    const webTop = Number(insets.webTop)
    let padTop = 32
    if (status > 0 && webTop >= status - 1) padTop = 0
    else if (Number.isFinite(top) && top > 0) padTop = Math.ceil(top)
    document.documentElement.style.setProperty('--android-inset-top', `${padTop}px`)
    document.documentElement.style.setProperty(
      '--android-inset-bottom',
      `${Number.isFinite(bottom) ? Math.max(0, Math.ceil(bottom)) : 0}px`
    )
  } catch {
    document.documentElement.style.setProperty('--android-inset-top', '32px')
    document.documentElement.style.setProperty('--android-inset-bottom', '0px')
  }
}

export async function createAndroidApi(): Promise<DesktopApi> {
  const store = new MobileStore()
  await store.load()
  let port = 0
  try {
    const server = await MMPlayer.startServer()
    port = server.port ?? 0
  } catch (err) {
    console.error('startServer', err)
  }
  const mediaBase = `http://127.0.0.1:${port}`

  const snap = (): ReturnType<MobileStore['snapshot']> => store.snapshot()

  return {
    getLibrary: async () => snap(),
    pickFolder: async () => {
      const picked = await MMPlayer.pickFolder()
      if (picked.granted === false) return null
      return picked.uri ?? 'media://all'
    },
    setRootAndScan: async (rootPath: string) => {
      const result = await MMPlayer.scan({ uri: rootPath })
      store.setRoot(rootPath || 'media://all')
      store.applyScan(result.videos)
      await store.flush()
      return snap()
    },
    rescan: async () => {
      const result = await MMPlayer.scan({ uri: store.snapshot().rootPath ?? 'media://all' })
      store.setRoot(store.snapshot().rootPath ?? 'media://all')
      store.applyScan(result.videos)
      await store.flush()
      return snap()
    },
    healMissing: async () => snap(),
    relocateVideo: async () => snap(),
    purgeMissing: async () => store.purgeMissing(),
    clearThumbs: async () => snap(),
    removeVideos: async () => snap(),
    deleteVideoFiles: async () => snap(),
    importVideos: async () => snap(),
    pathForFile: () => '',
    checkUpdate: async () => null,
    installUpdate: async () => undefined,
    createFolder: async (name, parentId) => {
      store.createFolder(name, parentId)
      return snap()
    },
    renameFolder: async (id, name) => {
      store.renameFolder(id, name)
      return snap()
    },
    deleteFolder: async (id) => {
      store.deleteFolder(id)
      return snap()
    },
    moveVideos: async (videoIds, folderId) => {
      store.moveVideos(videoIds, folderId)
      return snap()
    },
    createTag: async (name) => {
      store.createTag(name)
      return snap()
    },
    renameTag: async (id, name) => {
      store.renameTag(id, name)
      return snap()
    },
    deleteTag: async (id) => {
      store.deleteTag(id)
      return snap()
    },
    toggleTag: async (videoIds, tagId) => {
      store.toggleTag(videoIds, tagId)
      return snap()
    },
    createPlaylist: async (name) => {
      store.createPlaylist(name)
      return snap()
    },
    renamePlaylist: async (id, name) => {
      store.renamePlaylist(id, name)
      return snap()
    },
    deletePlaylist: async (id) => {
      store.deletePlaylist(id)
      return snap()
    },
    addToPlaylist: async (playlistId, videoIds) => {
      store.addToPlaylist(playlistId, videoIds)
      return snap()
    },
    removeFromPlaylist: async (playlistId, videoIds) => {
      store.removeFromPlaylist(playlistId, videoIds)
      return snap()
    },
    setMeta: async (id, meta) => {
      store.setMeta(id, meta)
      return snap()
    },
    thumbUrl: async (id) => {
      const result = await MMPlayer.hasThumb({ id })
      return webSrc(result.path, result.url)
    },
    saveThumb: async (id, dataUrl) => {
      const saved = await MMPlayer.saveThumbFile({ id, dataUrl })
      store.markThumb(id, true)
      return webSrc(saved.path, saved.url) ?? saved.url
    },
    captureThumb: async (id) => {
      const cap = await MMPlayer.captureThumb({ id })
      if (!cap.ok) return null
      const url = webSrc(cap.path, cap.url)
      if (!url) return null
      store.markThumb(id, true)
      if (cap.duration != null || cap.width != null || cap.height != null) {
        store.setMeta(id, { duration: cap.duration, width: cap.width, height: cap.height })
      }
      return {
        url,
        duration: cap.duration,
        width: cap.width,
        height: cap.height
      }
    },
    showInFolder: (id) => MMPlayer.showInFolder({ id }),
    openExternal: (id) => MMPlayer.openExternal({ id }),
    copyPath: (id) => MMPlayer.copyPath({ id }),
    videoUrl: (id) => `${mediaBase}/video/${id}`,
    onScanProgress: (cb: (p: ScanProgress) => void) => {
      let handle: { remove: () => Promise<void> } | null = null
      void MMPlayer.addListener('scanProgress', cb).then((h) => {
        handle = h
      })
      return () => {
        void handle?.remove()
      }
    }
  }
}
