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

// 站点的 HTML 与 JS 全部托管在同一来源（COS），模块脚本不需要 CORS。
// 但 vite build 会给产物加上 crossorigin 属性，例如：
//   <script type="module" crossorigin src="./assets/main-xxx.js">
// crossorigin 会让浏览器对该脚本执行 CORS 校验，要求响应带
// Access-Control-Allow-Origin；而腾讯云 COS 默认不返回该头，
// 结果是浏览器拒绝执行脚本，页面（尤其摄影页的照片）完全不工作。
// 这里把这些属性去掉，模块即可正常加载。
function stripCrossorigin() {
  const dropAttr = (html) => html
    .replace(/\s+crossorigin(?:=("|')[^"']*\1)?/g, '')
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler: dropAttr,
    },
  }
}

export default defineConfig({
  plugins: [react(), localPhotoApi(), stripCrossorigin()],
  base: './',
  build: {
    modulePreload: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        capabilities: resolve(import.meta.dirname, 'capabilities.html'),
        photography: resolve(import.meta.dirname, 'photography.html'),
      },
    },
  },
})
