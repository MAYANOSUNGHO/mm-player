import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { pathToFileURL } from 'url'
import { startMediaServer } from './mediaServer'
import { VIDEO_EXTS, scanVideos } from './scan'
import { LibraryStore } from './store'
import { checkForUpdate, installUpdate } from './update'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function appIcon(): string {
  const packed = path.join(process.resourcesPath, 'icon.ico')
  if (existsSync(packed)) return packed
  return path.join(app.getAppPath(), 'resources', 'icon.ico')
}

app.setName('MM Player')
app.setPath('userData', path.join(app.getPath('appData'), 'video-organizer'))

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'appmedia',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
])

let store: LibraryStore | undefined
let mainWindow: BrowserWindow | null = null
let scanning = false
let stopScan = false
let mediaBase = ''
let closeMediaServer: (() => void) | undefined

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    title: 'MM Player',
    icon: appIcon(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#f2f2f2',
      height: 40
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('preload-error', preloadPath, error)
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('did-fail-load', code, desc, url)
  })
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
  if (level >= 3) console.error(`[renderer] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function sendProgress(found: number, currentDir: string, walking: boolean): void {
  mainWindow?.webContents.send('scan:progress', { walking, found, currentDir })
}

async function runScan(rootPath: string) {
  if (scanning) {
    stopScan = true
    await new Promise((r) => setTimeout(r, 120))
  }
  scanning = true
  stopScan = false
  try {
    const found = await scanVideos(rootPath, (p) => sendProgress(p.found, p.currentDir, p.walking), () => stopScan)
    if (stopScan) return store.snapshot()
    store.setRoot(rootPath)
    store.applyScan(found)
    return store.snapshot()
  } finally {
    scanning = false
    stopScan = false
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('MM.Player')
  store = new LibraryStore()

  try {
    const media = await startMediaServer({
      videoPath: (id) => {
        const video = store?.getVideo(id)
        if (!video?.path || video.missing || !existsSync(video.path)) return undefined
        return video.path
      }
    })
    mediaBase = `http://127.0.0.1:${media.port}`
    closeMediaServer = media.close
    console.log('media-server', mediaBase)
  } catch (error) {
    console.error('media-server', error)
  }

  ipcMain.on('media:base-sync', (event) => {
    event.returnValue = mediaBase
  })
  ipcMain.handle('media:base', () => mediaBase)

  protocol.handle('appmedia', async (request) => {
    try {
      const url = new URL(request.url)
      const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
      let filePath: string | undefined
      if (url.hostname === 'video') {
        filePath = store.getVideo(id)?.path
      } else if (url.hostname === 'thumb') {
        filePath = store.thumbFile(id)
      }
      if (!filePath || !existsSync(filePath)) {
        return new Response('Not Found', { status: 404 })
      }
      return net.fetch(pathToFileURL(filePath).href)
    } catch {
      return new Response('Error', { status: 500 })
    }
  })

  ipcMain.handle('library:get', () => {
    store.refreshMissingFlags()
    return store.snapshot()
  })
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:install', (_e, offer: { downloadUrl: string | null; pageUrl: string }) => installUpdate(offer))

  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '영상 폴더 선택',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('library:setRoot', async (_e, rootPath: string) => runScan(rootPath))
  ipcMain.handle('library:rescan', async () => {
    const root = store.snapshot().rootPath
    if (!root) return store.snapshot()
    return runScan(root)
  })
  ipcMain.handle('library:purgeMissing', () => store.purgeMissing())
  ipcMain.handle('thumbs:clear', (_e, ids: string[]) => store.clearThumbs(Array.isArray(ids) ? ids : []))
  ipcMain.handle('videos:remove', (_e, ids: string[]) => store.removeVideos(Array.isArray(ids) ? ids : [], true))
  ipcMain.handle('videos:deleteFiles', async (_e, ids: string[]) => {
    const list = Array.isArray(ids) ? ids : []
    const removed: string[] = []
    for (const id of list) {
      const video = store.getVideo(id)
      if (!video) continue
      if (video.path && existsSync(video.path)) {
        try {
          await shell.trashItem(video.path)
        } catch {
          continue
        }
      }
      removed.push(id)
    }
    return store.removeVideos(removed, false)
  })
  ipcMain.handle('videos:import', (_e, paths: string[], folderId: string | null) =>
    store.importVideos(Array.isArray(paths) ? paths : [], folderId)
  )
  ipcMain.handle('library:healMissing', async () => {
    const root = store.snapshot().rootPath
    if (!root) return store.snapshot()
    store.refreshMissingFlags()
    if (!store.snapshot().videos.some((v) => v.missing)) return store.snapshot()
    if (scanning) return store.snapshot()
    scanning = true
    stopScan = false
    try {
      const found = await scanVideos(root, (p) => sendProgress(p.found, p.currentDir, p.walking), () => stopScan)
      if (!stopScan) store.relinkByName(found)
      return store.snapshot()
    } finally {
      scanning = false
      stopScan = false
    }
  })
  ipcMain.handle('videos:relocate', async (_e, id: string) => {
    const video = store.getVideo(id)
    if (!video) return store.snapshot()
    const defaultPath = existsSync(video.path) ? video.path : (store.snapshot().rootPath ?? undefined)
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '영상 경로 다시 지정',
      defaultPath,
      properties: ['openFile'],
      filters: [
        { name: '영상', extensions: [...VIDEO_EXTS].map((ext) => ext.slice(1)) },
        { name: '모든 파일', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return store.snapshot()
    const next = store.relocate(id, result.filePaths[0])
    const updated = next.videos.find((v) => v.id === id)
    if (!updated || updated.missing) {
      await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        title: 'MM Player',
        message: '이 파일을 연결하지 못했습니다.',
        detail: '영상 파일이 아니거나, 이미 라이브러리에 있는 파일입니다.'
      })
    }
    return next
  })

  ipcMain.handle('folders:create', (_e, name: string, parentId: string | null) => {
    store.createFolder(name, parentId)
    return store.snapshot()
  })
  ipcMain.handle('folders:rename', (_e, id: string, name: string) => {
    store.renameFolder(id, name)
    return store.snapshot()
  })
  ipcMain.handle('folders:delete', (_e, id: string) => {
    store.deleteFolder(id)
    return store.snapshot()
  })
  ipcMain.handle('videos:move', (_e, videoIds: string[], folderId: string | null) => {
    store.moveVideos(videoIds, folderId)
    return store.snapshot()
  })
  ipcMain.handle('tags:create', (_e, name: string) => {
    store.createTag(name)
    return store.snapshot()
  })
  ipcMain.handle('tags:rename', (_e, id: string, name: string) => {
    store.renameTag(id, name)
    return store.snapshot()
  })
  ipcMain.handle('tags:delete', (_e, id: string) => {
    store.deleteTag(id)
    return store.snapshot()
  })
  ipcMain.handle('tags:toggle', (_e, videoIds: string[], tagId: string) => {
    store.toggleTag(videoIds, tagId)
    return store.snapshot()
  })
  ipcMain.handle('playlists:create', (_e, name: string) => {
    store.createPlaylist(name)
    return store.snapshot()
  })
  ipcMain.handle('playlists:rename', (_e, id: string, name: string) => {
    store.renamePlaylist(id, name)
    return store.snapshot()
  })
  ipcMain.handle('playlists:delete', (_e, id: string) => {
    store.deletePlaylist(id)
    return store.snapshot()
  })
  ipcMain.handle('playlists:add', (_e, playlistId: string, videoIds: string[]) => {
    store.addToPlaylist(playlistId, videoIds)
    return store.snapshot()
  })
  ipcMain.handle('playlists:remove', (_e, playlistId: string, videoIds: string[]) => {
    store.removeFromPlaylist(playlistId, videoIds)
    return store.snapshot()
  })
  ipcMain.handle('videos:meta', (_e, id: string, meta: { duration?: number; width?: number; height?: number }) => {
    store.setMeta(id, meta)
    return store.snapshot()
  })
  ipcMain.handle('thumb:url', (_e, id: string) => {
    const file = store.thumbFile(id)
    if (!existsSync(file)) return null
    return `appmedia://thumb/${id}`
  })
  ipcMain.handle('thumb:save', async (_e, id: string, dataUrl: string) => {
    const comma = dataUrl.indexOf(',')
    const buf = Buffer.from(dataUrl.slice(comma + 1), 'base64')
    await writeFile(store.thumbFile(id), buf)
    store.markThumb(id, true)
    return `appmedia://thumb/${id}`
  })
  ipcMain.handle('videos:showInFolder', async (_e, id: string) => {
    const video = store.getVideo(id)
    if (video && existsSync(video.path)) shell.showItemInFolder(video.path)
  })
  ipcMain.handle('videos:openExternal', async (_e, id: string) => {
    const video = store.getVideo(id)
    if (video && existsSync(video.path)) await shell.openPath(video.path)
  })
  ipcMain.handle('videos:copyPath', (_e, id: string) => {
    const video = store.getVideo(id)
    if (video) clipboard.writeText(video.path)
  })

  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  closeMediaServer?.()
  store?.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
