import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryState, ScanProgress, View, VirtualFolder } from '../../shared/types'
import type { UpdateOffer } from '../../shared/api'
import ContextMenu, { type MenuItem } from './components/ContextMenu'
import { ConfirmModal, DeleteChoiceModal, PromptModal } from './components/Modals'
import Player from './components/Player'
import Sidebar from './components/Sidebar'
import VideoGrid, { forgetThumbFailures } from './components/VideoGrid'
import { childrenOf, folderPath, sortVideos, type SortDir, type SortKey, videosInView } from './lib/library'

type Modal =
  | { kind: 'folder-create'; parentId: string | null; thenMove?: string[] }
  | { kind: 'folder-rename'; id: string; name: string }
  | { kind: 'folder-delete'; id: string; name: string }
  | { kind: 'tag-create'; thenToggle?: string[] }
  | { kind: 'tag-rename'; id: string; name: string }
  | { kind: 'tag-delete'; id: string; name: string }
  | { kind: 'playlist-create'; thenAdd?: string[] }
  | { kind: 'playlist-rename'; id: string; name: string }
  | { kind: 'playlist-delete'; id: string; name: string }

const emptyLibrary: LibraryState = {
  rootPath: null,
  lastScanAt: null,
  folders: [],
  tags: [],
  playlists: [],
  videos: []
}

const SIDEBAR_MIN = 196
const SIDEBAR_MAX = 560
const SIDEBAR_KEY = 'video-organizer-sidebar-width'
const DEEP_FOLDERS_KEY = 'video-organizer-include-deep-folders'

function readSidebarWidth(): number {
  const n = Number(localStorage.getItem(SIDEBAR_KEY))
  if (!Number.isFinite(n)) return 260
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n))
}

function readDeepFolders(): boolean {
  return localStorage.getItem(DEEP_FOLDERS_KEY) !== '0'
}

export default function App() {
  const [library, setLibrary] = useState<LibraryState>(emptyLibrary)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<View>({ type: 'all' })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState(0)
  const [density, setDensity] = useState<'s' | 'm' | 'l'>('m')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [includeDeepFolders, setIncludeDeepFolders] = useState(readDeepFolders)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [playQueue, setPlayQueue] = useState<string[] | null>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'library' | 'playlists'>('library')
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const [thumbEpoch, setThumbEpoch] = useState(0)
  const [thumbing, setThumbing] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const [updateOffer, setUpdateOffer] = useState<UpdateOffer | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const sidebarWidthRef = useRef(sidebarWidth)
  const resizingRef = useRef(false)
  const marqueeGuard = useRef(false)
  const viewRef = useRef(view)
  sidebarWidthRef.current = sidebarWidth
  viewRef.current = view

  const apply = useCallback((s: LibraryState) => {
    setLibrary(s)
    setSelected((prev) => {
      const ids = new Set(s.videos.map((v) => v.id))
      return new Set([...prev].filter((id) => ids.has(id)))
    })
  }, [])

  useEffect(() => {
    if (!window.api) return
    let cancelled = false
    const off = window.api.onScanProgress(setProgress)
    void (async () => {
      const s = await window.api.getLibrary()
      if (cancelled) return
      setLibrary(s)
      setReady(true)
      if (!s.rootPath || !s.videos.some((v) => v.missing)) return
      setScanning(true)
      try {
        const healed = await window.api.healMissing()
        if (!cancelled) setLibrary(healed)
      } finally {
        if (!cancelled) setScanning(false)
      }
    })()
    return () => {
      cancelled = true
      off()
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void window.api.checkUpdate().then((offer) => {
      if (!cancelled && offer) setUpdateOffer(offer)
    })
    return () => {
      cancelled = true
    }
  }, [ready])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!resizingRef.current) return
      const max = Math.min(SIDEBAR_MAX, Math.floor(window.innerWidth * 0.55))
      const next = Math.min(max, Math.max(SIDEBAR_MIN, e.clientX))
      setSidebarWidth(next)
    }
    const onUp = (): void => {
      if (!resizingRef.current) return
      resizingRef.current = false
      setResizing(false)
      localStorage.setItem(SIDEBAR_KEY, String(sidebarWidthRef.current))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const visible = useMemo(() => {
    const list = videosInView(library, view, search, { includeDeepFolders })
    const key = view.type === 'playlist' ? sortKey : sortKey === 'playlist' ? 'name' : sortKey
    return sortVideos(list, key, sortDir)
  }, [library, view, search, sortKey, sortDir, includeDeepFolders])
  const missing = library.videos.filter((v) => v.missing).length

  const scanRoot = async (root: string | null): Promise<void> => {
    if (!root) return
    setScanning(true)
    try {
      apply(await window.api.setRootAndScan(root))
      setView({ type: 'all' })
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }

  const pickRoot = async (): Promise<void> => {
    const folder = await window.api.pickFolder()
    await scanRoot(folder)
  }

  const rescan = async (): Promise<void> => {
    if (!library.rootPath) return pickRoot()
    setScanning(true)
    try {
      apply(await window.api.rescan())
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }

  const resetFolderThumbs = async (): Promise<void> => {
    if (view.type !== 'folder') return
    const ids = visible.filter((v) => !v.missing).map((v) => v.id)
    if (!ids.length) return
    setThumbing(true)
    try {
      forgetThumbFailures(ids)
      apply(await window.api.clearThumbs(ids))
      setThumbEpoch((n) => n + 1)
    } finally {
      setThumbing(false)
    }
  }

  useEffect(() => {
    const over = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent): void => {
      if (!e.dataTransfer?.files.length || !e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      const paths: string[] = []
      for (const file of e.dataTransfer.files) {
        try {
          const filePath = window.api.pathForFile(file)
          if (filePath) paths.push(filePath)
        } catch {
          /* ignore */
        }
      }
      if (!paths.length) return
      const current = viewRef.current
      const folderId = current.type === 'folder' ? current.id : null
      void window.api.importVideos(paths, folderId).then(apply)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [apply])

  const onSelect = (e: React.MouseEvent, id: string, index: number): void => {
    e.stopPropagation()
    if (e.shiftKey) {
      const start = Math.min(anchor, index)
      const end = Math.max(anchor, index)
      setSelected(new Set(visible.slice(start, end + 1).map((v) => v.id)))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      setAnchor(index)
      return
    }
    setSelected(new Set([id]))
    setAnchor(index)
  }

  const targetIds = (id: string): string[] => (selected.has(id) ? [...selected] : [id])

  const moveVideos = async (ids: string[], folderId: string | null): Promise<void> => {
    apply(await window.api.moveVideos(ids, folderId))
  }

  const startPlay = (id: string, queue: string[] | null = null): void => {
    const video = library.videos.find((v) => v.id === id)
    if (video?.missing) {
      void window.api.relocateVideo(id).then((s) => {
        apply(s)
        const next = s.videos.find((v) => v.id === id)
        if (next && !next.missing) {
          setPlayQueue(queue)
          setPlayerId(id)
        }
      })
      return
    }
    setPlayQueue(queue)
    setPlayerId(id)
  }

  const videoMenu = (ids: string[]): MenuItem[] => {
    const targets = library.videos.filter((v) => ids.includes(v.id))
    const allIn = (tagId: string): boolean => targets.every((v) => v.tagIds.includes(tagId))
    const tagItems: MenuItem[] = [...library.tags]
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .map((tag) => ({
        type: 'item',
        label: tag.name,
        checked: allIn(tag.id),
        onSelect: () => void window.api.toggleTag(ids, tag.id).then(apply)
      }))
    if (tagItems.length) tagItems.push({ type: 'sep' })
    tagItems.push({
      type: 'item',
      label: '새 태그...',
      onSelect: () => setModal({ kind: 'tag-create', thenToggle: ids })
    })

    const tree = buildFolderMenu(library.folders, null, ids, targets, moveVideos)
    const folderItems: MenuItem[] = [
      {
        type: 'item',
        label: '미분류',
        checked: targets.every((v) => !v.folderId),
        onSelect: () => void moveVideos(ids, null)
      },
      ...(tree.length ? ([{ type: 'sep' }, ...tree] as MenuItem[]) : []),
      { type: 'sep' },
      {
        type: 'item',
        label: '새 폴더...',
        onSelect: () => setModal({ kind: 'folder-create', parentId: null, thenMove: ids })
      }
    ]

    const playlistItems: MenuItem[] = [...(library.playlists ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .map((playlist) => ({
        type: 'item' as const,
        label: playlist.name,
        checked: ids.every((id) => playlist.videoIds.includes(id)),
        onSelect: () => void window.api.addToPlaylist(playlist.id, ids).then(apply)
      }))
    if (playlistItems.length) playlistItems.push({ type: 'sep' })
    playlistItems.push({
      type: 'item',
      label: '새 재생목록...',
      onSelect: () => setModal({ kind: 'playlist-create', thenAdd: ids })
    })

    const items: MenuItem[] = [
      {
        type: 'item',
        label: targets.some((v) => v.missing) ? '경로 다시 지정' : '재생',
        onSelect: () =>
          startPlay(ids[0], view.type === 'playlist' ? visible.map((v) => v.id) : null)
      },
      {
        type: 'item',
        label: '기본 플레이어로 열기',
        onSelect: () => void window.api.openExternal(ids[0])
      },
      { type: 'sep' },
      { type: 'item', label: '재생목록에 추가', submenu: playlistItems },
      { type: 'item', label: '태그에 포함하기', submenu: tagItems },
      { type: 'item', label: '폴더로 옮기기', submenu: folderItems }
    ]
    if (view.type === 'playlist') {
      items.push({ type: 'sep' })
      items.push({
        type: 'item',
        label: '이 재생목록에서 제거',
        onSelect: () => void window.api.removeFromPlaylist(view.id, ids).then(apply)
      })
    }
    items.push({ type: 'sep' })
    items.push({
      type: 'item',
      label: '탐색기에서 표시',
      onSelect: () => void window.api.showInFolder(ids[0])
    })
    items.push({
      type: 'item',
      label: '경로 복사',
      onSelect: () => void window.api.copyPath(ids[0])
    })
    items.push({ type: 'sep' })
    items.push({
      type: 'item',
      label: ids.length > 1 ? `삭제 (${ids.length})` : '삭제',
      onSelect: () => setPendingDelete(ids)
    })
    return items
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape') {
        setMenu(null)
        setPlayerId(null)
        setPlayQueue(null)
        setSelected(new Set())
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
        e.preventDefault()
        setSelected(new Set(visible.map((v) => v.id)))
      }
      if (e.key === 'Enter' && !typing && selected.size === 1) {
        const id = [...selected][0]
        startPlay(id, view.type === 'playlist' ? visible.map((v) => v.id) : null)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !typing) {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.search input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, selected, view])

  const title = viewTitle(library, view)
  const crumbs = view.type === 'folder' ? folderPath(library.folders, view.id) : []
  const playbackList = playQueue ?? visible.map((v) => v.id)
  const playerIndex = playerId ? playbackList.indexOf(playerId) : -1

  if (!ready) {
    return (
      <div className="app">
        <div className="titlebar">
          <div className="titlebar-mark" />
          <h1>MM Player</h1>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-mark" />
        <h1>MM Player</h1>
      </header>
      <div className={`body ${resizing ? 'resizing' : ''}`}>
        {library.rootPath ? (
          <Sidebar
            library={library}
            view={view}
            width={sidebarWidth}
            tab={sidebarTab}
            onTab={(next) => {
              setSidebarTab(next)
              setSelected(new Set())
              if (next === 'playlists') {
                if (view.type !== 'playlist' && view.type !== 'playlists') {
                  const first = (library.playlists ?? [])[0]
                  setView(first ? { type: 'playlist', id: first.id } : { type: 'playlists' })
                  setSortKey('playlist')
                }
              } else if (view.type === 'playlist' || view.type === 'playlists') {
                setView({ type: 'all' })
                setSortKey((k) => (k === 'playlist' ? 'name' : k))
              }
            }}
            onView={(next) => {
              setView(next)
              setSidebarTab(next.type === 'playlist' || next.type === 'playlists' ? 'playlists' : 'library')
              setSelected(new Set())
              if (next.type === 'playlist' || next.type === 'playlists') setSortKey('playlist')
              else setSortKey((k) => (k === 'playlist' ? 'name' : k))
            }}
            onCreateFolder={(parentId) => setModal({ kind: 'folder-create', parentId })}
            onCreateTag={() => setModal({ kind: 'tag-create' })}
            onCreatePlaylist={() => setModal({ kind: 'playlist-create' })}
            onFolderMenu={(e, folder) => {
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    type: 'item',
                    label: '새 하위 폴더',
                    onSelect: () => setModal({ kind: 'folder-create', parentId: folder.id })
                  },
                  {
                    type: 'item',
                    label: '이름 바꾸기',
                    onSelect: () => setModal({ kind: 'folder-rename', id: folder.id, name: folder.name })
                  },
                  { type: 'sep' },
                  {
                    type: 'item',
                    label: '폴더 삭제',
                    onSelect: () => setModal({ kind: 'folder-delete', id: folder.id, name: folder.name })
                  }
                ]
              })
            }}
            onTagMenu={(e, id, name) => {
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    type: 'item',
                    label: '이름 바꾸기',
                    onSelect: () => setModal({ kind: 'tag-rename', id, name })
                  },
                  { type: 'sep' },
                  {
                    type: 'item',
                    label: '태그 삭제',
                    onSelect: () => setModal({ kind: 'tag-delete', id, name })
                  }
                ]
              })
            }}
            onPlaylistMenu={(e, playlist) => {
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    type: 'item',
                    label: '재생',
                    disabled: playlist.videoIds.length === 0,
                    onSelect: () => {
                      const ids = videosInView(library, { type: 'playlist', id: playlist.id }, '').map((v) => v.id)
                      if (ids[0]) startPlay(ids[0], ids)
                    }
                  },
                  {
                    type: 'item',
                    label: '이름 바꾸기',
                    onSelect: () => setModal({ kind: 'playlist-rename', id: playlist.id, name: playlist.name })
                  },
                  { type: 'sep' },
                  {
                    type: 'item',
                    label: '재생목록 삭제',
                    onSelect: () => setModal({ kind: 'playlist-delete', id: playlist.id, name: playlist.name })
                  }
                ]
              })
            }}
            onDropVideos={(folderId, ids) => void moveVideos(ids, folderId)}
            onDropPlaylist={(playlistId, ids) => void window.api.addToPlaylist(playlistId, ids).then(apply)}
            onChangeRoot={() => void pickRoot()}
            rootActionLabel="폴더 변경"
          />
        ) : null}
        {library.rootPath ? (
          <div
            className={`splitter ${resizing ? 'active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault()
              resizingRef.current = true
              setResizing(true)
            }}
          />
        ) : null}
        <section className="main">
          {!library.rootPath ? (
            <div className="empty">
              <div className="empty-card">
                <div className="kicker">Library</div>
                <h2>영상을 정리하세요.</h2>
                <p>
                  폴더를 고르면 하위 경로까지 영상을 찾아 가져옵니다. 실제 파일은 이동하거나 복사하지 않고, 이 프로그램 안의 가상 폴더와 태그만 사용합니다.
                </p>
                <button className="btn solid" onClick={() => void pickRoot()} disabled={scanning}>
                  {scanning ? '불러오는 중...' : '폴더 선택'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="toolbar">
                <div className="crumb">
                  {view.type === 'folder' && crumbs.length ? (
                    <>
                      <button onClick={() => setView({ type: 'all' })}>전체</button>
                      {crumbs.map((folder, i) => (
                        <span key={folder.id} style={{ display: 'flex', gap: 6, minWidth: 0 }}>
                          <span className="sep">/</span>
                          {i === crumbs.length - 1 ? (
                            <strong>{folder.name}</strong>
                          ) : (
                            <button onClick={() => setView({ type: 'folder', id: folder.id })}>{folder.name}</button>
                          )}
                        </span>
                      ))}
                    </>
                  ) : (
                    <strong>{title}</strong>
                  )}
                </div>
                {view.type === 'playlist' && visible.length ? (
                  <button
                    className="btn solid"
                    onClick={() => startPlay(visible[0].id, visible.map((v) => v.id))}
                  >
                    재생목록 재생
                  </button>
                ) : null}
                <div className="sort" title="정렬">
                  {view.type === 'playlist' ? (
                    <button
                      className={sortKey === 'playlist' ? 'on' : ''}
                      onClick={() => {
                        setSortKey('playlist')
                        setSortDir('asc')
                      }}
                    >
                      목록
                    </button>
                  ) : null}
                  {(
                    [
                      ['name', '이름', 'asc'],
                      ['mtime', '날짜', 'desc'],
                      ['size', '크기', 'desc'],
                      ['duration', '길이', 'desc']
                    ] as Array<[SortKey, string, SortDir]>
                  ).map(([key, label, initialDir]) => (
                    <button
                      key={key}
                      className={sortKey === key ? 'on' : ''}
                      onClick={() => {
                        if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                        else {
                          setSortKey(key)
                          setSortDir(initialDir)
                        }
                      }}
                    >
                      {label}
                      {sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  ))}
                </div>
                <div className="sort" title="상위 폴더에서 하위 폴더 영상까지 함께 보기">
                  <button
                    className={includeDeepFolders ? 'on' : ''}
                    onClick={() => {
                      setIncludeDeepFolders((on) => {
                        const next = !on
                        localStorage.setItem(DEEP_FOLDERS_KEY, next ? '1' : '0')
                        return next
                      })
                    }}
                  >
                    하위폴더까지 보기
                  </button>
                </div>
                <div className="density" title="아이콘 크기">
                  <button className={density === 's' ? 'on' : ''} onClick={() => setDensity('s')}>
                    ▦
                  </button>
                  <button className={density === 'm' ? 'on' : ''} onClick={() => setDensity('m')}>
                    ▢
                  </button>
                  <button className={density === 'l' ? 'on' : ''} onClick={() => setDensity('l')}>
                    □
                  </button>
                </div>
                <button className="btn" onClick={() => void rescan()} disabled={scanning || thumbing}>
                  {scanning ? '스캔 중' : '다시 스캔'}
                </button>
                <button
                  className="btn"
                  title={view.type === 'folder' ? '이 가상 폴더에 보이는 영상만 썸네일을 다시 만듭니다' : '가상 폴더를 연 뒤 사용할 수 있습니다'}
                  onClick={() => void resetFolderThumbs()}
                  disabled={scanning || thumbing || view.type !== 'folder' || !visible.some((v) => !v.missing)}
                >
                  {thumbing ? '썸네일 준비' : '썸네일 재설정'}
                </button>
                <div className="search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </svg>
                  <input
                    value={search}
                    placeholder="제목, #태그, 경로 검색"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div
                className="grid-wrap"
                onClick={(e) => {
                  if (marqueeGuard.current) {
                    marqueeGuard.current = false
                    return
                  }
                  if ((e.target as HTMLElement).closest('.card, button, input, a')) return
                  setSelected(new Set())
                }}
              >
                {view.type === 'playlists' ? (
                  <div className="empty">
                    <div className="empty-card">
                      <div className="kicker">Playlist</div>
                      <h2>재생목록을 만드세요.</h2>
                      <p>왼쪽 + 로 만들거나, 영상을 길게 누르거나 ⋮ 메뉴로 재생목록에 추가할 수 있습니다.</p>
                    </div>
                  </div>
                ) : (
                  <VideoGrid
                    library={library}
                    videos={visible}
                    selected={selected}
                    density={density}
                    emptyText={
                      view.type === 'playlist'
                        ? '이 재생목록이 비어 있습니다. 영상을 우클릭해 추가하세요.'
                        : undefined
                    }
                    onSelect={onSelect}
                    onOpen={(id) =>
                      startPlay(id, view.type === 'playlist' ? visible.map((v) => v.id) : null)
                    }
                    onContext={(e, id) => {
                      const ids = targetIds(id)
                      if (!selected.has(id)) setSelected(new Set([id]))
                      setMenu({ x: e.clientX, y: e.clientY, items: videoMenu(ids) })
                    }}
                    onMeta={apply}
                    thumbEpoch={thumbEpoch}
                    onChangeSelection={setSelected}
                    onMarqueeDone={() => {
                      marqueeGuard.current = true
                    }}
                  />
                )}
              </div>
              <footer className="status">
                <span className="progress-strip">
                  {scanning
                    ? `스캔 중 · ${progress?.found ?? 0}개 발견${progress?.currentDir ? ` · ${progress.currentDir}` : ''}`
                    : `${visible.length.toLocaleString('ko-KR')}개 표시 · 전체 ${library.videos.filter((v) => !v.missing).length.toLocaleString('ko-KR')}개${selected.size ? ` · ${selected.size}개 선택` : ''}`}
                </span>
                <span>
                  {missing ? (
                    <button
                      className="btn"
                      style={{ height: 22, padding: '0 8px', fontSize: 11 }}
                      onClick={() => void window.api.purgeMissing().then(apply)}
                    >
                      없는 파일 {missing}개 정리
                    </button>
                  ) : (
                    '실제 파일은 변경되지 않습니다'
                  )}
                </span>
              </footer>
            </>
          )}
        </section>
      </div>

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      {pendingDelete ? (
        <DeleteChoiceModal
          count={pendingDelete.length}
          onClose={() => setPendingDelete(null)}
          onLibrary={() => {
            const ids = pendingDelete
            setPendingDelete(null)
            setSelected(new Set())
            void window.api.removeVideos(ids).then(apply)
          }}
          onDisk={() => {
            const ids = pendingDelete
            setPendingDelete(null)
            setSelected(new Set())
            void window.api.deleteVideoFiles(ids).then(apply)
          }}
        />
      ) : null}
      {updateOffer ? (
        <div className="modal-back">
          <div className="modal update-modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>업데이트 하시겠습니까?</h3>
            <p>새 버전 {updateOffer.version}이 있습니다. 아래는 GitHub 릴리스에 적힌 변경 내용입니다.</p>
            <pre className="release-notes">{updateOffer.notes}</pre>
            {updateError ? <p>{updateError}</p> : null}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setUpdateOffer(null)} disabled={updating}>
                다음에
              </button>
              <button
                type="button"
                className="btn solid"
                disabled={updating}
                onClick={() => {
                  setUpdating(true)
                  setUpdateError('')
                  void window.api
                    .installUpdate(updateOffer)
                    .catch((err: unknown) => {
                      setUpdating(false)
                      setUpdateError(err instanceof Error ? err.message : '업데이트를 시작하지 못했습니다.')
                    })
                }}
              >
                {updating ? '받는 중...' : '네'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {playerId ? (
        <Player
          library={library}
          videoId={playerId}
          autoNext={Boolean(playQueue)}
          position={
            playQueue && playerIndex >= 0 ? `${playerIndex + 1} / ${playbackList.length}` : undefined
          }
          onClose={() => {
            setPlayerId(null)
            setPlayQueue(null)
          }}
          onPrev={() => {
            if (playerIndex > 0) setPlayerId(playbackList[playerIndex - 1])
          }}
          onNext={() => {
            if (playerIndex >= 0 && playerIndex < playbackList.length - 1) {
              setPlayerId(playbackList[playerIndex + 1])
            }
          }}
          onEnded={() => {
            if (!playQueue) return
            if (playerIndex >= 0 && playerIndex < playbackList.length - 1) {
              setPlayerId(playbackList[playerIndex + 1])
              return
            }
            setPlayerId(null)
            setPlayQueue(null)
          }}
        />
      ) : null}

      {modal?.kind === 'folder-create' ? (
        <PromptModal
          title="가상 폴더 만들기"
          description="디스크에는 폴더가 생기지 않습니다. 이 프로그램 안에서만 보입니다."
          label="폴더 이름"
          initial="새 폴더"
          confirmLabel="만들기"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            void window.api.createFolder(name, modal.parentId).then(async (s) => {
              const created = s.folders.find(
                (f) => f.parentId === modal.parentId && !library.folders.some((p) => p.id === f.id)
              )
              apply(s)
              if (created && modal.thenMove?.length) {
                apply(await window.api.moveVideos(modal.thenMove, created.id))
                setView({ type: 'folder', id: created.id })
              }
              setModal(null)
            })
          }}
        />
      ) : null}
      {modal?.kind === 'folder-rename' ? (
        <PromptModal
          title="폴더 이름 바꾸기"
          label="폴더 이름"
          initial={modal.name}
          confirmLabel="저장"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            void window.api.renameFolder(modal.id, name).then((s) => {
              apply(s)
              setModal(null)
            })
          }}
        />
      ) : null}
      {modal?.kind === 'folder-delete' ? (
        <ConfirmModal
          title="가상 폴더 삭제"
          description={`‘${modal.name}’ 폴더와 하위 가상 폴더만 삭제합니다. 영상 파일은 디스크에 그대로 남고, 안의 영상은 미분류로 돌아갑니다.`}
          confirmLabel="삭제"
          onClose={() => setModal(null)}
          onConfirm={() => {
            void window.api.deleteFolder(modal.id).then((s) => {
              apply(s)
              if (view.type === 'folder' && view.id === modal.id) setView({ type: 'all' })
              setModal(null)
            })
          }}
        />
      ) : null}
      {modal?.kind === 'tag-create' ? (
        <PromptModal
          title="태그 만들기"
          label="태그 이름"
          initial=""
          confirmLabel="만들기"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            void window.api.createTag(name).then(async (s) => {
              const created = s.tags.find((t) => !library.tags.some((prev) => prev.id === t.id)) ||
                s.tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
              apply(s)
              if (created && modal.thenToggle?.length) {
                apply(await window.api.toggleTag(modal.thenToggle, created.id))
              }
              setModal(null)
            })
          }}
        />
      ) : null}
      {modal?.kind === 'tag-rename' ? (
        <PromptModal
          title="태그 이름 바꾸기"
          label="태그 이름"
          initial={modal.name}
          confirmLabel="저장"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            void window.api.renameTag(modal.id, name).then((s) => {
              apply(s)
              setModal(null)
            })
          }}
        />
      ) : null}
      {modal?.kind === 'tag-delete' ? (
        <ConfirmModal
          title="태그 삭제"
          description={`‘${modal.name}’ 태그를 지웁니다. 영상 파일에는 아무 변화가 없습니다.`}
          confirmLabel="삭제"
          onClose={() => setModal(null)}
          onConfirm={() => {
            void window.api.deleteTag(modal.id).then((s) => {
              apply(s)
              if (view.type === 'tag' && view.id === modal.id) setView({ type: 'all' })
              setModal(null)
            })
          }}
        />
      ) : null}
      {modal?.kind === 'playlist-create' ? (
        <PromptModal
          title="재생목록 만들기"
          label="재생목록 이름"
          initial="새 재생목록"
          confirmLabel="만들기"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            void window.api.createPlaylist(name).then(async (s) => {
              const created = s.playlists.find((p) => !library.playlists.some((prev) => prev.id === p.id))
              apply(s)
              if (created && modal.thenAdd?.length) {
                apply(await window.api.addToPlaylist(created.id, modal.thenAdd))
              }
              if (created) {
                setSidebarTab('playlists')
                setView({ type: 'playlist', id: created.id })
              }
              setModal(null)
            })
          }}
        />
      ) : null}
      {modal?.kind === 'playlist-rename' ? (
        <PromptModal
          title="재생목록 이름 바꾸기"
          label="재생목록 이름"
          initial={modal.name}
          confirmLabel="저장"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            void window.api.renamePlaylist(modal.id, name).then((s) => {
              apply(s)
              setModal(null)
            })
          }}
        />
      ) : null}
      {modal?.kind === 'playlist-delete' ? (
        <ConfirmModal
          title="재생목록 삭제"
          description={`‘${modal.name}’ 재생목록만 지웁니다. 영상 파일에는 아무 변화가 없습니다.`}
          confirmLabel="삭제"
          onClose={() => setModal(null)}
          onConfirm={() => {
            void window.api.deletePlaylist(modal.id).then((s) => {
              apply(s)
              if (view.type === 'playlist' && view.id === modal.id) setView({ type: 'playlists' })
              setModal(null)
            })
          }}
        />
      ) : null}
    </div>
  )
}

function viewTitle(library: LibraryState, view: View): string {
  if (view.type === 'all') return '전체 영상'
  if (view.type === 'uncategorized') return '미분류'
  if (view.type === 'folder') return library.folders.find((f) => f.id === view.id)?.name ?? '폴더'
  if (view.type === 'playlists') return '재생목록'
  if (view.type === 'playlist') return (library.playlists ?? []).find((p) => p.id === view.id)?.name ?? '재생목록'
  return `#${library.tags.find((t) => t.id === view.id)?.name ?? '태그'}`
}

function buildFolderMenu(
  folders: VirtualFolder[],
  parentId: string | null,
  ids: string[],
  targets: { folderId: string | null }[],
  moveVideos: (ids: string[], folderId: string | null) => Promise<void>
): MenuItem[] {
  return childrenOf(folders, parentId).map((folder) => {
    const kids = childrenOf(folders, folder.id)
    return {
      type: 'item',
      label: folder.name,
      checked: targets.every((v) => v.folderId === folder.id),
      submenu: kids.length ? buildFolderMenu(folders, folder.id, ids, targets, moveVideos) : undefined,
      onSelect: () => void moveVideos(ids, folder.id)
    }
  })
}
