import React, { useState } from 'react'
import type { LibraryState, Playlist, View, VirtualFolder } from '../../../shared/types'
import { childrenOf, diskChildren, diskHasChildren, diskVideoCount, folderVideoCount, playlistCount, tagCount } from '../lib/library'

type Props = {
  library: LibraryState
  view: View
  width: number
  tab: 'library' | 'playlists'
  onTab: (tab: 'library' | 'playlists') => void
  onView: (view: View) => void
  onCreateFolder: (parentId: string | null) => void
  onCreateTag: () => void
  onCreatePlaylist: () => void
  onFolderMenu: (e: React.MouseEvent, folder: VirtualFolder) => void
  onTagMenu: (e: React.MouseEvent, id: string, name: string) => void
  onPlaylistMenu: (e: React.MouseEvent, playlist: Playlist) => void
  onDropVideos: (folderId: string | null, videoIds: string[]) => void
  onDropPlaylist: (playlistId: string, videoIds: string[]) => void
  onChangeRoot: () => void
  className?: string
  rootActionLabel?: string
}

export default function Sidebar({
  library,
  view,
  width,
  tab,
  onTab,
  onView,
  onCreateFolder,
  onCreateTag,
  onCreatePlaylist,
  onFolderMenu,
  onTagMenu,
  onPlaylistMenu,
  onDropVideos,
  onDropPlaylist,
  onChangeRoot,
  className,
  rootActionLabel
}: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [diskOpen, setDiskOpen] = useState<Record<string, boolean>>({})
  const listed = library.videos
  const uncategorized = listed.filter((v) => !v.folderId).length
  const diskRoots = diskChildren(library.videos, null)
  const tags = [...library.tags].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const playlists = [...(library.playlists ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'ko'))

  return (
    <aside className={`sidebar ${className ?? ''}`} style={{ width }}>
      <div className="side-tabs">
        <button className={tab === 'library' ? 'on' : ''} onClick={() => onTab('library')}>
          라이브러리
        </button>
        <button className={tab === 'playlists' ? 'on' : ''} onClick={() => onTab('playlists')}>
          재생목록
        </button>
      </div>
      <div className="sidebar-scroll">
        {tab === 'library' ? (
          <>
            <section className="side-section">
              <div className="side-head">
                <span>Library</span>
              </div>
              <button
                className={`nav-item ${view.type === 'all' ? 'active' : ''}`}
                onClick={() => onView({ type: 'all' })}
              >
                <span className="nav-label">전체 영상</span>
                <span className="count">{listed.length}</span>
              </button>
              <button
                className={`nav-item ${view.type === 'uncategorized' ? 'active' : ''}`}
                onClick={() => onView({ type: 'uncategorized' })}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.add('drop')
                }}
                onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
                onDrop={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('drop')
                  const ids = readDragIds(e)
                  if (ids.length) onDropVideos(null, ids)
                }}
              >
                <span className="nav-label">미분류</span>
                <span className="count">{uncategorized}</span>
              </button>
            </section>

            {diskRoots.length ? (
              <section className="side-section">
                <div className="side-head">
                  <span>저장 폴더</span>
                </div>
                <DiskFolderList
                  videos={library.videos}
                  parentPath={null}
                  view={view}
                  open={diskOpen}
                  setOpen={setDiskOpen}
                  onView={onView}
                />
              </section>
            ) : null}

            <section className="side-section">
              <div className="side-head">
                <span>가상 폴더</span>
                <button className="icon-btn" title="새 폴더" onClick={() => onCreateFolder(null)}>
                  +
                </button>
              </div>
              {library.folders.filter((f) => !f.parentId).length === 0 ? (
                <div className="sidebar-foot" style={{ border: 0, padding: '4px 8px 0' }}>
                  가상 폴더입니다. 실제 디스크에는 만들어지지 않습니다.
                </div>
              ) : null}
              <div className="tree-root">
                <FolderList
                  library={library}
                  parentId={null}
                  rails={[]}
                  view={view}
                  open={open}
                  setOpen={setOpen}
                  onView={onView}
                  onFolderMenu={onFolderMenu}
                  onDropVideos={onDropVideos}
                />
              </div>
            </section>

            <section className="side-section">
              <div className="side-head">
                <span>Tags</span>
                <button className="icon-btn" title="새 태그" onClick={onCreateTag}>
                  +
                </button>
              </div>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  className={`nav-item ${view.type === 'tag' && view.id === tag.id ? 'active' : ''}`}
                  onClick={() => onView({ type: 'tag', id: tag.id })}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onTagMenu(e, tag.id, tag.name)
                  }}
                >
                  <span className="nav-label">#{tag.name}</span>
                  <span className="count">{tagCount(library.videos, tag.id)}</span>
                </button>
              ))}
            </section>
          </>
        ) : (
          <section className="side-section">
            <div className="side-head">
              <span>Playlists</span>
              <button className="icon-btn" title="새 재생목록" onClick={onCreatePlaylist}>
                +
              </button>
            </div>
            {playlists.length === 0 ? (
              <div className="sidebar-foot" style={{ border: 0, padding: '4px 8px 0' }}>
                우클릭으로 영상을 재생목록에 넣을 수 있습니다.
              </div>
            ) : null}
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                className={`nav-item ${view.type === 'playlist' && view.id === playlist.id ? 'active' : ''}`}
                onClick={() => onView({ type: 'playlist', id: playlist.id })}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onPlaylistMenu(e, playlist)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.add('drop')
                }}
                onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
                onDrop={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('drop')
                  const ids = readDragIds(e)
                  if (ids.length) onDropPlaylist(playlist.id, ids)
                }}
              >
                <span className="nav-label">{playlist.name}</span>
                <span className="count">{playlistCount(library.videos, playlist)}</span>
              </button>
            ))}
          </section>
        )}
      </div>
      <div className="sidebar-foot">
        {library.rootPath ? <div title={library.rootPath}>{displayRoot(library.rootPath)}</div> : <div>폴더가 아직 없습니다.</div>}
        <button className="btn" onClick={onChangeRoot}>
          {rootActionLabel ?? '폴더 변경'}
        </button>
      </div>
    </aside>
  )
}

function DiskFolderList({
  videos,
  parentPath,
  view,
  open,
  setOpen,
  onView
}: {
  videos: LibraryState['videos']
  parentPath: string | null
  view: View
  open: Record<string, boolean>
  setOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  onView: (view: View) => void
}) {
  const nodes = diskChildren(videos, parentPath)
  return (
    <>
      {nodes.map((folder) => {
        const kids = diskHasChildren(videos, folder.path)
        const expanded = open[folder.path] ?? false
        const active = view.type === 'disk' && view.path === folder.path
        return (
          <div key={folder.path} className="tree-node">
            <button
              className={`tree-item ${active ? 'active' : ''}`}
              onClick={() => onView({ type: 'disk', path: folder.path })}
            >
              <span className="tree-gutter">
                {parentPath ? <span className="elbow last" /> : null}
                <span
                  className={`chev ${kids ? '' : 'empty'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!kids) return
                    setOpen((s) => ({ ...s, [folder.path]: !expanded }))
                  }}
                >
                  {expanded ? '▾' : '▸'}
                </span>
              </span>
              <span className="nav-label">{folder.name}</span>
              <span className="count">{diskVideoCount(videos, folder.path)}</span>
            </button>
            {expanded && kids ? (
              <DiskFolderList
                videos={videos}
                parentPath={folder.path}
                view={view}
                open={open}
                setOpen={setOpen}
                onView={onView}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function FolderList({
  library,
  parentId,
  rails,
  view,
  open,
  setOpen,
  onView,
  onFolderMenu,
  onDropVideos
}: {
  library: LibraryState
  parentId: string | null
  rails: boolean[]
  view: View
  open: Record<string, boolean>
  setOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  onView: (view: View) => void
  onFolderMenu: (e: React.MouseEvent, folder: VirtualFolder) => void
  onDropVideos: (folderId: string | null, videoIds: string[]) => void
}) {
  const nodes = childrenOf(library.folders, parentId)
  return (
    <>
      {nodes.map((folder, index) => {
        const kids = childrenOf(library.folders, folder.id)
        const expanded = open[folder.id] ?? false
        const active = view.type === 'folder' && view.id === folder.id
        const isLast = index === nodes.length - 1
        return (
          <div key={folder.id} className="tree-node">
            <button
              className={`tree-item ${active ? 'active' : ''}`}
              onClick={() => onView({ type: 'folder', id: folder.id })}
              onContextMenu={(e) => {
                e.preventDefault()
                onFolderMenu(e, folder)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.currentTarget.classList.add('drop')
              }}
              onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('drop')
                const ids = readDragIds(e)
                if (ids.length) onDropVideos(folder.id, ids)
              }}
            >
              <span className="tree-gutter">
                {rails.map((draw, i) => (
                  <span key={i} className={`rail ${draw ? 'on' : ''}`} />
                ))}
                {parentId ? <span className={`elbow ${isLast ? 'last' : ''}`} /> : null}
                <span
                  className={`chev ${kids.length ? '' : 'empty'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!kids.length) return
                    setOpen((s) => ({ ...s, [folder.id]: !expanded }))
                  }}
                >
                  {expanded ? '▾' : '▸'}
                </span>
              </span>
              <span className="nav-label">{folder.name}</span>
              <span className="count">{folderVideoCount(library.videos, library.folders, folder.id)}</span>
            </button>
            {expanded && kids.length ? (
              <FolderList
                library={library}
                parentId={folder.id}
                rails={[...rails, !isLast]}
                view={view}
                open={open}
                setOpen={setOpen}
                onView={onView}
                onFolderMenu={onFolderMenu}
                onDropVideos={onDropVideos}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function readDragIds(e: React.DragEvent): string[] {
  try {
    return JSON.parse(e.dataTransfer.getData('application/x-video-ids') || '[]') as string[]
  } catch {
    return []
  }
}

function displayRoot(path: string): string {
  if (!path.startsWith('content://')) return path
  try {
    const decoded = decodeURIComponent(path)
    const tree = decoded.split('/tree/')[1] || decoded
    return tree.replace(/^primary:/, '').replace(/\//g, ' / ') || '선택한 폴더'
  } catch {
    return '선택한 폴더'
  }
}
