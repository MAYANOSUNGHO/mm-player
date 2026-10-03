import React from 'react'

const WIDTH = { s: '148px', m: '200px', l: '268px' }

export type DiskFolderItem = {
  path: string
  name: string
  count: number
}

export default function FolderExplorer({
  folders,
  density,
  onOpen
}: {
  folders: DiskFolderItem[]
  density: 's' | 'm' | 'l'
  onOpen: (path: string) => void
}) {
  if (!folders.length) return null
  return (
    <div className="grid folder-grid" style={{ ['--card-w' as string]: WIDTH[density] }}>
      {folders.map((folder) => (
        <button
          key={folder.path}
          type="button"
          className="card folder-card"
          onClick={() => onOpen(folder.path)}
        >
          <div className="thumb folder-thumb" aria-hidden>
            <span className="folder-glyph" />
          </div>
          <div className="card-title">{folder.name}</div>
          <div className="card-meta">{folder.count}개 영상</div>
        </button>
      ))}
    </div>
  )
}
