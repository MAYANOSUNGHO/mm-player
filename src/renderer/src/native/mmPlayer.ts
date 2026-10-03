import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { ScanProgress } from '../../../shared/types'

export type FoundScanVideo = {
  id: string
  path: string
  name: string
  ext: string
  size: number
  mtime: number
  diskFolder?: string | null
  duration?: number | null
  width?: number | null
  height?: number | null
}

export interface MMPlayerNative {
  pickFolder: () => Promise<{ uri?: string; name?: string; granted?: boolean }>
  getRoot: () => Promise<{ uri?: string; name?: string }>
  scan: (options?: { uri?: string }) => Promise<{ videos: FoundScanVideo[] }>
  startServer: () => Promise<{ port: number }>
  captureThumb: (options: { id: string }) => Promise<{
    ok: boolean
    url?: string
    path?: string
    duration?: number
    width?: number
    height?: number
  }>
  saveThumbFile: (options: { id: string; dataUrl: string }) => Promise<{ url: string; path?: string }>
  hasThumb: (options: { id: string }) => Promise<{ url?: string | null; path?: string | null }>
  openExternal: (options: { id: string }) => Promise<void>
  showInFolder: (options: { id: string }) => Promise<void>
  copyPath: (options: { id: string }) => Promise<void>
  getInsets: () => Promise<{ top: number; bottom: number; status?: number; webTop?: number }>
  addListener: (
    eventName: 'scanProgress',
    listenerFunc: (p: ScanProgress) => void
  ) => Promise<PluginListenerHandle>
}

export const MMPlayer = registerPlugin<MMPlayerNative>('MMPlayer')
