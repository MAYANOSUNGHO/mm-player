import type { LibraryState, ScanProgress } from './types'

export type CaptureThumbResult = {
  url: string
  duration?: number
  width?: number
  height?: number
}

export type UpdateOffer = {
  version: string
  notes: string
  pageUrl: string
  downloadUrl: string | null
}

export type DesktopApi = {
  getLibrary: () => Promise<LibraryState>
  pickFolder: () => Promise<string | null>
  setRootAndScan: (rootPath: string) => Promise<LibraryState>
  rescan: () => Promise<LibraryState>
  healMissing: () => Promise<LibraryState>
  relocateVideo: (id: string) => Promise<LibraryState>
  purgeMissing: () => Promise<LibraryState>
  clearThumbs: (ids: string[]) => Promise<LibraryState>
  removeVideos: (ids: string[]) => Promise<LibraryState>
  deleteVideoFiles: (ids: string[]) => Promise<LibraryState>
  importVideos: (paths: string[], folderId: string | null) => Promise<LibraryState>
  pathForFile: (file: File) => string
  createFolder: (name: string, parentId: string | null) => Promise<LibraryState>
  renameFolder: (id: string, name: string) => Promise<LibraryState>
  deleteFolder: (id: string) => Promise<LibraryState>
  moveVideos: (videoIds: string[], folderId: string | null) => Promise<LibraryState>
  createTag: (name: string) => Promise<LibraryState>
  renameTag: (id: string, name: string) => Promise<LibraryState>
  deleteTag: (id: string) => Promise<LibraryState>
  toggleTag: (videoIds: string[], tagId: string) => Promise<LibraryState>
  createPlaylist: (name: string) => Promise<LibraryState>
  renamePlaylist: (id: string, name: string) => Promise<LibraryState>
  deletePlaylist: (id: string) => Promise<LibraryState>
  addToPlaylist: (playlistId: string, videoIds: string[]) => Promise<LibraryState>
  removeFromPlaylist: (playlistId: string, videoIds: string[]) => Promise<LibraryState>
  setMeta: (
    id: string,
    meta: { duration?: number; width?: number; height?: number }
  ) => Promise<LibraryState>
  thumbUrl: (id: string) => Promise<string | null>
  saveThumb: (id: string, dataUrl: string) => Promise<string>
  captureThumb?: (id: string) => Promise<CaptureThumbResult | null>
  showInFolder: (id: string) => Promise<void>
  openExternal: (id: string) => Promise<void>
  copyPath: (id: string) => Promise<void>
  videoUrl: (id: string) => string
  checkUpdate: () => Promise<UpdateOffer | null>
  installUpdate: (offer: Pick<UpdateOffer, 'downloadUrl' | 'pageUrl'>) => Promise<void>
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void
}
