# 私有 R2 视频代理

该 Worker 通过 R2 binding 读取私有存储桶，支持视频播放器需要的 Range 请求。R2 API 密钥不会进入前端。

1. 将 `wrangler.toml` 中的 `YOUR_PRIVATE_BUCKET_NAME` 改为实际存储桶名称。
2. 在此目录运行 `npx wrangler login`，然后运行 `npx wrangler deploy`。
3. 复制 Worker 地址。本地测试时，将项目根目录的 `.env.example` 复制为 `.env.production`，把 `VITE_MEDIA_BASE_URL` 设置为 `https://你的-worker.workers.dev/media`。
4. GitHub Pages 部署时，在仓库 `Settings → Secrets and variables → Actions → Variables` 中新增 `VITE_MEDIA_BASE_URL`，值为同一个 Worker `/media` 地址。
5. 运行根目录的 `publish-site.ps1`，重新构建并上传网站。
6. 确认播放正常后，在 Cloudflare R2 设置中关闭 `r2.dev` 公共访问。

Worker 会拒绝空 `Referer`、非白名单 `Referer`，以及不在 `ALLOWED_ORIGINS` 中的 `Origin`。因此在 `wrangler.toml` 里保留 GitHub Pages 与本地预览地址；若改用自定义域名，需要同步加入该域名。

`Referer` / `Origin` 只适合降低直链和热链，不是强鉴权：它们可以被非浏览器客户端伪造，且无法可信地限制任意客户端 IP。公开作品集中的视频仍然可能被熟练用户通过开发者工具找到。若需要真正限制访问，应在 Worker 中增加 Cloudflare Access、登录会话或短期签名令牌，并关闭 R2 的 `r2.dev` 公共访问。
