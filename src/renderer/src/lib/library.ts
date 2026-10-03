import type { LibraryState, Playlist, Tag, VideoRecord, View, VirtualFolder } from '../../../shared/types'

export function childrenOf(folders: VirtualFolder[], parentId: string | null): VirtualFolder[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

export function descendantFolderIds(folders: VirtualFolder[], id: string): Set<string> {
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

export function folderPath(folders: VirtualFolder[], id: string): VirtualFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const chain: VirtualFolder[] = []
  let cur: VirtualFolder | undefined = byId.get(id)
  const guard = new Set<string>()
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    chain.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return chain
}

export function folderVideoCount(videos: VideoRecord[], folders: VirtualFolder[], id: string): number {
  const ids = descendantFolderIds(folders, id)
  return videos.filter((v) => v.folderId && ids.has(v.folderId)).length
}

export function tagCount(videos: VideoRecord[], tagId: string): number {
  return videos.filter((v) => v.tagIds.includes(tagId)).length
}

export function playlistCount(videos: VideoRecord[], playlist: Playlist): number {
  const alive = new Set(videos.map((v) => v.id))
  return playlist.videoIds.filter((id) => alive.has(id)).length
}

export function videosInView(
  library: LibraryState,
  view: View,
  search: string,
  options?: { includeDeepFolders?: boolean }
): VideoRecord[] {
  if (view.type === 'playlists') return []
  if (view.type === 'playlist') {
    const playlist = (library.playlists ?? []).find((p) => p.id === view.id)
    const byId = new Map(library.videos.map((v) => [v.id, v]))
    const ordered = (playlist?.videoIds ?? [])
      .map((id) => byId.get(id))
      .filter((v): v is VideoRecord => Boolean(v))
    return searchTrim(ordered, library, search)
  }
  let list = [...library.videos]
  if (view.type === 'uncategorized') list = list.filter((v) => !v.folderId)
  if (view.type === 'folder') {
    if (options?.includeDeepFolders) {
      const ids = descendantFolderIds(library.folders, view.id)
      list = list.filter((v) => v.folderId && ids.has(v.folderId))
    } else {
      list = list.filter((v) => v.folderId === view.id)
    }
  }
  if (view.type === 'tag') list = list.filter((v) => v.tagIds.includes(view.id))
  const filtered = searchTrim(list, library, search)
  return filtered
}

function searchTrim(list: VideoRecord[], library: LibraryState, search: string): VideoRecord[] {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return list
  const tagsById = new Map(library.tags.map((t) => [t.id, t]))
  const foldersById = new Map(library.folders.map((f) => [f.id, f]))
  return list.filter((v) => tokens.every((token) => matchesToken(v, token, tagsById, foldersById)))
}

function matchesToken(
  v: VideoRecord,
  token: string,
  tagsById: Map<string, Tag>,
  foldersById: Map<string, VirtualFolder>
): boolean {
  if (token.startsWith('#')) {
    const needle = token.slice(1)
    if (!needle) return v.tagIds.length > 0
    return v.tagIds.some((id) => (tagsById.get(id)?.name ?? '').toLowerCase().includes(needle))
  }
  const tagNames = v.tagIds.map((id) => tagsById.get(id)?.name ?? '').join(' ')
  const folderName = v.folderId ? foldersById.get(v.folderId)?.name ?? '' : ''
  const hay = `${v.name} ${v.path} ${tagNames} ${folderName}`.toLowerCase()
  return hay.includes(token)
}

export type SortKey = 'name' | 'mtime' | 'size' | 'duration' | 'playlist'
export type SortDir = 'asc' | 'desc'

export function sortVideos(list: VideoRecord[], key: SortKey, dir: SortDir): VideoRecord[] {
  if (key === 'playlist') return list
  const sign = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    let cmp = 0
    if (key === 'name') cmp = a.name.localeCompare(b.name, 'ko', { numeric: true })
    else if (key === 'mtime') cmp = a.mtime - b.mtime
    else if (key === 'size') cmp = a.size - b.size
    else cmp = (a.duration ?? -1) - (b.duration ?? -1)
    if (cmp === 0) cmp = a.name.localeCompare(b.name, 'ko', { numeric: true })
    return cmp * sign
  })
}
