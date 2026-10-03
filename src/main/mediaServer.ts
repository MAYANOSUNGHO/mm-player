import { createReadStream, existsSync, statSync } from 'fs'
import http from 'http'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

export type MediaLookup = {
  videoPath: (id: string) => string | undefined
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.f4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.divx': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.asf': 'video/x-ms-wmv',
  '.ogv': 'video/ogg',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.m2v': 'video/mpeg',
  '.vob': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.flv': 'video/x-flv'
}

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'all' | null {
  if (!header) return 'all'
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match) return null
  const hasStart = match[1] !== ''
  const hasEnd = match[2] !== ''
  if (!hasStart && !hasEnd) return null
  if (!hasStart) {
    const suffix = Number(match[2])
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const end = hasEnd ? Math.min(Number(match[2]), size - 1) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return null
  return { start, end }
}

function sendMedia(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  if (!existsSync(filePath)) {
    res.writeHead(404)
    res.end('Not Found')
    return
  }

  const size = statSync(filePath).size
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type',
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeFor(filePath),
    'Cache-Control': 'no-store'
  }

  const range = parseRange(headerValue(req.headers.range), size)
  if (range === null) {
    res.writeHead(416, { ...cors, 'Content-Range': `bytes */${size}` })
    res.end()
    return
  }

  const start = range === 'all' ? 0 : range.start
  const end = range === 'all' ? Math.max(0, size - 1) : range.end
  const length = size === 0 ? 0 : end - start + 1
  const status = range === 'all' ? 200 : 206
  const headers: Record<string, string | number> = { ...cors, 'Content-Length': length }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`

  res.writeHead(status, headers)
  if (req.method === 'HEAD' || size === 0) {
    res.end()
    return
  }

  const stream = createReadStream(filePath, { start, end })
  const stop = (): void => {
    stream.destroy()
  }
  stream.on('error', () => {
    stop()
    if (!res.writableEnded) res.end()
  })
  req.on('close', stop)
  stream.pipe(res)
}

export function startMediaServer(lookup: MediaLookup): Promise<{ port: number; close: () => void }> {
  const server = http.createServer((req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
          'Access-Control-Allow-Headers': 'Range'
        })
        res.end()
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }

      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length !== 2 || parts[0] !== 'video' || !/^[a-f0-9]{40}$/i.test(parts[1])) {
        res.writeHead(404)
        res.end()
        return
      }

      const filePath = lookup.videoPath(decodeURIComponent(parts[1]))
      if (!filePath) {
        res.writeHead(404)
        res.end()
        return
      }
      sendMedia(req, res, filePath)
    } catch {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('media server failed'))
        return
      }
      resolve({
        port: addr.port,
        close: () => {
          server.close()
        }
      })
    })
  })
}
