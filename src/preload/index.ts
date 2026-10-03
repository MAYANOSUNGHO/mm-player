import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopApi, UpdateOffer } from '../shared/api'
import type { LibraryState, ScanProgress } from '../shared/types'

let mediaBaseCache: string | null = null

function mediaBase(): string {
  if (mediaBaseCache == null) mediaBaseCache = (ipcRenderer.sendSync('media:base-sync') as string) || ''
  return mediaBaseCache
}

const api = {
  getLibrary: (): Promise<LibraryState> => ipcRenderer.invoke('library:get'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  setRootAndScan: (rootPath: string): Promise<LibraryState> => ipcRenderer.invoke('library:setRoot', rootPath),
  rescan: (): Promise<LibraryState> => ipcRenderer.invoke('library:rescan'),
  healMissing: (): Promise<LibraryState> => ipcRenderer.invoke('library:healMissing'),
  relocateVideo: (id: string): Promise<LibraryState> => ipcRenderer.invoke('videos:relocate', id),
  purgeMissing: (): Promise<LibraryState> => ipcRenderer.invoke('library:purgeMissing'),
  clearThumbs: (ids: string[]): Promise<LibraryState> => ipcRenderer.invoke('thumbs:clear', ids),
  removeVideos: (ids: string[]): Promise<LibraryState> => ipcRenderer.invoke('videos:remove', ids),
  deleteVideoFiles: (ids: string[]): Promise<LibraryState> => ipcRenderer.invoke('videos:deleteFiles', ids),
  importVideos: (paths: string[], folderId: string | null): Promise<LibraryState> =>
    ipcRenderer.invoke('videos:import', paths, folderId),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  createFolder: (name: string, parentId: string | null): Promise<LibraryState> =>
    ipcRenderer.invoke('folders:create', name, parentId),
  renameFolder: (id: string, name: string): Promise<LibraryState> => ipcRenderer.invoke('folders:rename', id, name),
  deleteFolder: (id: string): Promise<LibraryState> => ipcRenderer.invoke('folders:delete', id),
  moveVideos: (videoIds: string[], folderId: string | null): Promise<LibraryState> =>
    ipcRenderer.invoke('videos:move', videoIds, folderId),
  createTag: (name: string): Promise<LibraryState> => ipcRenderer.invoke('tags:create', name),
  renameTag: (id: string, name: string): Promise<LibraryState> => ipcRenderer.invoke('tags:rename', id, name),
  deleteTag: (id: string): Promise<LibraryState> => ipcRenderer.invoke('tags:delete', id),
  toggleTag: (videoIds: string[], tagId: string): Promise<LibraryState> =>
    ipcRenderer.invoke('tags:toggle', videoIds, tagId),
  createPlaylist: (name: string): Promise<LibraryState> => ipcRenderer.invoke('playlists:create', name),
  renamePlaylist: (id: string, name: string): Promise<LibraryState> => ipcRenderer.invoke('playlists:rename', id, name),
  deletePlaylist: (id: string): Promise<LibraryState> => ipcRenderer.invoke('playlists:delete', id),
  addToPlaylist: (playlistId: string, videoIds: string[]): Promise<LibraryState> =>
    ipcRenderer.invoke('playlists:add', playlistId, videoIds),
  removeFromPlaylist: (playlistId: string, videoIds: string[]): Promise<LibraryState> =>
    ipcRenderer.invoke('playlists:remove', playlistId, videoIds),
  setMeta: (
    id: string,
    meta: { duration?: number; width?: number; height?: number }
  ): Promise<LibraryState> => ipcRenderer.invoke('videos:meta', id, meta),
  thumbUrl: (id: string): Promise<string | null> => ipcRenderer.invoke('thumb:url', id),
  saveThumb: (id: string, dataUrl: string): Promise<string> => ipcRenderer.invoke('thumb:save', id, dataUrl),
  showInFolder: (id: string): Promise<void> => ipcRenderer.invoke('videos:showInFolder', id),
  openExternal: (id: string): Promise<void> => ipcRenderer.invoke('videos:openExternal', id),
  copyPath: (id: string): Promise<void> => ipcRenderer.invoke('videos:copyPath', id),
  videoUrl: (id: string): string => {
    const base = mediaBase()
    return base ? `${base}/video/${id}` : `appmedia://video/${id}`
  },
  checkUpdate: (): Promise<UpdateOffer | null> => ipcRenderer.invoke('update:check'),
  installUpdate: (offer: Pick<UpdateOffer, 'downloadUrl' | 'pageUrl'>): Promise<void> =>
    ipcRenderer.invoke('update:install', offer),
  onScanProgress: (cb: (p: ScanProgress) => void): (() => void) => {
    const listener = (_event: unknown, p: ScanProgress): void => cb(p)
    ipcRenderer.on('scan:progress', listener)
    return () => ipcRenderer.removeListener('scan:progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type { DesktopApi }
