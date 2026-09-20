# 私有 R2 媒体服务

该 Worker 保留现有 `/media/...` 视频代理，并新增 `/photo/manifest` 与 `/photo/image/:assetId` 摄影接口。摄影原图只由私有 R2 binding 读取，浏览器拿不到 bucket 地址、`objectKey` 或原图路由。

## 首次配置

1. 创建名为 `photo` 的私有 R2 bucket，保持 `r2.dev` 公共访问关闭。项目根目录 `wrangler.toml` 中的小写 binding `photo` 和 bucket 名均已配置。
2. 在项目根目录执行 `pnpm exec wrangler secret put PHOTO_SIGNING_SECRET`，写入至少 32 字节的随机值。不要把真实 secret 放入仓库、`.env` 或 `wrangler.toml`。
3. 检查 `ALLOWED_ORIGINS`。当前允许正式站点、Worker 域名及 `localhost:5173`、`127.0.0.1:5173` 本地预览来源。
4. 部署前确认 `PHOTO_RATE_LIMITER` 的 `namespace_id` 在账户内唯一；示例限制为每个客户端每分钟 120 次。生产环境还应在 Cloudflare WAF/Rate Limiting 中对 `/photo/manifest` 和 `/photo/image/*` 配置分层限速。
5. 创建缩略图队列和死信队列（每个账户只需执行一次）：

   ```powershell
   pnpm exec wrangler queues create photo-thumbnail-jobs
   pnpm exec wrangler queues create photo-thumbnail-failures
   ```

6. 配置 `photo` bucket 的 R2 Object Create 事件通知，只把原始 JPG 发到队列。该命令会排除 `_thumbnails/` 目录，避免缩略图再次触发处理：

   ```powershell
   pnpm exec wrangler r2 bucket notification create photo `
     --queue photo-thumbnail-jobs `
     --event-type object-create `
     --suffix .jpg `
     --description photo-originals-to-avif
   ```

   如果也会上传 `.jpeg`，再执行一次相同命令并把 `--suffix` 改为 `.jpeg`；大写扩展名也需要对应规则，或改为不设置 `--suffix`，由 Worker 自己过滤。

7. 执行 `pnpm worker:deploy`。Worker 会由 Queue consumer 异步生成 `320px`、`640px`、`1280px` 三种 AVIF。站点生产构建默认使用 `https://portfolio-media.jlmafuture.workers.dev/photo`，也可用 `VITE_PHOTO_API_BASE_URL` 覆盖。

Images binding 的单次输入上限为 20 MB；超过这个大小的原图仍会正常保留在 R2，但会在重试后进入死信队列，需要先压缩源文件或改用独立的图像处理服务。

## 内容维护

Worker 会自动扫描私有 `photo` bucket。维护时：

1. 按 `分类/文件名.jpg` 上传 JPG 原图，例如 `手办/初号机.jpg`；一级目录会直接成为页面分类。其他图片格式不会进入摄影清单。
2. Worker 自动读取 EXIF 中的拍摄年份、机身、镜头、标题、描述和像素尺寸。EXIF 没有标题时使用文件名，文件名中的 `_`、`-` 会显示为空格。
3. 若要覆盖识别结果，可为 R2 对象添加 `title`、`year`、`camera`、`lens`、`description`、`width`、`height` 或 `focalPoint` custom metadata。
4. 对象 ETag 自动作为版本，替换原图后图片 URL 会更新。公开 `assetId` 由 HMAC 生成，浏览器无法据此推导 object key。

`src/index.js` 中的 DEMO 清单仅用于本地或空 bucket 的预览；远端 bucket 中存在图片时不会对外显示 DEMO 记录。

页面通过短时签名路由读取 R2 中的 AVIF 缩略图，原图只在灯箱回退或需要原始质量时读取。原始 JPG 永远保留，缩略图写入 `_thumbnails/{width}/{原始 key}.avif`。现有来源校验、不可猜测 ID 和限速只能降低盗链、枚举与长期复用，无法阻止用户保存或截屏已经成功显示在浏览器中的图片。

### 队列失败与重试

- 原图写入 R2 后才发送事件，缩略图失败不会回滚或阻塞原图上传。
- Worker 对每条消息独立处理；转换异常调用 `message.retry()`，最多重试 5 次。
- 超过重试次数的消息进入 `photo-thumbnail-failures`，可用 `wrangler queues consumer` 或 Queue 控制台排查后重新投递。
- 已存在的缩略图会被幂等覆盖，重复投递不会产生额外文件。

## 缓存与安全

- manifest 中签名地址有效期为 15 分钟；页面在到期前自动刷新清单，恢复可见时也会检查。
- 图片请求先校验来源、版本和签名，再从 CDN 缓存或私有 R2 读取 AVIF 缩略图或 JPG 原文件；过期签名不能借缓存绕过鉴权。
- 缓存键按资源 ID 和对象版本稳定生成，不包含每次变化的签名及加密引用。
- 响应使用 `Content-Disposition: inline`、准确图片类型、`nosniff` 和跨源资源策略。
- AVIF 缩略图和原图都使用 `Cache-Control: public, max-age=31536000, immutable`；源文件替换后 ETag/version 变化会生成新的签名 URL，不会复用旧内容。
- 日志中不要输出完整请求 URL；其中包含短时签名查询参数。当前实现不记录查询串或 secret。

## 本地验证

项目根目录的 Vite 开发服务器内置只用于本地预览的 Worker 适配器，可以直接显示 DEMO 清单：

```powershell
pnpm dev
```

访问 `http://127.0.0.1:5173/photography.html`。关键路径测试运行：

```powershell
pnpm test
pnpm build
```

真实 JPG 原图读取需要部署后的远端 R2 binding 才能端到端验证。

需要在本地预览远端 bucket 时，另开一个终端运行只读远端 binding：

```powershell
pnpm worker:dev --var "PHOTO_SIGNING_SECRET:local-preview-secret"
```

Vite 会自动代理该本地 Worker；若 8788 未运行，则回退到 DEMO 清单。
