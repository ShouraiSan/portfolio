# 私有 R2 媒体服务

该 Worker 保留现有 `/media/...` 视频代理，并新增 `/photo/manifest` 与 `/photo/image/:assetId` 摄影接口。摄影原图只由私有 R2 binding 读取，浏览器拿不到 bucket 地址、`objectKey` 或原图路由。

## 首次配置

1. 创建名为 `photo` 的私有 R2 bucket，保持 `r2.dev` 公共访问关闭。`wrangler.toml` 中的小写 binding `photo` 和 bucket 名均已配置。
2. 确认账户可以使用 Workers Images binding。配置为 `[images] binding = "IMAGES"`；未启用时图片接口会返回 `503`，不会把原图回退给浏览器。
3. 在 `worker` 目录执行 `npx wrangler secret put PHOTO_SIGNING_SECRET`，写入至少 32 字节的随机值。不要把真实 secret 放入仓库、`.env` 或 `wrangler.toml`。
4. 检查 `ALLOWED_ORIGINS`。当前允许正式站点、Worker 域名及 `localhost:5173`、`127.0.0.1:5173` 本地预览来源。
5. 部署前确认 `PHOTO_RATE_LIMITER` 的 `namespace_id` 在账户内唯一；示例限制为每个客户端每分钟 120 次。生产环境还应在 Cloudflare WAF/Rate Limiting 中对 `/photo/manifest` 和 `/photo/image/*` 配置分层限速。
6. 执行 `npx wrangler deploy`。站点生产构建默认使用 `https://kensym15.dpdns.org/photo`，也可用 `VITE_PHOTO_API_BASE_URL` 覆盖。

Cloudflare 的 Images binding 是否可用取决于账户能力。若部署时报 `[images]` 不受支持，先在控制台启用对应产品，不要删除转换层或让页面直接加载 R2 原图。

## 内容维护

Worker 会自动扫描私有 `photo` bucket。维护时：

1. 按 `分类/文件名.jpg` 上传原图，例如 `手办/初号机.jpg`；一级目录会直接成为页面分类。
2. Worker 自动读取 EXIF 中的拍摄年份、机身、镜头、标题、描述和像素尺寸。EXIF 没有标题时使用文件名，文件名中的 `_`、`-` 会显示为空格。
3. 若要覆盖识别结果，可为 R2 对象添加 `title`、`year`、`camera`、`lens`、`description`、`width`、`height` 或 `focalPoint` custom metadata。
4. 对象 ETag 自动作为版本，替换原图后派生图 URL 会更新。公开 `assetId` 由 HMAC 生成，浏览器无法据此推导 object key。

`src/index.js` 中的 DEMO 清单仅用于本地或空 bucket 的预览；远端 bucket 中存在图片时不会对外显示 DEMO 记录。

不要增加原图公开路由、下载按钮或把私有清单复制到前端。现有来源校验、短时 HMAC URL、不可猜测 ID 和限速只能降低盗链、枚举与长期复用，无法阻止用户保存或截屏已经成功显示在浏览器中的图片。

## 缓存与安全

- manifest 中签名地址有效期为 15 分钟。
- 图片请求先校验来源、参数白名单、版本和签名，再读取 CDN 缓存；过期签名不能借缓存绕过鉴权。
- 派生图按资源 ID、版本和规范化变体长期缓存，允许宽度、质量、格式和 fit 均为固定集合。
- 响应使用 `Content-Disposition: inline`、准确图片类型、`nosniff` 和跨源资源策略。
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

真实图片转换仍需部署后的 R2 与 Images binding 才能端到端验证。

需要在本地预览远端 bucket 时，另开一个终端运行只读远端 binding：

```powershell
cd worker
pnpm dlx wrangler dev --port 8788 --var "PHOTO_SIGNING_SECRET:local-preview-secret"
```

Vite 会自动代理该本地 Worker；若 8788 未运行，则回退到 DEMO 清单。
