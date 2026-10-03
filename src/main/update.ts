import { app, net, shell } from 'electron'
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import path from 'path'
import { githubRepo } from '../shared/github'

export type UpdateOffer = {
  version: string
  notes: string
  pageUrl: string
  downloadUrl: string | null
}

type ReleaseAsset = { name?: string; browser_download_url?: string }
type ReleasePayload = {
  tag_name?: string
  body?: string | null
  html_url?: string
  assets?: ReleaseAsset[]
}

function currentVersion(): string {
  try {
    const raw = readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')
    const version = (JSON.parse(raw) as { version?: string }).version
    if (version) return version
  } catch {
    /* packaged or dev path may differ */
  }
  return app.getVersion()
}

function compareVersions(left: string, right: string): number {
  const a = left.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const b = right.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function setupAsset(assets: ReleaseAsset[]): string | null {
  const named = assets.find((asset) => /setup.*\.exe$/i.test(asset.name ?? ''))
  return named?.browser_download_url ?? assets.find((asset) => (asset.name ?? '').toLowerCase().endsWith('.exe'))?.browser_download_url ?? null
}

export async function checkForUpdate(): Promise<UpdateOffer | null> {
  if (!githubRepo.owner || !githubRepo.name) return null
  const response = await net.fetch(
    `https://api.github.com/repos/${githubRepo.owner}/${githubRepo.name}/releases/latest`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'MM-Player'
      }
    }
  )
  if (response.status === 404) return null
  if (!response.ok) return null
  const payload = (await response.json()) as ReleasePayload
  const version = (payload.tag_name ?? '').replace(/^v/, '')
  if (!version || compareVersions(version, currentVersion()) <= 0) return null
  return {
    version,
    notes: (payload.body ?? '').trim() || '이 버전의 변경 설명이 아직 없습니다.',
    pageUrl: payload.html_url ?? `https://github.com/${githubRepo.owner}/${githubRepo.name}/releases/latest`,
    downloadUrl: setupAsset(payload.assets ?? [])
  }
}

export async function installUpdate(offer: Pick<UpdateOffer, 'downloadUrl' | 'pageUrl'>): Promise<void> {
  if (!offer.downloadUrl) {
    await shell.openExternal(offer.pageUrl)
    return
  }
  const response = await net.fetch(offer.downloadUrl, { headers: { 'User-Agent': 'MM-Player' } })
  if (!response.ok) throw new Error('설치 파일을 받지 못했습니다.')
  const dest = path.join(app.getPath('temp'), 'MM-Player-Setup.exe')
  await writeFile(dest, Buffer.from(await response.arrayBuffer()))
  const child = spawn(dest, [], { detached: true, stdio: 'ignore' })
  child.unref()
  app.quit()
}
