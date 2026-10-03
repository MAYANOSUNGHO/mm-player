import { readdir, stat } from 'fs/promises'
import path from 'path'
import type { ScanProgress } from '../shared/types'

export const VIDEO_EXTS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.wmv',
  '.webm',
  '.m4v',
  '.flv',
  '.ts',
  '.mts',
  '.m2ts',
  '.3gp',
  '.mpg',
  '.mpeg',
  '.m2v',
  '.asf',
  '.ogv',
  '.f4v',
  '.vob',
  '.divx'
])

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '$recycle.bin',
  'system volume information',
  '__pycache__',
  '.trash',
  'thumbs',
  '.tmp'
])

export type FoundVideo = {
  path: string
  name: string
  ext: string
  size: number
  mtime: number
}

export async function scanVideos(
  root: string,
  onProgress: (p: ScanProgress) => void,
  shouldStop: () => boolean
): Promise<FoundVideo[]> {
  const files: string[] = []
  const stack = [root]
  let lastEmit = 0

  while (stack.length) {
    if (shouldStop()) return []
    const dir = stack.pop() as string
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    const now = Date.now()
    if (now - lastEmit > 80) {
      onProgress({ walking: true, found: files.length, currentDir: dir })
      lastEmit = now
    }

    for (const ent of entries) {
      if (shouldStop()) return []
      if (ent.isSymbolicLink()) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name.toLowerCase())) continue
        if (ent.name.startsWith('.') && ent.name !== '.') continue
        stack.push(full)
        continue
      }
      if (!ent.isFile()) continue
      const ext = path.extname(ent.name).toLowerCase()
      if (!VIDEO_EXTS.has(ext)) continue
      files.push(full)
    }
  }

  onProgress({ walking: true, found: files.length, currentDir: root })

  const found: FoundVideo[] = []
  let i = 0
  const workers = 16

  await Promise.all(
    Array.from({ length: Math.min(workers, Math.max(files.length, 1)) }, async () => {
      while (i < files.length) {
        if (shouldStop()) return
        const idx = i++
        const filePath = files[idx]
        try {
          const s = await stat(filePath)
          if (!s.isFile() || s.size < 10_000) continue
          found.push({
            path: filePath,
            name: path.basename(filePath),
            ext: path.extname(filePath).toLowerCase(),
            size: s.size,
            mtime: s.mtimeMs
          })
        } catch {
          continue
        }
        if (found.length % 40 === 0) {
          onProgress({ walking: false, found: found.length, currentDir: path.dirname(filePath) })
        }
      }
    })
  )

  return found
}
