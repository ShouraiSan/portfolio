# 私有 R2 视频代理

该 Worker 通过 R2 binding 读取私有存储桶，支持视频播放器需要的 Range 请求。R2 API 密钥不会进入前端。

1. 将 `wrangler.toml` 中的 `YOUR_PRIVATE_BUCKET_NAME` 改为实际存储桶名称。
2. 在此目录运行 `npx wrangler login`，然后运行 `npx wrangler deploy`。
3. 复制 Worker 地址。本地测试时，将项目根目录的 `.env.example` 复制为 `.env.production`，把 `VITE_MEDIA_BASE_URL` 设置为 `https://你的-worker.workers.dev/media`。
4. GitHub Pages 部署时，在仓库 `Settings → Secrets and variables → Actions → Variables` 中新增 `VITE_MEDIA_BASE_URL`，值为同一个 Worker `/media` 地址。
5. 运行根目录的 `publish-site.ps1`，重新构建并上传网站。
6. 确认播放正常后，在 Cloudflare R2 设置中关闭 `r2.dev` 公共访问。

`ALLOWED_ORIGINS` 只能限制普通浏览器跨域调用，不能作为付费或私密内容的强身份认证。公开作品集中的视频仍然可被观看者通过开发者工具找到。若需要严格访问控制，应在 Worker 中增加登录鉴权或短期签名令牌。
