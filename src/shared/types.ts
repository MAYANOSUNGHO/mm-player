export type VirtualFolder = {
  id: string
  parentId: string | null
  name: string
  createdAt: number
}

export type Tag = {
  id: string
  name: string
  createdAt: number
}

export type VideoRecord = {
  id: string
  path: string
  name: string
  ext: string
  size: number
  mtime: number
  duration: number | null
  width: number | null
  height: number | null
  folderId: string | null
  diskFolder: string | null
  tagIds: string[]
  missing: boolean
  hasThumb: boolean
}

export type Playlist = {
  id: string
  name: string
  videoIds: string[]
  createdAt: number
}

export type LibraryState = {
  rootPath: string | null
  lastScanAt: number | null
  folders: VirtualFolder[]
  tags: Tag[]
  playlists: Playlist[]
  videos: VideoRecord[]
}

export type ScanProgress = {
  walking: boolean
  found: number
  currentDir: string
}

export type View =
  | { type: 'all' }
  | { type: 'uncategorized' }
  | { type: 'folder'; id: string }
  | { type: 'disk'; path: string }
  | { type: 'tag'; id: string }
  | { type: 'playlists' }
  | { type: 'playlist'; id: string }
