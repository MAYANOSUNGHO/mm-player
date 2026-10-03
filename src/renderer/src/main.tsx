import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
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

function boot(): void {
  const el = document.getElementById('root')
  if (!el) throw new Error('root 없음')
  el.dataset.booted = '1'
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

try {
  boot()
} catch (err) {
  showBootError(err)
}
