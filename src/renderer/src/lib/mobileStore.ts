import type { LibraryState, Playlist, Tag, VideoRecord, VirtualFolder } from '../../../shared/types'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import type { FoundScanVideo } from '../native/mmPlayer'

type DiskShape = {
  rootPath: string | null
  lastScanAt: number | null
  folders: VirtualFolder[]
  tags: Tag[]
  playlists: Playlist[]
  videos: VideoRecord[]
}

const FILE = 'library.json'

function emptyState(): DiskShape {
  return {
    rootPath: null,
    lastScanAt: null,
    folders: [],
    tags: [],
    playlists: [],
    videos: []
  }
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function isJunkName(name: string, path: string): boolean {
  const n = name.toLowerCase()
  if (n.startsWith('.') || n.startsWith('.temp') || n.startsWith('.tmp')) return true
  if (n.endsWith('.tmp') || n.endsWith('.temp') || n.endsWith('.part')) return true
  const hay = `${path}/${name}`.toLowerCase().replace(/\\/g, '/')
  return hay.split('/').some((part) => {
    if (!part) return false
    if (part.startsWith('.')) return true
    if (part === 'temp' || part === 'tmp' || part === '.temp' || part === '.tmp') return true
    if (part.startsWith('.temp')) return true
    return false
  })
}

function uniqueName(base: string, existing: string[]): string {
  const trimmed = base.trim() || '이름 없음'
  const lower = new Set(existing.map((n) => n.toLowerCase()))
  if (!lower.has(trimmed.toLowerCase())) return trimmed
  let i = 2
  while (lower.has(`${trimmed} ${i}`.toLowerCase())) i += 1
  return `${trimmed} ${i}`
}

function folderExists(folders: VirtualFolder[], id: string | null): boolean {
  if (!id) return false
  return folders.some((f) => f.id === id)
}

function descendantIds(folders: VirtualFolder[], id: string): Set<string> {
  const ids = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id)
        grew = true
      }
    }
  }
  return ids
}

export class MobileStore {
  private data: DiskShape = emptyState()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  snapshot(): LibraryState {
    return {
      rootPath: this.data.rootPath,
      lastScanAt: this.data.lastScanAt,
      folders: this.data.folders.map((f) => ({ ...f })),
      tags: this.data.tags.map((t) => ({ ...t })),
      playlists: this.data.playlists.map((p) => ({ ...p, videoIds: [...p.videoIds] })),
      videos: this.data.videos.map((v) => ({ ...v, tagIds: [...v.tagIds] }))
    }
  }

  async load(): Promise<void> {
    try {
      const file = await Filesystem.readFile({
        path: FILE,
        directory: Directory.Data,
        encoding: Encoding.UTF8
      })
      const parsed = JSON.parse(String(file.data)) as Partial<DiskShape>
      this.data = {
        rootPath: parsed.rootPath ?? null,
        lastScanAt: parsed.lastScanAt ?? null,
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        playlists: Array.isArray(parsed.playlists)
          ? parsed.playlists.map((p) => ({
              ...p,
              videoIds: Array.isArray(p.videoIds) ? p.videoIds : []
            }))
          : [],
        videos: Array.isArray(parsed.videos) ? parsed.videos : []
      }
      for (const video of this.data.videos) {
        if (!Array.isArray(video.tagIds)) video.tagIds = []
        if (video.diskFolder === undefined) video.diskFolder = null
      }
    } catch {
      this.data = emptyState()
    }
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await Filesystem.writeFile({
      path: FILE,
      directory: Directory.Data,
      data: JSON.stringify(this.data),
      encoding: Encoding.UTF8
    })
  }

  private save(immediate = true): void {
    if (immediate) {
      void this.flush()
      return
    }
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 400)
  }

  setRoot(rootPath: string): void {
    this.data.rootPath = rootPath
    this.save()
  }

  applyScan(found: FoundScanVideo[]): void {
    const seen = new Set<string>()
    const byId = new Map(this.data.videos.map((v) => [v.id, v]))
    const next: VideoRecord[] = []

    for (const file of found) {
      if (isJunkName(file.name, file.diskFolder ?? file.path)) continue
      seen.add(file.id)
      const prev = byId.get(file.id)
      const mtimeChanged = prev ? prev.mtime !== file.mtime : false
      next.push({
        id: file.id,
        path: file.path,
        name: file.name,
        ext: file.ext,
        size: file.size,
        mtime: file.mtime,
        duration: file.duration ?? (mtimeChanged ? null : (prev?.duration ?? null)),
        width: file.width ?? (mtimeChanged ? null : (prev?.width ?? null)),
        height: file.height ?? (mtimeChanged ? null : (prev?.height ?? null)),
        folderId: folderExists(this.data.folders, prev?.folderId ?? null) ? prev?.folderId ?? null : null,
        diskFolder: file.diskFolder ?? null,
        tagIds: (prev?.tagIds ?? []).filter((tid) => this.data.tags.some((t) => t.id === tid)),
        missing: false,
        hasThumb: Boolean(prev?.hasThumb && !mtimeChanged)
      })
    }

    for (const prev of this.data.videos) {
      if (seen.has(prev.id)) continue
      next.push({ ...prev, missing: true })
    }

    this.data.videos = next
    this.data.lastScanAt = Date.now()
    this.save()
  }

  purgeMissing(): LibraryState {
    this.data.videos = this.data.videos.filter((v) => !v.missing)
    const keep = new Set(this.data.videos.map((v) => v.id))
    for (const playlist of this.data.playlists) {
      playlist.videoIds = playlist.videoIds.filter((id) => keep.has(id))
    }
    this.save()
    return this.snapshot()
  }

  createFolder(name: string, parentId: string | null): void {
    if (parentId && !this.data.folders.some((f) => f.id === parentId)) parentId = null
    this.data.folders.push({
      id: uuid(),
      parentId,
      name: uniqueName(
        name,
        this.data.folders.filter((f) => f.parentId === parentId).map((f) => f.name)
      ),
      createdAt: Date.now()
    })
    this.save()
  }

  renameFolder(id: string, name: string): void {
    const folder = this.data.folders.find((f) => f.id === id)
    if (!folder) return
    const trimmed = name.trim()
    if (!trimmed) return
    folder.name = uniqueName(
      trimmed,
      this.data.folders.filter((f) => f.parentId === folder.parentId && f.id !== id).map((f) => f.name)
    )
    this.save()
  }

  deleteFolder(id: string): void {
    const drop = descendantIds(this.data.folders, id)
    this.data.folders = this.data.folders.filter((f) => !drop.has(f.id))
    for (const video of this.data.videos) {
      if (video.folderId && drop.has(video.folderId)) video.folderId = null
    }
    this.save()
  }

  moveVideos(videoIds: string[], folderId: string | null): void {
    if (folderId && !this.data.folders.some((f) => f.id === folderId)) folderId = null
    const set = new Set(videoIds)
    for (const video of this.data.videos) {
      if (set.has(video.id)) video.folderId = folderId
    }
    this.save()
  }

  createTag(name: string): void {
    const existing = this.data.tags.find((t) => t.name.toLowerCase() === name.trim().toLowerCase())
    if (existing) return
    this.data.tags.push({
      id: uuid(),
      name: uniqueName(
        name.trim(),
        this.data.tags.map((t) => t.name)
      ),
      createdAt: Date.now()
    })
    this.save()
  }

  renameTag(id: string, name: string): void {
    const tag = this.data.tags.find((t) => t.id === id)
    if (!tag) return
    const trimmed = name.trim()
    if (!trimmed) return
    tag.name = uniqueName(
      trimmed,
      this.data.tags.filter((t) => t.id !== id).map((t) => t.name)
    )
    this.save()
  }

  deleteTag(id: string): void {
    this.data.tags = this.data.tags.filter((t) => t.id !== id)
    for (const video of this.data.videos) {
      video.tagIds = video.tagIds.filter((tid) => tid !== id)
    }
    this.save()
  }

  toggleTag(videoIds: string[], tagId: string): void {
    if (!this.data.tags.some((t) => t.id === tagId)) return
    const set = new Set(videoIds)
    const targets = this.data.videos.filter((v) => set.has(v.id))
    if (!targets.length) return
    const allHave = targets.every((v) => v.tagIds.includes(tagId))
    for (const video of targets) {
      if (allHave) video.tagIds = video.tagIds.filter((id) => id !== tagId)
      else if (!video.tagIds.includes(tagId)) video.tagIds.push(tagId)
    }
    this.save()
  }

  createPlaylist(name: string): void {
    this.data.playlists.push({
      id: uuid(),
      name: uniqueName(
        name.trim() || '새 재생목록',
        this.data.playlists.map((p) => p.name)
      ),
      videoIds: [],
      createdAt: Date.now()
    })
    this.save()
  }

  renamePlaylist(id: string, name: string): void {
    const playlist = this.data.playlists.find((p) => p.id === id)
    if (!playlist) return
    const trimmed = name.trim()
    if (!trimmed) return
    playlist.name = uniqueName(
      trimmed,
      this.data.playlists.filter((p) => p.id !== id).map((p) => p.name)
    )
    this.save()
  }

  deletePlaylist(id: string): void {
    this.data.playlists = this.data.playlists.filter((p) => p.id !== id)
    this.save()
  }

  addToPlaylist(playlistId: string, videoIds: string[]): void {
    const playlist = this.data.playlists.find((p) => p.id === playlistId)
    if (!playlist) return
    const known = new Set(this.data.videos.map((v) => v.id))
    const have = new Set(playlist.videoIds)
    for (const id of videoIds) {
      if (!known.has(id) || have.has(id)) continue
      playlist.videoIds.push(id)
      have.add(id)
    }
    this.save()
  }

  removeFromPlaylist(playlistId: string, videoIds: string[]): void {
    const playlist = this.data.playlists.find((p) => p.id === playlistId)
    if (!playlist) return
    const drop = new Set(videoIds)
    playlist.videoIds = playlist.videoIds.filter((id) => !drop.has(id))
    this.save()
  }

  setMeta(id: string, meta: { duration?: number; width?: number; height?: number }): void {
    const video = this.data.videos.find((v) => v.id === id)
    if (!video) return
    if (meta.duration != null && Number.isFinite(meta.duration)) video.duration = meta.duration
    if (meta.width != null) video.width = meta.width
    if (meta.height != null) video.height = meta.height
    this.save(false)
  }

  markThumb(id: string, ready: boolean): void {
    const video = this.data.videos.find((v) => v.id === id)
    if (!video) return
    video.hasThumb = ready
    this.save(false)
  }
}
