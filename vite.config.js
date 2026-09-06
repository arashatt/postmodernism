import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Files that live in public/ (Vite copies them verbatim, so they never show
// up in the bundle) but belong to the app shell all the same.
const STATIC_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './cover.png',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
]

// Emits dist/sw.js from src/sw.js with the hashed build output baked in.
// The version is a digest of that list plus the worker source, so a build
// that changes nothing emits a byte-identical worker and readers are not
// nagged to update.
function pwaServiceWorker() {
  return {
    name: 'ketab-pwa-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const hashed = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/') && !f.endsWith('.map'))
        .sort()
        .map((f) => `./${f}`)
      const shell = [...STATIC_SHELL, ...hashed]
      const source = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
      const version = createHash('sha256')
        .update(source)
        .update(shell.join('\n'))
        .digest('hex')
        .slice(0, 12)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: source
          .replace('__VERSION__', version)
          .replace('__SHELL__', JSON.stringify(shell, null, 2)),
      })
    },
  }
}

// base './' so the built site works from any directory on the server
export default defineConfig({
  base: './',
  plugins: [react(), pwaServiceWorker()],
})
