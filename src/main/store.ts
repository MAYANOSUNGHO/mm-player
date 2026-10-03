import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs'
import path from 'path'
import type { LibraryState, Playlist, Tag, VideoRecord, VirtualFolder } from '../shared/types'
import { VIDEO_EXTS, type FoundVideo } from './scan'

type DiskShape = {
  rootPath: string | null
  lastScanAt: number | null
  folders: VirtualFolder[]
  tags: Tag[]
  playlists: Playlist[]
  videos: VideoRecord[]
  ignoredPaths: string[]
}

function emptyState(): DiskShape {
  return {
    rootPath: null,
    lastScanAt: null,
    folders: [],
    tags: [],
    playlists: [],
    videos: [],
    ignoredPaths: []
  }
}

export function videoIdFromPath(filePath: string): string {
  const key = path.normalize(filePath).replace(/\\/g, '/').toLowerCase()
  return createHash('sha1').update(key).digest('hex')
}

export class LibraryStore {
  private file: string
  private thumbs: string
  private data: DiskShape = emptyState()

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'library.json')
    this.thumbs = path.join(dir, 'thumbs')
    mkdirSync(this.thumbs, { recursive: true })
    this.load()
  }

  get thumbsDir(): string {
    return this.thumbs
  }

  thumbFile(id: string): string {
    return path.join(this.thumbs, `${id}.jpg`)
  }

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

  getVideo(id: string): VideoRecord | undefined {
    return this.data.videos.find((v) => v.id === id)
  }

  setRoot(rootPath: string): void {
    if (this.data.rootPath && path.normalize(this.data.rootPath) !== path.normalize(rootPath)) {
      this.data.videos = this.data.videos.filter((v) => isUnderRoot(v.path, rootPath))
    }
    this.data.rootPath = rootPath
    this.save()
  }

  applyScan(found: FoundVideo[]): void {
    this.mergeFound(found, true)
    this.data.lastScanAt = Date.now()
    this.save()
  }

  refreshMissingFlags(): void {
    let changed = false
    for (const video of this.data.videos) {
      const gone = !video.path || !existsSync(video.path)
      if (video.missing !== gone) {
        video.missing = gone
        changed = true
      }
    }
    if (changed) this.save()
  }

  relinkByName(found: FoundVideo[]): void {
    this.refreshMissingFlags()
    this.mergeFound(found, false)
    this.save()
  }

  relocate(id: string, filePath: string): LibraryState {
    const video = this.data.videos.find((v) => v.id === id)
    if (!video) return this.snapshot()
    const ext = path.extname(filePath).toLowerCase()
    if (!VIDEO_EXTS.has(ext) || !existsSync(filePath)) return this.snapshot()
    const key = normPath(filePath)
    const other = this.data.videos.find((v) => v.id !== id && !v.missing && normPath(v.path) === key)
    if (other) return this.snapshot()
    let s
    try {
      s = statSync(filePath)
    } catch {
      return this.snapshot()
    }
    const file: FoundVideo = {
      path: filePath,
      name: path.basename(filePath),
      ext,
      size: s.size,
      mtime: s.mtimeMs
    }
    const idx = this.data.videos.findIndex((v) => v.id === id)
    this.data.videos[idx] = this.recordFrom(video, file)
    this.save()
    return this.snapshot()
  }

  clearThumbs(ids: string[]): LibraryState {
    const drop = new Set(ids)
    for (const video of this.data.videos) {
      if (!drop.has(video.id)) continue
      const file = this.thumbFile(video.id)
      if (existsSync(file)) {
        try {
          unlinkSync(file)
        } catch {
          /* ignore */
        }
      }
      video.hasThumb = false
    }
    this.save()
    return this.snapshot()
  }

  removeVideos(ids: string[], ignore: boolean): LibraryState {
    const drop = new Set(ids)
    if (ignore) {
      this.ignore(this.data.videos.filter((v) => drop.has(v.id)).map((v) => v.path))
    }
    this.data.videos = this.data.videos.filter((v) => !drop.has(v.id))
    for (const playlist of this.data.playlists) {
      playlist.videoIds = playlist.videoIds.filter((id) => !drop.has(id))
    }
    this.save()
    return this.snapshot()
  }

  importVideos(paths: string[], folderId: string | null): LibraryState {
    if (!folderExists(this.data.folders, folderId)) folderId = null
    this.unignore(paths)
    for (const filePath of paths) {
      const ext = path.extname(filePath).toLowerCase()
      if (!VIDEO_EXTS.has(ext) || !existsSync(filePath)) continue
      let info
      try {
        info = statSync(filePath)
      } catch {
        continue
      }
      if (!info.isFile() || info.size < 10_000) continue
      const key = normPath(filePath)
      const existing = this.data.videos.find((v) => normPath(v.path) === key)
      if (existing) {
        existing.missing = false
        existing.name = path.basename(filePath)
        existing.ext = ext
        existing.size = info.size
        existing.mtime = info.mtimeMs
        if (folderId) existing.folderId = folderId
        continue
      }
      const record = this.recordFrom(undefined, {
        path: filePath,
        name: path.basename(filePath),
        ext,
        size: info.size,
        mtime: info.mtimeMs
      })
      record.folderId = folderId
      this.data.videos.push(record)
    }
    this.save()
    return this.snapshot()
  }

  private mergeFound(found: FoundVideo[], addNew: boolean): void {
    const ignored = this.ignoredSet()
    found = found.filter((file) => !ignored.has(normPath(file.path)))
    const usedFound = new Set<string>()
    const usedPrev = new Set<string>()
    const next: VideoRecord[] = []

    for (const file of found) {
      const prev = this.data.videos.find((v) => !usedPrev.has(v.id) && normPath(v.path) === normPath(file.path))
      if (!prev) continue
      next.push(this.recordFrom(prev, file))
      usedFound.add(normPath(file.path))
      usedPrev.add(prev.id)
    }

    const leftoverFound = found.filter((file) => !usedFound.has(normPath(file.path)))
    const foundByName = new Map<string, FoundVideo[]>()
    for (const file of leftoverFound) {
      const key = nameKey(file.name)
      const list = foundByName.get(key) ?? []
      list.push(file)
      foundByName.set(key, list)
    }

    for (const prev of this.data.videos) {
      if (usedPrev.has(prev.id)) continue
      const hits = foundByName.get(nameKey(prev.name)) ?? []
      const sizeHits = hits.filter((file) => file.size === prev.size)
      const pick = sizeHits.length === 1 ? sizeHits[0] : hits.length === 1 ? hits[0] : undefined
      if (!pick) continue
      next.push(this.recordFrom(prev, pick))
      usedPrev.add(prev.id)
      usedFound.add(normPath(pick.path))
      const key = nameKey(pick.name)
      foundByName.set(
        key,
        (foundByName.get(key) ?? []).filter((file) => normPath(file.path) !== normPath(pick.path))
      )
    }

    for (const prev of this.data.videos) {
      if (usedPrev.has(prev.id)) continue
      next.push({ ...prev, missing: true, tagIds: [...prev.tagIds] })
      usedPrev.add(prev.id)
    }

    if (addNew) {
      const claimed = new Set(next.map((v) => v.id))
      for (const file of found) {
        if (usedFound.has(normPath(file.path))) continue
        const id = videoIdFromPath(file.path)
        if (claimed.has(id)) continue
        next.push(this.recordFrom(undefined, file))
        claimed.add(id)
      }
    }

    this.data.videos = next
  }

  private recordFrom(prev: VideoRecord | undefined, file: FoundVideo): VideoRecord {
    const id = prev?.id ?? videoIdFromPath(file.path)
    const mtimeChanged = prev ? prev.mtime !== file.mtime : false
    const hasThumb = Boolean(prev?.hasThumb && !mtimeChanged && existsSync(this.thumbFile(id)))
    if (prev && mtimeChanged && existsSync(this.thumbFile(id))) {
      try {
        unlinkSync(this.thumbFile(id))
      } catch {
        /* ignore */
      }
    }
    return {
      id,
      path: file.path,
      name: file.name,
      ext: file.ext,
      size: file.size,
      mtime: file.mtime,
      duration: mtimeChanged ? null : (prev?.duration ?? null),
      width: mtimeChanged ? null : (prev?.width ?? null),
      height: mtimeChanged ? null : (prev?.height ?? null),
      folderId: folderExists(this.data.folders, prev?.folderId ?? null) ? prev?.folderId ?? null : null,
      diskFolder: null,
      tagIds: (prev?.tagIds ?? []).filter((tid) => this.data.tags.some((t) => t.id === tid)),
      missing: false,
      hasThumb
    }
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

  createFolder(name: string, parentId: string | null): VirtualFolder {
    if (parentId && !this.data.folders.some((f) => f.id === parentId)) {
      parentId = null
    }
    const folder: VirtualFolder = {
      id: randomUUID(),
      parentId,
      name: uniqueName(
        name,
        this.data.folders.filter((f) => f.parentId === parentId).map((f) => f.name)
      ),
      createdAt: Date.now()
    }
    this.data.folders.push(folder)
    this.save()
    return folder
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

  createTag(name: string): Tag {
    const existing = this.data.tags.find((t) => t.name.toLowerCase() === name.trim().toLowerCase())
    if (existing) return existing
    const tag: Tag = {
      id: randomUUID(),
      name: uniqueName(
        name.trim(),
        this.data.tags.map((t) => t.name)
      ),
      createdAt: Date.now()
    }
    this.data.tags.push(tag)
    this.save()
    return tag
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
      if (allHave) {
        video.tagIds = video.tagIds.filter((id) => id !== tagId)
      } else if (!video.tagIds.includes(tagId)) {
        video.tagIds.push(tagId)
      }
    }
    this.save()
  }

  createPlaylist(name: string): Playlist {
    const playlist: Playlist = {
      id: randomUUID(),
      name: uniqueName(
        name.trim() || '새 재생목록',
        this.data.playlists.map((p) => p.name)
      ),
      videoIds: [],
      createdAt: Date.now()
    }
    this.data.playlists.push(playlist)
    this.save()
    return playlist
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
    const video = this.getVideo(id)
    if (!video) return
    if (meta.duration != null && Number.isFinite(meta.duration)) video.duration = meta.duration
    if (meta.width != null) video.width = meta.width
    if (meta.height != null) video.height = meta.height
    this.save(false)
  }

  markThumb(id: string, ready: boolean): void {
    const video = this.getVideo(id)
    if (!video) return
    video.hasThumb = ready
    this.save(false)
  }

  private ignoredSet(): Set<string> {
    return ignoredSetOf(this.data.ignoredPaths)
  }

  private ignore(paths: string[]): void {
    const set = this.ignoredSet()
    for (const filePath of paths) {
      if (filePath) set.add(normPath(filePath))
    }
    this.data.ignoredPaths = [...set]
  }

  private unignore(paths: string[]): void {
    const drop = ignoredSetOf(paths)
    this.data.ignoredPaths = this.data.ignoredPaths.filter((filePath) => !drop.has(normPath(filePath)))
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<DiskShape>
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
        videos: Array.isArray(parsed.videos) ? parsed.videos : [],
        ignoredPaths: Array.isArray(parsed.ignoredPaths) ? parsed.ignoredPaths.filter((p) => typeof p === 'string') : []
      }
      for (const video of this.data.videos) {
        video.hasThumb = Boolean(video.hasThumb && existsSync(this.thumbFile(video.id)))
        if (!Array.isArray(video.tagIds)) video.tagIds = []
        if (video.diskFolder === undefined) video.diskFolder = null
      }
    } catch {
      this.data = emptyState()
    }
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data))
    try {
      writeFileSync(this.file, readFileSync(tmp))
      unlinkSync(tmp)
    } catch {
      writeFileSync(this.file, JSON.stringify(this.data))
    }
  }

  private save(immediate = true): void {
    if (immediate) {
      this.flush()
      return
    }
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 400)
  }
}

function isUnderRoot(filePath: string, root: string): boolean {
  const rel = path.relative(root, filePath)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function normPath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/').toLowerCase()
}

function ignoredSetOf(paths: string[]): Set<string> {
  return new Set(paths.map((p) => normPath(p)))
}

function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

function folderExists(folders: VirtualFolder[], id: string | null): boolean {
  if (!id) return false
  return folders.some((f) => f.id === id)
}

export function descendantIds(folders: VirtualFolder[], id: string): Set<string> {
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

function uniqueName(base: string, existing: string[]): string {
  const trimmed = base.trim() || '이름 없음'
  const lower = new Set(existing.map((n) => n.toLowerCase()))
  if (!lower.has(trimmed.toLowerCase())) return trimmed
  let i = 2
  while (lower.has(`${trimmed} ${i}`.toLowerCase())) i += 1
  return `${trimmed} ${i}`
}
