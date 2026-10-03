import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    base: './',
    plugins: [
      react(),
      {
        name: 'strip-crossorigin',
        transformIndexHtml(html) {
          return html.replace(/\s+crossorigin(="[^"]*")?/g, '')
        }
      }
    ]
  }
})
