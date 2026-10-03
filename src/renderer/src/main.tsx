import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import { applyAndroidInsets, createAndroidApi } from './lib/androidApi'
import './index.css'

function showBootError(err: unknown): void {
  const root = document.getElementById('root')
  if (!root) return
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  root.innerHTML = `<div style="padding:28px;color:#f2f2f2;font-family:sans-serif;line-height:1.5">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.6;margin-bottom:10px">MM Player</div>
    <h2 style="margin:0 0 12px;font-size:20px">앱을 시작하지 못했습니다.</h2>
    <pre style="white-space:pre-wrap;font-size:12px;opacity:.8">${message.replace(/</g, '&lt;')}</pre>
  </div>`
}

window.addEventListener('error', (event) => {
  if (!document.getElementById('root')?.dataset.booted) showBootError(event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  if (!document.getElementById('root')?.dataset.booted) showBootError(event.reason)
})

async function boot(): Promise<void> {
  const el = document.getElementById('root')
  if (!el) throw new Error('root 없음')
  el.textContent = '불러오는 중...'
  if (Capacitor.isNativePlatform()) {
    document.documentElement.classList.add('android')
    window.api = await createAndroidApi()
    const syncInsets = (): void => {
      void applyAndroidInsets()
    }
    syncInsets()
    window.setTimeout(syncInsets, 80)
    window.setTimeout(syncInsets, 400)
    window.visualViewport?.addEventListener('resize', syncInsets)
  }
  el.dataset.booted = '1'
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot().catch(showBootError)
