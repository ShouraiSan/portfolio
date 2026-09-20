import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import worker from './worker/src/index.js'

const localPhotoSecret = randomBytes(32).toString('hex')
const remotePhotoPreview = 'http://127.0.0.1:8788'

function localPhotoApi() {
  return {
    name: 'local-photo-api',
    configureServer(server) {
      server.middlewares.use('/photo', async (req, res) => {
        const requestUrl = new URL(req.originalUrl || req.url, 'http://127.0.0.1:5173')
        const headers = new Headers()
        for (const [name, value] of Object.entries(req.headers)) {
          if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
        let response
        try {
          const remoteUrl = new URL(req.originalUrl || req.url, remotePhotoPreview)
          response = await fetch(new Request(remoteUrl, { method: req.method, headers, signal: AbortSignal.timeout(30_000) }))
        } catch {
          response = await worker.fetch(new Request(requestUrl, { method: req.method, headers }), {
            ALLOWED_ORIGINS: 'http://127.0.0.1:5173,http://localhost:5173',
            PORTFOLIO_ORIGIN: 'http://127.0.0.1:5173',
            PHOTO_SIGNING_SECRET: localPhotoSecret,
            photo: { get: async () => null },
          })
        }
        res.statusCode = response.status
        response.headers.forEach((value, name) => {
          if (name !== 'content-encoding' && name !== 'content-length') res.setHeader(name, value)
        })
        if (req.method === 'HEAD' || !response.body) return res.end()
        if (requestUrl.pathname === '/photo/manifest' && response.ok) {
          const body = (await response.text()).replaceAll(/https?:\/\/kensym15\.dpdns\.org\/photo\//g, '/photo/')
          return res.end(body)
        }
        res.end(Buffer.from(await response.arrayBuffer()))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localPhotoApi()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        capabilities: resolve(import.meta.dirname, 'capabilities.html'),
        photography: resolve(import.meta.dirname, 'photography.html'),
      },
    },
  },
})
