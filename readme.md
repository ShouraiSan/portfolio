# Kensym® 个人作品集 · 项目交接手册

> **本文档用途**：供「新开对话的 AI 助手」或「接手本项目的其他智能体/开发者」快速完整接班。
> 读完这一份即可动手，不必再去翻 `doc/program.md` 与 `doc/design.md`（那两份是历史需求稿，仅作溯源）。
>
> **最后核对时间**：以当前工作区实际文件为准（React 19.3.0 / Vite 8.3.0 / wrangler 4.135.0）。
> **工作区根目录**：`E:\codex\个人网站`
> **站点品牌**：Kensym® ｜ Visual · AI · Brand Designer ｜ 主要受众：品牌方、合作方、招聘方
> **联系方式**：future0224@126.com ｜ 所在地：Nanjing, China

---

## 0. 给接手者的 60 秒速览

| 问题 | 答案 |
| --- | --- |
| 这是什么？ | 纯静态 + Serverless 的个人作品集站（3 个页面）+ 2 个 Cloudflare Worker |
| 代码仓库 | ★ 本目录**就是** git 工作仓库：`https://github.com/ShouraiSan/portfolio.git`，分支 `main` |
| 前端 | Vite 8 多页应用（MPA），3 个独立 HTML 入口，各自挂一个 React 19 根组件 |
| 后端 | 无数据库、无登录、无 CMS。只有 Cloudflare Worker 做媒体代理与图片签名 |
| 存储 | Cloudflare R2（视频 + 照片原图/AVIF）/ 腾讯云 COS（站点静态托管 + 图片变体） |
| 部署 | 双节点：**国内 = 香港 COS**，**国外 = GitHub Pages（Cloudflare 代理加速）** |
| 内容来源 | 全部**硬编码在源码里**（视频清单）或**由 R2 自动扫描**（照片清单），改内容 = 改代码 / 传 R2 |
| 域名 | 站点 `kensym15.top`（国内）；Worker `kensym15.dpdns.org`（dpdns 子域，**只有子域在 Worker 上**） |
| 最大风险 | 改了 `ALLOWED_ORIGINS` 或图片命名规则 → 全线 403/404（详见 §9、§10） |
| 最该先修 | 站点有 **6 处第三方热链图**（unsplash / picui）+ **字体走 Google Fonts**，国内节点两者都不可达（详见 §6.3、§9.3、§11） |
| 本次任务边界 | **只产出本文档，未改动任何代码/配置**（清理项已记录，其中「删除类」经用户确认**不做**，见 §11） |

---

## 0.1 铁律：每次改动完成，务必 push 到 git 仓库

> **这是本项目最高优先级的操作约束，任何接手者都必须遵守。**

```powershell
git add -A
git commit -m "描述这次改了什么"
git push origin main
```

**为什么是硬性要求，而不是「建议」**：

1. **不 push 就等于没做。** 两个线上节点（香港 COS 国内 / GitHub Pages 国外）**完全由 `push main` 触发的 GitHub Actions 驱动**。改动只留在本地，线上一个字都不会变 —— 这是最容易造成「我明明改好了，怎么线上还是旧的」的原因。
2. **这个项目的历史包袱已经很重**（`styles.css` 覆盖式重复、`doc/` 里的需求稿与实际代码漂移、`worker/wrangler.toml` 这类错误引用）。这些债的成因就是改动没有及时入库、记录断了。不 push 会继续累积。
3. **接手者可能不是你。** 下一位智能体/开发者只会看到仓库里的内容。本地未推送的改动对它不存在，它会在旧版本上继续改，从而制造冲突或重复劳动。

**执行要点**

- 改完 → **立刻** commit + push，不要攒着等「下次一起提」。
- 一次改动一个 commit，message 写清做了什么（对照仓库既有风格，如 `Serve photo API from custom domain: workers.dev is unreachable in mainland China`）。
- **push 后确认 CI 结果**：Actions 跑完后，用一次 HTTP 请求核对部署报告 `https://kensym-1331415098.cos.ap-hongkong.myqcloud.com/deploy-report.txt`，看 `status=OK`、`pages_ok=yes`、`assets_cache=3/3`。CI 失败时**不要**当作已完成。
- 只改了 Worker 代码（`worker/`、`wrangler.toml`）时注意：**站点 CI 不会部署 Worker**，还需要额外执行 `pnpm worker:deploy`（见 §13.5）。两者都要做。
- 涉及密钥的改动**永远不要**提交（见 §7.4 与 §10「不要做」）。

> ⚠️ **本机 push 常见故障：`Failed to connect to github.com:443`**
> 这台机器上 `github.com:443` 直连会被阻断（DNS 正常解析到真实 IP `20.205.243.166`，但 TCP 连不上），而本机有代理在 `127.0.0.1:7897`（Clash 默认端口）。绕过方式：
>
> ```powershell
> git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
> ```
>
> 该代理端口是**本机环境相关**的，不要写进仓库配置。若端口变了，先探测：
> `Test-NetConnection 127.0.0.1 -Port 7897 -InformationLevel Quiet`
> 验证推送是否落地不要用 `git ls-remote`（它同样不走代理），加同样的 `-c` 参数即可。

---

## 1. 完整目录结构（含每个文件的职责）

```
E:\codex\个人网站\
├── index.html                    首页 HTML 入口（挂载 src/main.jsx）
├── capabilities/index.html       能力页入口（挂载 src/capabilities.jsx）
├── photography/index.html        摄影页入口（挂载 src/photography.jsx）
├── src/
│   ├── main.jsx                  首页 React 应用：Hero / 关于我 / 精选项目+视频弹窗 / 创作方式入口 / 页脚
│   ├── capabilities.jsx          能力页 React 应用：四项创作方法 + 工具体系 + 合作联系
│   ├── photography.jsx           摄影页 React 应用：分类筛选 + 网格 + 全屏灯箱（缩放/手势/键盘）
│   └── styles.css                全站唯一样式表（40+ 行，压缩书写，含全部三页样式）
├── public/favicon.svg            图标（构建时复制到 dist 根）
├── vite.config.js                多页构建配置 + 本地 Worker 适配器 + 去 crossorigin 插件
├── package.json                  脚本与依赖（含 worker:deploy / test）
├── pnpm-workspace.yaml           仅 allowBuilds（esbuild / workerd 允许执行构建脚本）
├── pnpm-lock.yaml                锁文件（真实安装版本以此为准）
├── .env.example                  环境变量样例（VITE_MEDIA_BASE_URL / VITE_PHOTO_API_BASE_URL）
├── .gitignore                    忽略 node_modules、dist、.wrangler、.dev.vars、.photo-thumbs
├── wrangler.toml                 ★ 主 Worker（portfolio-media）配置：R2 / 限速 / 来源白名单 / COS 图床
├── worker/
│   ├── README.md                 主 Worker 的部署与内容维护说明（权威，写得很细，值得读）
│   ├── src/index.js              ★ 主 Worker 全部逻辑：/media 视频代理 + /photo 图片签名与分流 + 页面回源
│   ├── src/photo-catalog.js      扫描 R2 生成照片清单：assetId、EXIF、尺寸、分类
│   └── test/                     photo.test.js（293 行）+ photo-catalog.test.js（69 行），node:test
├── image-converter/              ★ 独立管理型 Worker（photo-avif-batch）
│   ├── worker.js                 JPG → AVIF 批量转换，写回 R2
│   ├── wrangler.toml             绑定 photo 桶 + Cloudflare Images binding
│   ├── README.md                 部署与触发方式（Bearer token）
│   └── test/worker.test.js
├── .github/workflows/
│   ├── deploy.yml                构建并发布到 GitHub Pages（国外节点）
│   └── deploy-cos.yml            构建并用 coscmd 上传腾讯云 COS（国内节点）+ 部署后自检
├── doc/
│   ├── program.md                历史内容稿（板块/文案/视觉规范来源）
│   └── design.md                 摄影页的历史需求稿与验收标准
├── dist/                         构建产物（已 gitignore，磁盘上存在）
└── .photo-thumbs/                一次性缩略图工具产物（已 gitignore；含本机绝对路径，勿提交）
```

**注意**：`doc/design.md` 中提到的 `worker/wrangler.toml` **并不存在** —— Worker 配置在**项目根目录**的 `wrangler.toml`。这是历史文档漂移，按本手册为准。

---

## 2. 总体架构

### 2.1 三层拓扑

```
                        ┌─────────────────────────────────────────┐
   国内访客 ───────────►│  https://kensym15.top                   │
                        │  腾讯云 COS · 香港 ap-hongkong          │
                        │  桶 kensym-1331415098（静态网站托管）    │
                        └──────────────┬──────────────────────────┘
                                       │ 图片请求带 Origin/Referer = kensym15.top
                                       ▼
                        ┌─────────────────────────────────────────┐
   国外访客 ──┐         │  Cloudflare Worker  portfolio-media      │
              │         │  自定义域名 kensym15.dpdns.org           │
              │         │  /media/*  → R2 桶 video（视频代理，Range）│
              │         │  /photo/*  → 签名校验 + 双源分流 + 缓存   │
              │         │  其它路径  → 回源 GitHub Pages           │
              │         └───┬──────────────────────┬──────────────┘
              │             │ 国外：读 R2            │ 国内：读上海 COS
              │             ▼                      ▼
              │  ┌────────────────────┐  ┌──────────────────────────┐
              │  │ Cloudflare R2      │  │ 腾讯云 COS · 上海         │
              │  │ 桶 photo（私有）    │  │ 桶 photo-1331415098       │
              │  │ 照片原图 JPG（~13.5MB）│ │ thumbs/<分类>/<名>.avif  │
              │  │ + AVIF 变体         │  │ previews/<分类>/<名>.avif│
              │  │ 桶 video（私有）    │  └──────────────────────────┘
              │  │ 4 个 mp4            │
              │  └────────────────────┘
              │
              └──────►┌─────────────────────────────────────────┐
                      │  GitHub Pages  shouraisan.github.io      │
                      │  路径 /portfolio/（国外节点静态站）       │
                      │  *.dpdns.org 由 Cloudflare 代理加速此站   │
                      └─────────────────────────────────────────┘
```

### 2.2 关键设计取舍（为什么长这样）

| 决策 | 原因 |
| --- | --- |
| 前端是 **MPA**（3 个独立 HTML）而非 SPA 单入口 | 每个页面可独立强缓存 JS，页面间无路由依赖，刷新/分享任意页面地址都不会 404 |
| 页面路径用「**目录 + index.html**」 | 线上地址无 `.html` 后缀（`/photography/`），刷新与分享稳定。依赖 COS 静态网站的索引文档 |
| 视频/原图放 **R2** | R2 出口流量免费；视频 4K 体积大 |
| 缩略图/预览图**另存一份到上海 COS** | 国内访客直连上海 COS，避免跨境拉 R2 的高延迟与不稳定 |
| 图片必须走 **Worker 签名路由** | R2 桶保持私有；浏览器永远拿不到 bucket 地址、`objectKey` 或原图直链 |
| Worker 在 `*.dpdns.org` 子域上 | 它同时是 Worker 路由、媒体域名，且被 `ALLOWED_ORIGINS` 覆盖。**裸域 `kensym15.top` 必须留给 COS 静态站** |
| Vite 插件 `stripCrossorigin` | 腾讯云 COS 默认不返回 `Access-Control-Allow-Origin`，而 Vite 给产物加的 `crossorigin` 属性会触发 CORS 校验 → 脚本被拒 → 整页（尤其摄影页）全废 |

---

## 3. 服务器与域名位置（决定性配置，务必精确）

### 3.1 四个真实端点

| 角色 | 域名 / 地址 | 实际落点 | 备注 |
| --- | --- | --- | --- |
| **国内站点** | `https://kensym15.top`（含 `www`） | 腾讯云 COS **香港 ap-hongkong**，桶 `kensym-1331415098`，静态网站托管 | 香港无需 ICP 备案即可绑自定义域名；**未备案，不能指向大陆 COS** |
| **国外站点** | `https://shouraisan.github.io/portfolio/` | GitHub Pages | `*.dpdns.org` 由 **Cloudflare 代理加速**这个站点 |
| **媒体/接口 Worker** | `https://kensym15.dpdns.org` | Cloudflare Worker `portfolio-media`（`workers_dev = true`） | 别称 `https://portfolio-media.jlmafuture.workers.dev` |
| **国内图片图床** | `https://photo-1331415098.cos.ap-shanghai.myqcloud.com` | 腾讯云 COS **上海 ap-shanghai**，桶 `photo-1331415098` | 存 `thumbs/` 与 `previews/` 的 AVIF；**大陆地域，外网下行单价低于香港** |

### 3.2 存储桶与 Worker 一览

| 资源 | 类型 | 名称 | 绑定名 | 公共访问 |
| --- | --- | --- | --- | --- |
| 视频 | R2 | `video` | `MEDIA` | 关闭（仅 Worker 代理） |
| 照片原图 + AVIF 变体 | R2 | `photo` | `photo`（小写） | **关闭**（`r2.dev` 公共访问必须保持关闭） |
| 图片变体（国内加速副本） | COS 上海 | `photo-1331415098` | 无绑定，走 HTTPS 直取 | 默认端点取图，**无需开放公共读**（仍经 Worker 签名） |
| 站点静态文件（国内） | COS 香港 | `kensym-1331415098` | 无绑定，由 Actions 上传 | 静态网站托管开启 |

| Worker | 名称 | 入口 | 绑定 | 相关配置 |
| --- | --- | --- | --- | --- |
| 主 Worker | `portfolio-media` | `worker/src/index.js` | R2 `MEDIA`、R2 `photo`、RateLimit `PHOTO_RATE_LIMITER` | 根目录 `wrangler.toml` |
| 图片转换 | `photo-avif-batch` | `image-converter/worker.js` | R2 `R2` → 桶 `photo`、Images `IMAGES` | `image-converter/wrangler.toml` |

主 Worker 的 `routes` 只声明了 `{ pattern = "kensym15.dpdns.org", custom_domain = true }` —— **只拦子域，不拦裸域**，这正是双节点能并存的前提。新增任何路由前先确认不会把 `kensym15.top` 或 `*.dpdns.org` 的静态站请求吞掉。

### 3.3 摄影图片分流的判定规则（R2 为唯一主节点）

**核心原则：R2 是唯一主节点；上海 COS 只是国内侧的加速镜像，国外节点绝不接入它。**

`worker/src/index.js` 的 `isChinaNodeRequest()`：

```js
return /(^|\.)kensym15\.top$/i.test(hostname)          // 国内入口
    || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i // 本地开发
```

| 请求来源 | thumb / preview 主源 | 兜底 | 原图 |
| --- | --- | --- | --- |
| `kensym15.top`（国内）+ localhost | **上海 COS** | R2 | R2（见下方说明） |
| 其它一切来源（GitHub Pages、dpdns.org、workers.dev、未识别） | **R2** | **无兜底** | R2 |

实现（`fetchThumb()`）：

```js
if (!isChinaNodeRequest(request)) return fetchR2Image(env, photo);   // 国外：只认 R2
return (await fetchCosImage(env, photo)) || (await fetchR2Image(env, photo)); // 国内：COS 优先，R2 兜底
```

**三个容易误解的点**

1. **访客不直连任何桶，请求永远先到 Worker。** 无论国内还是国外，页面里的 `img src` 都指向 Worker 域名（`/photo/image/:assetId?variant=...`），由 Worker 校验签名后决定回源哪一侧。`Origin`/`Referer` 只是告诉 Worker「这个访客属于国内还是国外」，判定完全在服务端，前端不需要知道自己在哪个节点。
2. **判定依据是「访客从哪个站点的页面发起请求」**：
   - 访客在 `kensym15.top` → 图片跨源 → 浏览器自动带 `Origin: https://kensym15.top` → **命中，走上海 COS**。
   - 访客在 `dpdns.org` → 页面与图片同源 → 带 `Origin: https://kensym15.dpdns.org` → **未命中，走 R2**。
   - `Origin` 缺失时退回解析 `Referer` 的 origin。
3. **原图（灯箱大图）也参与分流**：国内优先上海 COS，国外只走 R2。实现见下方「原图分配」。

**为什么国外侧要「没有兜底」**

R2 是主节点，国外访客的命中必须落在 R2。上海桶是专为国内访客准备的加速副本，让海外请求回落到上海会横跨太平洋，反而更慢。所以国外侧在 R2 未命中时**直接返回 404**，不去试探上海桶 —— 这条规则由测试 `overseas node never falls back to Shanghai COS when R2 misses` 锁定。

**国内侧为什么保留 R2 兜底**

上海桶是镜像，与 R2 可能不同步（新图上传后镜像尚未生成）。此时国内访客宁可多等一会儿从 R2 取，也不该看到 404。

**原图分配（已实现）**

`handlePhotoImage()` 的原图分支先按来源试上海 COS，失败再回落 R2：

```js
if (!isAvif && isChinaNodeRequest(request)) {
  const fromCos = await fetchCosOriginal(env, reference.key);   // 仅国内
  if (fromCos) return imageResponse(fromCos, 'image/jpeg');
}
const object = await env.photo.get(reference.key);              // R2 兜底
```

`avif` 变体（历史兼容用途）**不参与**，只认 R2。这条规则由 `overseas original never contacts Shanghai COS` 与 `China node falls back to R2 original when the COS mirror is unavailable` 两条测试锁定。

**上海桶三层镜像与命名规则（已实测确认，配了 ListBucket 权限后全量枚举 204 个对象）**

| 层级 | COS 路径 | 数量 | 命名规则 | 实测样本 |
| --- | --- | --- | --- | --- |
| 原图 JPG | `<分类>/<文件名>`（**直接在一级分类目录下**） | 58 | **保留半角空格**；扩展名**逐个文件继承原始大小写** | `人像/_DSC6557.JPG` = 7,684,428；`风光/Chenshan_Park-7889.jpg` = 14,127,108 |
| 缩略图 | `thumbs/<分类>/<名>.avif` | 58 | 同上（与原图同名，仅换小写扩展名） | `thumbs/风光/Chenshan_Park-7889.avif` = 181,697 |
| 预览图 | `previews/<分类>/<名>.avif` | 58 | 同上 | `previews/风光/Chenshan_Park-7889.avif` = 1,226,781 |

三者的字节数与 `local-map.json` 记录的本地原图完全一致（镜像无损）。

> ⚠️ **R2 侧的命名形态我无法直接确认**（R2 桶没有 ListBucket，Worker 也不返回 `objectKey`）。可确认的是：**COS 侧 58 张里 27 张的对象名保留半角空格**，而下划线形态（`bocchi_(5_-_12).avif`）实测 **404 不存在**。因此候选生成必须覆盖「空格形态」，无论 R2 存的是哪一种。这一层不确定性正是候选枚举存在的理由 —— 精确形态永远排第一，所以猜错也不会有代价。

> ⚠️ **大小写陷阱**：COS 的 key **大小写敏感**，原图扩展名逐个文件继承原始命名（`_DSC6557.JPG` 大写、`Chenshan_Park-7889.jpg` 小写，同桶内并存）。探测或拼接 COS 原图 key 时若猜错大小写会得到 404，**不要据此认为文件不存在**；同理，高频探测会偶发 `403`，冷却后恢复。

**命名兜底的关键实现（`spaceVariant()`）**

「分隔符下划线 → 空格」不能无差别做 `/_/g → ' '`：那样会把 `hobby_figure` 这种**固有下划线**也破坏成 `hobby figure`，永远命中不了（实测 58 张里 26 张属于这种混合命名）。因此只还原「空格→下划线」真正会产生的那些下划线：

```js
const SEPARATOR_UNDERSCORE = /(?<=[\s（(0-9])_|_(?=[\s）)0-9（(])/g;
```

该规则已用桶内全部 58 个真实对象名做**双向覆盖验证**（58 × 2 形态 = 116 例）：`thumbCandidates` 与 `originalKeysFor` 均 **116/116 命中**。

> 💡 **如何验证某张图到底走了哪一侧**（两侧文件字节完全相同，看不出来源）：
> **看响应头有没有 `ETag`** —— R2 分支会设 `object.httpEtag`，**上海 COS 分支不设**。
> 实测同一张原图（`Hokkaidou 13`，7,037,343 字节）：
>
> | Referer | ETag | 来源 |
> | --- | --- | --- |
> | `https://kensym15.top/photography/` | **无** | 上海 COS |
> | `https://shouraisan.github.io/portfolio/...` | `"79d175db…"` | R2 |
>
> 另注意：**Range 请求会被忽略并返回整份文件**（200 + 完整 Content-Length），排查时不要误判。
> 想绕过缓存看真实回源，用一张此前没请求过的照片（缓存键含 `__origin`，冷却后才会重新回源）。

---

## 4. 前端架构

### 4.1 构建与入口（`vite.config.js`）

- `base: './'` —— 全部资源相对路径，因此 COS 的 `/` 与 GitHub Pages 的 `/portfolio/` 能用同一份 `dist`。
- `build.modulePreload: false` —— 去掉 modulepreload 复杂度。
- `rollupOptions.input` 显式三个入口：`index.html`、`capabilities/index.html`、`photography/index.html`。
- 插件链：`react()` → `localPhotoApi()` → `stripCrossorigin()`（顺序重要，`stripCrossorigin` 是 `enforce: 'post'` + `transformIndexHtml` post）。

**新增页面的既定约定**（写在 vite.config.js 注释里，务必遵守）：

1. 用「目录 + `index.html`」，例如新增关于页建 `about/index.html`。
2. 在该文件的 `input` 里加一行：`about: resolve(import.meta.dirname, 'about/index.html'),`
3. 子页里引用 favicon 等根目录资源要写 `../`；「返回首页」链接也用 `../`。
4. 线上地址为 `/about/`，无后缀，刷新不 404（依赖 COS 索引文档）。
5. 同时记得更新 `.github/workflows/deploy-cos.yml` 里的页面可达性自检清单（目前硬编码 `"" "photography/" "capabilities/"`）。

### 4.2 三个页面组件

**`src/main.jsx`（首页）**

- `projects` 数组驱动 4 个作品卡（`index/title/type/mediaPath/mimeType/image`）。
- `mediaPath` 是**已 URL 编码的** R2 对象名，例如 `Hokkaidou_tour%EF%BC%884k%EF%BC%89.mp4`、`%E6%9C%AA%E7%9F%A5...mp4`。
- 视频弹窗：`<video controls controlsList="nodownload" disablePictureInPicture autoPlay playsInline preload="metadata">`，`Esc` 关闭、点击遮罩关闭、打开时锁 `body.overflow`。
- 滚动显现：全局扫描 `.reveal`，`getBoundingClientRect().top < innerHeight * .88` 时加 `.shown`。
- 移动菜单：`open` 状态切换 `.navlinks.open`。

**`src/capabilities.jsx`（能力页）**

- `practices` 数组（4 项方法论）驱动 `practice-list`。
- 结构与首页一致：`.sub-nav`（Logo + 返回首页）→ 首屏 → 方法列表 → 工具色带（强调色满铺）→ 页脚联系。

**`src/photography.jsx`（摄影页，最复杂）**

- 图片 API 基址：`VITE_PHOTO_API_BASE_URL` || DEV 时 `/photo` || 生产 `https://kensym15.dpdns.org/photo`。
- **绝不能用 `*.workers.dev` 域名** —— 国内不可达，页面能开但照片全挂。
- `Picture` 组件：`IntersectionObserver` 阈值 `0.25`，**未进视口前不设置 `src`**（而不是用 `loading="lazy"`，因为浏览器自身预加载距离可达 1250px+）；首屏前 3 张 `priority` 立即加载；同排错开 0/70/140ms 波浪入场。
- `Lightbox` 组件：默认加载 **2000px 预览图**（约 220 KB）而非原图；预览就绪后在后台顺带拉原图，使「查看原图」无闪烁切换；只预取相邻 1 张预览图。
- 手势与交互：滚轮缩放（最大 4x）、双指捏合、拖拽平移、双击缩放、`+`/`-`/`0` 快捷键、`Tab` 焦点环、`Esc` 关闭、`←/→` 循环切图、打开时锁滚动并在关闭后把焦点还给触发缩略图。
- 触屏不依赖 hover：移动端隐藏 `.photo-hover`，改显示 `.photo-mobile-meta`。
- 分类筛选按钮是**磁性/聚光效果**：`--filter-scale` / `--filter-x` / `--filter-glow` 由指针距离经高斯衰减计算，`requestAnimationFrame` 节流，`prefers-reduced-motion` 与触摸设备直接跳过。
- `Picture` 有**回落逻辑**：缩略图失败时自动改用原图（`usingOriginalFallback`）。
- 注意：`lucide-react` 的 `Image` 必须以 `Image as ImageIcon` 别名导入，因为文件内用 `new Image()` 预取，直接导入会遮蔽全局构造函数。

### 4.3 数据结构（前端只拿到这些）

`/photo/manifest` 响应：

```jsonc
{
  "demo": false,
  "categories": ["全部", "人像", "手办", "街头", "风光"],
  "expiresAt": 1790000000,          // 签名过期时刻（秒）
  "photos": [{
    "assetId": "a7f81d2e-94c6-4b37-b815-3e60e1d9af42", // HMAC 派生，不可反推 objectKey
    "title": "…", "category": "人像", "year": "2024",
    "camera": "…", "lens": "…", "description": "…",
    "width": 1600, "height": 1200,  // 用于图片加载前锁定比例，避免 CLS
    "focalPoint": "50% 40%",
    "pending": false,               // true = DEMO 占位记录
    "original":  { "url": "…&variant=original" },  // 灯箱原图，来自 R2
    "thumbnail": { "url": "…&variant=thumb" },     // 网格小图，按来源分流
    "preview":   { "url": "…&variant=preview" },   // 灯箱预览 2000px，按来源分流
    "images": { "thumbnail": {"jpeg":[{"width":2400,"url":"…"}]},
                "lightbox":  {"jpeg":[{"width":2400,"url":"…"}]} }  // 旧客户端兼容字段
  }]
}
```

**`objectKey` 永远不会出现在响应里**（有测试断言 `JSON.stringify(body).includes('objectKey') === false`）。

---

## 5. 后端架构（Cloudflare Worker `portfolio-media`）

### 5.1 路由表

| 路径 | 方法 | 行为 |
| --- | --- | --- |
| `OPTIONS *` | OPTIONS | 来源在白名单内返回 204 + CORS，否则 403 |
| `/media/*` | GET/HEAD | **视频代理**：`media` Map 把 slug 映射为 R2 对象名 → `env.MEDIA.get(key, {range})` 支持 Range，206/200 + `Accept-Ranges` |
| `/photo/manifest` | GET | 扫描 R2 生成清单 + 为每张图签发 3 个短时 URL |
| `/photo/image/:assetId` | GET/HEAD | 签名校验 → 解密 ref → 按 `variant` 取图：`thumb`/`preview` 仅国内来源优先上海 COS（兜底 R2），国外来源只走 R2；`original` 国内优先上海 COS、兜底 R2，国外只走 R2；`avif` 一律只走 R2 |
| `/photo/*`（其它） | GET | 404 JSON |
| 其它任意路径 | GET/HEAD | **回源** `PORTFOLIO_ORIGIN`（GitHub Pages），转发响应并加 `Cache-Control: public, max-age=300` 与安全头 |

非 `GET/HEAD` 一律 405。

### 5.2 安全模型（三层）

1. **来源校验** `isTrustedRequest()`：`Referer` 的 origin 必须在 `ALLOWED_ORIGINS` 白名单内；若带 `Origin` 也必须命中。**空 Referer 一律拒绝。**
2. **短时 HMAC 签名**：签名载荷 = `assetId | version | exp | ref [| variant]`；TTL **15 分钟**；恒定时间比较；`exp` 超窗（> TTL+60s）也拒。
3. **加密引用（AES-GCM）**：URL 里的 `ref` 参数是 `objectKey + version` 的加密串（密钥由 `PHOTO_SIGNING_SECRET` 经 SHA-256 派生），因此浏览器**看不到也无法推导对象路径**。缩略图/预览图的 `ref` 里放的是逻辑键 `thumb:<分类>/<R2文件名>` 或 `preview:<分类>/<文件名>`，仅用于签名绑定与推导源键。

补充约束：`assetId` 必须是 36 位十六进制 UUID 形态；`normalizePhotoRequest()` 对 `v` / `exp` / `ref` / `variant` 做正则白名单（`variant` 只允许 `avif` / `thumb` / `preview`）；CORS 永不返回 `*`。

> ⚠️ **实测：上海桶的三层资源（含 JPG 原图）全部可匿名读取。**
> 上海桶 `photo-1331415098` 的 `thumbs/`、`previews/` 与一级分类目录下的 JPG 原图**均为公开可读**。实测（无签名、无 Referer）：
> `previews/人像/_DSC6557.avif` → 200（108,482）；`thumbs/人像/_DSC6557.avif` → 200（24,222）；`人像/_DSC6557.JPG` → 200（7,684,428）。
> 只要猜到命名规则（`<分类>/<原图文件名>` 或 `<thumbs|previews>/<分类>/<名>.avif`），即可**绕过 Worker 签名直接匿名取图，包括单张最大 32 MB 的原图**。
> 自 §3.3 的「国内原图走上海桶」实现后，原图也更频繁地从这一侧供给，暴露面进一步扩大。
> 后果：§5.2 第 3 条「浏览器无法推导对象路径」这一保护**对上海侧完全不成立**；防盗链、防枚举、防长期复用**仅对 R2 有效**。
> 处置选项见 §11 第 14 条 —— 注意选项 (b)/(c) 需要同步改造 Worker 的 COS 请求（当前是无凭据 `fetch`）。
>
> （排查提醒：高频 HEAD 探测上海桶会偶发返回 `403 Forbidden`，属临时现象，冷却后恢复 200；不要据此判定桶权限。同理，COS key 大小写敏感，猜错扩展名大小写得到的是 404。URL 里的半角空格建议编码为 `%20`。）

**能力边界（必须如实告知用户）**：来源校验 + 短时签名 + 不可猜测 ID 只能降低盗链、枚举与长期复用，**无法阻止用户保存或截屏已经成功显示在浏览器中的图片**。

**能力边界（必须如实告知用户）**：来源校验 + 短时签名 + 不可猜测 ID 只能降低盗链、枚举与长期复用，**无法阻止用户保存或截屏已经成功显示在浏览器中的图片**。

### 5.3 缓存策略

| 对象 | 头 | 说明 |
| --- | --- | --- |
| `/photo/manifest` | `Cache-Control: private, max-age=60` | 签名 15 分钟有效；页面每 60s 检查、可见时也检查，到期前 60s 自动刷新 |
| `/photo/image/*`（thumb/preview/original） | `public, max-age=31536000, immutable` + `CDN-Cache-Control` 同值 | 用 `caches.default` 缓存 |
| `/media/*`（视频） | `public, max-age=604800, stale-while-revalidate=86400`，CDN `max-age=2592000` | 带 `ETag`、`Accept-Ranges` |
| 回源静态页 | `public, max-age=300` | |

**缓存键含 `__origin`**：`canonicalUrl` 会删掉 `sig`/`exp`/`ref`，再写入 `__origin = Origin || Referer origin`。这一条是「过期签名不能借缓存绕过鉴权」+「两个节点各自缓存一份，互不污染」的关键，改缓存键前务必理解它。

### 5.4 照片清单自动生成（`photo-catalog.js`）

- 遍历 `photo` 桶（分页 `list`），只收 `.jpg`/`.jpeg` 且 key **不以 `_` 开头**的对象。
- `assetId` = `HMAC-SHA256(PHOTO_ASSET_ID_SECRET || PHOTO_SIGNING_SECRET, "photo-asset|" + objectKey)` 裁剪成 UUID 形态 —— 稳定、唯一、不可反推。
- `category` = 对象 key 的一级目录；无目录则 `未分类`。
- `version` = 对象 ETag 清洗后的前 40 字符（换原图 → URL 自动变化）。
- 元信息优先级：**R2 customMetadata** > EXIF > 文件名。
  - `title` = `custom.title` || EXIF `Title`/`XPTitle`/`ImageDescription` || 文件名（`_`、`-` 转空格）
  - `year` = `custom.year` || EXIF `DateTimeOriginal`/`CreateDate`/`ModifyDate` || 上传年份
  - `camera` = `custom.camera` || `Make + Model`（智能去重前缀）
  - `lens`、`description`、`width`、`height`、`focalPoint` 同理
- 尺寸兜底：`custom.width/height` → EXIF → **解析图片头字节**（PNG / WebP VP8X / JPEG SOF 标记）→ 最后 `4×3`。
- 排序：`category` 用 `zh-CN` 局部比较，再按 `title`。
- 目录缓存 TTL **5 分钟**（模块级变量 `cachedCatalog`，`clearPhotoCatalogCache()` 供测试重置）。

> ⚠️ **EXIF 扫描默认关闭**。只有 `PHOTO_EXIF_SCAN === 'true'` 时才按 512KB 范围读取并 `exifr.parse()`。开启后每张图都要额外读 R2 + 解析，几十张就会撞 Worker CPU 上限（有专门测试验证「跳过 EXIF 以规避 CPU 限制」）。生产建议**上传时写好 customMetadata**。
>
> ⚠️ `yearFor` 的 Windows 与 custom.year 分支下限不同：EXIF 走默认 `1990`，custom 走 `1900`。

### 5.5 文件名匹配与双源取图（最容易踩的坑）

R2 与 COS 两侧的文件名存在**分隔符与前导下划线差异**，代码用「候选键枚举 + 逐个尝试」来兜底：

- `thumbCandidates(objectKey)` 生成 4 组基名：原名、`-`→`_`、`_`→`-`、空格→`_`；每组再衍生原样 / 去前导 `_` / 加前导 `_`，去重后最多 12 个候选。
- `imageKeysFor(photo)` 组合：`<prefix>/<分类>/<名>.avif`，分类按 4 个已知值排序（命中分类排第一）；`preview` 变体额外补平铺形式 `<prefix>/<名>.avif`（兼容早期无分类层的上传）。
- `THUMB_VIEWPORT_THRESHOLD`、`COS_CATEGORIES = ['人像','手办','街头','风光']` 与 `COS_THUMB_PREFIX = 'thumbs'` 是硬编码的，新增分类两边都要改。

**代价**：最坏情况一次请求最多 24 次候选尝试（12 名 × 2 侧），每次都可能是 R2 `get` 或跨网 `fetch`。这是为容错付出的真实成本，排查「某张图 404 / 慢」时先看**文件名是否落在候选集合里**。

`fetchCosImage()` 用 `AbortSignal.timeout(20_000)`，失败即换下一个候选，整体主源失败后由 `fetchThumb()` 回落到另一侧。

### 5.6 图片转换 Worker（`photo-avif-batch`）

- 独立管理型 Worker，**不参与站点流量**，仅由人工/脚本触发。
- 鉴权：`Authorization: Bearer <CONVERTER_TOKEN>`（`wrangler secret put CONVERTER_TOKEN`），未配置或错误返回 401/503。
- 流程：`R2.list(prefix)`（可传 `?prefix=photos/`）→ 命中 `.jpg/.jpeg` → `R2.head(avifKey)` 已存在则 `skipped` → 否则 `env.IMAGES.input(body).output({format:'image/avif', quality:80})` → 写回同路径同名 `.avif`，`Content-Type: image/avif`、`Cache-Control: public, max-age=31536000, immutable`。
- 单文件失败只记 `error` 并继续，不中断整批；返回 `{prefix, pages, scanned, results, counts}`。
- **它只写 R2**，不会写上海 COS。上海 COS 上的 `thumbs/`、`previews/` 是另行上传/同步的副本（见 §13 维护 SOP）。

---

## 6. 美术风格（视觉规范）

### 6.1 设计基因

**近黑底 + 暖白字 + 一点荧光黄绿。** 编辑感排版、大量留白、细分割线、克制的入场动画。强调色只用于关键词、短线、编号、hover 与当前状态，**绝不大面积铺色**（能力页顶部工具色带是唯一例外）。

### 6.2 设计令牌（`src/styles.css` 顶部 `:root`）

```css
--bg:    #080808   /* 主背景（近黑） */
--soft:  #111      /* 次级底色 */
--line:  #292929   /* 分割线 */
--text:  #f2f1ed   /* 主文字（暖白） */
--muted: #9b9b98   /* 弱文字（灰） */
--acid:  #c8ff38   /* 强调色（荧光黄绿） */
```

派生用色：Hero 遮罩 `#050505` 系渐变；作品卡底 `#141414`；视频弹窗底 `#0d0d0d`；摄影页前身底 `#090909`、现为 `#000`。

### 6.3 字体

| 用途 | 字体 |
| --- | --- |
| 正文 / 大标题 | `Manrope`（大标题 `font-weight: 300`） |
| Logo / 数字 / 小标签 | `DM Sans` |
| 中文回退 | `"Microsoft YaHei", sans-serif` |

`body` 定义：`font-family: Manrope, "Microsoft YaHei", sans-serif`。

字体通过 `styles.css` **第 1 行**引入：

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Manrope:wght@300;400;500;600&display=swap');
```

**这是国内节点的真实风格风险**：`fonts.googleapis.com` / `fonts.gstatic.com` 在中国大陆基本不可达。国内访客走香港 COS 打开站点时，字体请求会超时 → Manrope 与 DM Sans **全部回落到 Microsoft YaHei**，大标题的字重与字面宽度随之变化，视觉与设计稿不一致。同时 `@import` 位于 CSS 首行是**渲染阻塞**的，还会拖慢首屏。

**建议方向**（见 §11 第 10 项）：把 Manrope / DM Sans 的 woff2 子集自托管到 COS 与 R2，改用 `@font-face` + `font-display: swap`，两个节点各自就近取字体。

### 6.4 布局与响应式

- 通用容器 `.shell`：`width: min(1700px, calc(100% - 96px))`，居中 → 大屏左右留白约 48px。
- 断点：**1100px**（摄影网格 3 列 → 2 列）、**900px**（导航折叠成汉堡、单列/双列、shell 留白 20px、Hero/标题字号下降）、**700px**（移动端专属调整，摄影筛选横滚、灯箱两行网格）、**640px**、**520px**（极限压缩）。
- 首页顶部导航高 **104px**，900px 以下 **78px**。

### 6.5 动效

- 进入视区由下向上淡入（`.reveal` → `.shown`）。
- 图片 hover 轻微放大；按钮 hover 变强调色（如 `.round-btn:hover` 填充 `--acid`）。
- 摄影筛选按钮的磁性聚光（高斯衰减位移 + 缩放 + `text-shadow` 光晕）。
- 摄影缩略图逐张错开 0/70/140ms 入场。
- **全部动效都尊重 `prefers-reduced-motion: reduce`**（已有多条媒体查询关闭位移/缩放/过渡）。

### 6.6 摄影页的独立气质

摄影页被刻意做成**偏画册 / 暗房阅片台**，与首页拉开：

- 底色 `#000`（比首页更黑），文字 `#f5f5f7`，次级文字走 Apple 灰色阶 `#a1a1a6` / `#86868b` / `#5d5d62`。
- 导航 `position: sticky`，高度 72px（<700px 为 64px），`background: #000000bd` + `backdrop-filter: saturate(180%) blur(22px)`。
- 分类筛选做成 `border-radius: 999px` 的**药丸分段控件**（底 `#1c1c1e`，选中态白底黑字），吸附在导航下方。
- 网格：3 列，`column-gap: 28px`，`row-gap: 68–76px`；卡片圆角 ≤ 8px。
- 每张图用 `--photo-ratio: width / height` 锁定比例，避免 CLS。
- 未接入图片的槽位显示 `IMAGE PENDING` + 编号 + `R2 OBJECT / TO BE CONNECTED` 的**设计完整空态**（不是破图）。

> ⚠️ **`styles.css` 是「越往后越优先」的覆盖式写法**：同一个选择器（尤其 `.photo-*`）在文件里被反复重定义，靠顺序取胜，末尾还有 40+ 行压缩成单行的重复规则。**新增样式一律追加到文件末尾**，不要插到中间——否则会静默失效。见 §11。

---

## 7. 技术栈

### 7.1 运行时依赖（`pnpm-lock.yaml` 中的真实版本）

| 包 | 版本 | 用途 |
| --- | --- | --- |
| `react` / `react-dom` | 19.3.0 | UI 与 `createRoot` |
| `vite` | 8.3.0（esbuild 0.28.1） | 构建与开发服务器；底层打包器是 rolldown |
| `@vitejs/plugin-react` | 6.1.x | JSX / Fast Refresh |
| `lucide-react` | 1.47.0 | 图标（`ArrowLeft`/`ChevronLeft`/`Plus`/`X`/`Mail`/`Play` 等） |
| `exifr` | 7.1.3 | Worker 侧解析 EXIF |
| `wrangler` | 4.135.0（workerd 1.20260918.1） | Worker 本地开发、dry-run、部署 |

### 7.2 平台服务

| 服务 | 用途 |
| --- | --- |
| Cloudflare Workers | 媒体代理、图片签名与分流、静态站回源 |
| Cloudflare R2 | 视频桶 + 私有照片桶（原图与 AVIF） |
| Cloudflare Rate Limiting（`PHOTO_RATE_LIMITER`） | 每客户端 120 次/60 秒，`namespace_id = 1001` |
| Cloudflare Images binding（`IMAGES`） | 仅转换 Worker 使用：JPG → AVIF |
| Cloudflare Cache API（`caches.default`） | `/photo/image/*` 边缘缓存 |
| Cloudflare 代理（`*.dpdns.org`） | 加速 GitHub Pages 国外节点 |
| 腾讯云 COS | 站点静态托管（香港）+ 图片变体图床（上海） |
| GitHub Pages | 国外节点静态托管（`/portfolio/`） |
| GitHub Actions | 双节点 CI/CD、部署后自检与报告 |

### 7.3 工程脚本（`package.json`）

```bash
pnpm dev                              # Vite 开发服务器（127.0.0.1，含本地 Worker 适配器）
pnpm build                            # vite build → dist/
pnpm test                             # node --test worker/test/*.test.js
pnpm worker:check                     # wrangler deploy --dry-run
pnpm worker:dev                       # wrangler dev --port 8788（代理远端 R2 只读）
pnpm worker:deploy                    # wrangler deploy（部署主 Worker）
```

图片转换 Worker 需在其目录单独执行：

```powershell
cd E:\codex\个人网站\image-converter
pnpm exec wrangler deploy --config wrangler.toml
```

### 7.4 环境变量与密钥矩阵

| 名称 | 位置 | 作用 | 是否敏感 |
| --- | --- | --- | --- |
| `VITE_MEDIA_BASE_URL` | 构建时（GitHub `vars`） | 覆盖视频代理基址 | 否 |
| `VITE_PHOTO_API_BASE_URL` | 构建时 | 覆盖摄影接口基址 | 否 |
| `ALLOWED_ORIGINS` | `wrangler.toml [vars]` | ★ 来源白名单（8 项，逗号分隔） | 否 |
| `PORTFOLIO_ORIGIN` | `wrangler.toml [vars]` | 回源地址 `https://shouraisan.github.io/portfolio/` | 否 |
| `COS_THUMB_HOST` | `wrangler.toml [vars]` | 上海 COS **默认端点**（非 cos-website） | 否 |
| `COS_THUMB_PREFIX` | `wrangler.toml [vars]` | `thumbs` | 否 |
| `PHOTO_SIGNING_SECRET` | Worker secret | ★ HMAC 签名 + AES-GCM 引用密钥（≥32 字节） | **是** |
| `PHOTO_ASSET_ID_SECRET` | Worker secret（可选） | 覆盖 assetId 派生密钥，未设则回落签名密钥 | **是** |
| `PHOTO_EXIF_SCAN` | Worker var（可选） | `'true'` 才启用 EXIF 扫描 | 否 |
| `PHOTO_PUBLIC_ORIGIN` | Worker var（可选） | 覆盖 manifest 里签名 URL 的基址，未设则用请求 host | 否 |
| `CONVERTER_TOKEN` | 转换 Worker secret | 批量转换接口 Bearer token | **是** |
| `TENCENT_CLOUD_SECRET_ID` / `_SECRET_KEY` | GitHub Secrets | coscmd 上传凭据 | **是** |
| `TENCENT_COS_BUCKET` / `TENCENT_COS_REGION` | GitHub Secrets（可选） | 切换部署目标，默认 `kensym-1331415098` / `ap-hongkong` | 否 |

`.env.example` 里两个 `VITE_*` 只是样例，**真实 secret 绝不进仓库、`.env` 或 `wrangler.toml` 明文**。本地 `wrangler dev` 的密钥放 `.dev.vars`（已 gitignore）。

---

## 8. 部署链路

### 8.1 站点（双节点，同一次 push 触发两条流水线）

```
git push main
   ├─► .github/workflows/deploy.yml      构建 → upload-pages-artifact → deploy-pages（国外节点）
   └─► .github/workflows/deploy-cos.yml  构建 → coscmd 上传香港 COS（国内节点）→ 部署后自检
```

**`deploy-cos.yml` 的关键细节（改动前必读）**：

- pnpm 版本**只在** `package.json` 的 `packageManager` 指定；action 里不能再写 `version`，否则报 `Multiple versions of pnpm specified`。
- 分类型上传以设置差异化缓存：
  - `dist/assets/` → `Cache-Control: public, max-age=31536000, immutable`（文件名含内容哈希）
  - `favicon.svg` → `max-age=86400`
  - `*.html` → `no-cache`（入口文件必须不缓存）
- **绝不能给上传加 `-s`（sync）**：coscmd 的 sync 会按「同名同内容」跳过，连 `Cache-Control` 元数据都不更新，导致缓存头永远写不进去。`dist` 仅约 283 KB，全量重传的代价可忽略。
- `-H` 头的取值经查 coscmd 源码确认：`cos_comm.py` 的 maplist 里有 `'Cache-Control': 'CacheControl'` 映射才会真正生效，其它头会被塞进 `x-cos-meta-*`。
- 清理旧文件默认**关闭**（`sync_delete=false`），且需要子用户具备 `cos:DeleteObject` 权限。
- 部署后自检：静态网站端点探测 `""`、`photography/`、`capabilities/` 必须 200；用默认端点实测 3 个 JS/CSS 的 `Cache-Control` 是否真生效。任一不达标即 `exit 1`。
- 会写一份公开可读的 `deploy-report.txt`（只含元数据：status/time/commit/site/files/pages_ok/assets_cache/sync_delete），一次 HTTP 请求即可确认部署结果，无需翻 Actions 日志。
- 结尾 `rm -f ~/.cos.conf` 清理 runner 上的临时凭据。

**`deploy.yml` 的注意点**：它用 `npm install --no-package-lock`（不走 pnpm），与 `deploy-cos.yml` 不一致，但可正常工作。

### 8.2 Worker

```powershell
# 首次
pnpm exec wrangler login
pnpm exec wrangler secret put PHOTO_SIGNING_SECRET     # ≥32 字节随机值
# 常规部署
pnpm worker:check      # 先 dry-run
pnpm worker:deploy
```

⚠️ `wrangler.toml` 里 `[[r2_buckets]]` 的 `photo` 绑定了 `remote = true`（本地 dev 读远端桶）。部署前确认这是有意为之。

### 8.3 双节点数据流对照

| 环节 | 国内节点 | 国外节点 |
| --- | --- | --- |
| 站点文件来源 | 香港 COS `kensym-1331415098` | GitHub Pages `/portfolio/`（由 `*.dpdns.org` 经 Cloudflare 代理加速） |
| 视频 | Worker `/media/*` → R2 `video` | 同上 |
| 缩略图 / 预览图 | Worker → **上海 COS** `photo-1331415098`（回落 R2） | Worker → **R2**（回落上海 COS） |
| 灯箱原图 | Worker → R2 `photo` | 同上 |
| 摄影清单 | Worker `/photo/manifest`（同源） | 同源（经 Cloudflare 代理） |

---

## 9. 已知坑与屎山清单（接手前必读）

### 9.1 架构级陷阱（踩了会全线挂）

| # | 问题 | 后果 | 规避 |
| --- | --- | --- | --- |
| A1 | **裸域 `kensym15.top` 必须留在 COS** | 若给 Worker 加 `kensym15.top/*` 路由，国内静态站会被 Worker 吞掉；且 `isChinaNodeRequest` 依赖该 origin 判定走上海 COS，分流随之失效 | 只在 `kensym15.dpdns.org` 上加路由 |
| A2 | **国内/国外分流的判定依据是 `Origin`/`Referer`** | 若请求头被剥离、或用户从图片直链打开，会落到 R2（国内变慢），不会报错但性能下降 | 别在请求链路上抹掉这些头 |
| A3 | **`ALLOWED_ORIGINS` 必须同时包含两个域名的全部变体** | 缺一项 → 对应侧图片全部 **403 + CORS 报错** | 注意 `kensym15.top` **裸域与 www 都要列**；上海 COS 的 `cos-website.` 与 `cos.` **两个 host 都要列**；`null` 项是给沙箱 iframe/扩展用的，安全边界实际由 Referer 兜底 |
| A4 | **`vite.config.js` 里 manifest URL 的 `replaceAll` 写死了 `kensym15.dpdns.org`** | 换域名后本地预览的图片 URL 不会被改写成 `/photo/…`，浏览器会带 `Origin: null`（跨源 img）→ `isTrustedRequest` 只靠 Referer 通过、但 `__origin` 缓存键错乱，**图片可能整片 403** | 换域名时同步改这两处（`vite.config.js` 与 `src/photography.jsx` 的 `remotePhotoBase`） |
| A5 | **`portfolioUrl()` 的路径拼接对 `/photography/` 这种带尾斜杠的目录不完美** | 经 Worker 回源该路径时可能 404（只在直接访问 Worker 域名时才会遇到，正常访客走 COS/Pages 不经此逻辑） | 需要时显式请求 `/photography/index.html` |
| A6 | **`/media/*` 的文件名 → R2 对象名是手工维护的 Map** | 视频改名或新增视频必须**同时**改 `worker/src/index.js` 的 `media` Map 和 `src/main.jsx` 的 `projects[].mediaPath`（且 `mediaPath` 要 URL 编码） | 两处不同步即 404 |

### 9.2 数据与缓存不一致

| # | 问题 | 说明 |
| --- | --- | --- |
| B1 | 清单 TTL 三处不一致 | 页面每 60s 检查、响应 `max-age=60`、Worker 模块级目录缓存 **5 分钟**。改元信息后最多 5 分钟才生效 |
| B2 | 缓存键含 `__origin` | 国内/国外各缓存一份 `/photo/image/*`。这是**有意设计**（防跨节点污染 + 防过期签名借缓存绕过），但意味着图片缓存不共享、边缘命中率减半 |
| B3 | 候选键枚举的请求放大 | 文件名不在候选集合里时，一次请求最多 24 次尝试。**根因通常是 COS 侧命名与 R2 不一致** |
| B4 | `COS_CATEGORIES` 与 `COS_THUMB_PREFIX` 硬编码 | 新增照片分类要同时改 `worker/src/index.js` 与 COS 上的目录 |
| B5 | `DEMO` 清单仍在生产代码里 | `demoCatalog` + `demoPhotoCategories`（含 `REPLACE_ME/*` 占位）。R2 桶有图时不外显，空桶时才作为预览回落 |

### 9.3 前端脆弱点

| # | 问题 | 说明 |
| --- | --- | --- |
| C1 | **外包图片 + 热链（共 6 处）** | `src/main.jsx` 里 4 张作品封面是 `images.unsplash.com` 硬编码；关于页头像是 `free.picui.cn`；`styles.css` 第 24 行的 `.hero-poster` 首屏大图**也是** unsplash（`photo-1485846234645-…`）。第三方图挂了或国内访问慢，首屏与作品区就破相，且非自有资源 |
| C2 | `styles.css` 覆盖式重复 | 同选择器反复重定义 + 40+ 行单行压缩规则，靠顺序生效。**新样式必须追加到末尾** |
| C3 | 字体依赖 Google Fonts | `styles.css` 第 1 行 `@import` 引入 Manrope / DM Sans，国内不可达 → 全部回落 Microsoft YaHei 且阻塞渲染（见 §6.3） |
| C4 | Hero 背景是**热链图片**而非视频 | `index.html` 里没有 `<video>` 元素，`.hero-poster` 用 unsplash 静态图 + 渐变遮罩。CSS 里同时存在 `.hero video` 规则（无对应元素）。视觉强度低于 `doc/program.md` 描述的「电影感静态大图」自有素材方案 |
| C5 | 编码正确性靠人工 | `main.jsx` 的 `mediaPath` 是手写百分号编码，改错即 404 |

### 9.4 工程 / 仓库卫生

| # | 问题 | 位置 | 状态 |
| --- | --- | --- | --- |
| D1 | `node_modules-broken/` 备份目录 | 根目录 | 已 gitignore，**占磁盘**（含一整套 vite 8.2.2 / react 19.2.8 旧依赖） |
| D2 | ~~根目录 `.pnpm-store/` 未忽略~~ | 根目录 | **实测更正：`.gitignore` 第 7 行已包含 `.pnpm-store/`**，无风险，此前判断有误 |
| D3 | `dist/` 已构建产物 | 根目录 | 已 gitignore，磁盘存在 |
| D4 | `.photo-thumbs/` 一次性脚本与产物 | 根目录 | 已 gitignore；**含本机绝对路径**（`local-map.json` 466 行，含 `I:\Lr调色导出\…`），绝不能提交 |
| D5 | 依赖全部写 `"latest"` | `package.json` | `react`/`react-dom`/`vite`/`lucide-react`/`@vitejs/plugin-react` 全是 `latest`，靠 `pnpm-lock.yaml` 锁版本 → 任何无锁安装都可能跳大版本 |
| D6 | 版本漂移 | 磁盘 vs lock | 磁盘上同时存在 vite 8.3.0 与 8.3.4、react 19.3.0 与 19.2.8、lucide 1.47.0 与 1.54.0 等多个副本（D1 的残留） |
| D7 | 文档引用不存在的文件 | `doc/design.md` | 多次指向 `worker/wrangler.toml`，实际配置在**根目录** `wrangler.toml` |
| D8 | Actions 页面自检清单硬编码 | `deploy-cos.yml` | `"" "photography/" "capabilities/"` 是写死的；新增页面不会自动纳入验证，容易「部署成功但新页不可达」 |
| D9 | ~~本目录不含 git 元数据~~ | 根目录 | **实测更正：本目录就是完整的 git 工作仓库。** `origin` = `https://github.com/ShouraiSan/portfolio.git`，分支 `main`。初始提交 `1e7ec9e4`「Deploy portfolio website」。**注意工具陷阱**：`glob` 会静默排除 `.git/`（即使 `**` 与 `*` 模式），判断 VCS 状态必须用 read/grep 直接读 `.git/`，不要用 glob |
| D10 | 测试覆盖不均 | `worker/test/` | `photo.test.js`（293 行，覆盖签名/CORS/双源分流/越权/非法路径）+ `photo-catalog.test.js`（69 行）+ `image-converter/test/worker.test.js`。但**视频 `/media/*` 与页面回源逻辑没有测试** |
| D11 | 空的 `public/assets/` 目录 | `public/` | **0 个文件**，git 未跟踪（`public/` 下仅 `favicon.svg` 被跟踪），源码中无任何引用 —— 某次实验的回滚残留。Vite 会把它当静态目录扫描，可安全删除（本次未动） |

---

## 10. 改动边界（安全操作守则）

**可以直接改**

- 三个页面组件里的文案、作品/能力数组（`projects` / `strengths` / `practices`）。
- `styles.css` **末尾追加**新样式。
- 新增页面：按 §4.1 的约定加目录 + `index.html` + `input` 条目（同时更新 `deploy-cos.yml` 的自检清单）。
- `wrangler.toml` 的 `ALLOWED_ORIGINS`（**只能加，不能删**）与 `[vars]`。

**改了必须同步（否则线上坏）**

| 改动 | 必须同步的位置 |
| --- | --- |
| 新增/重命名视频 | `worker/src/index.js` 的 `media` Map + `src/main.jsx` 的 `mediaPath`（URL 编码）+ R2 `video` 桶对象名 |
| 新增照片分类 | `worker/src/index.js` 的 `COS_CATEGORIES` + COS 上传目录 |
| 更换站点域名 | `ALLOWED_ORIGINS` + `src/photography.jsx` 的 `remotePhotoBase` + `vite.config.js` 的 `replaceAll` 正则 |
| 更换 COS 图床 | `COS_THUMB_HOST` / `COS_THUMB_PREFIX` + 同步上传脚本 |
| 改 `PHOTO_SIGNING_SECRET` | 所有历史签名 URL 立即失效（预期行为），`assetId` 也会重算 → 前端缓存需失效 |

**不要做**

- ❌ **改完不 push。** 每次改动完成后必须 `git add -A && git commit && git push origin main`，否则线上不会更新（详见 §0.1 铁律）。
- ❌ 给裸域 `kensym15.top` 加 Worker 路由（见 A1）。
- ❌ 把 R2 `photo` 桶设为公开 / 打开 `r2.dev` 公共访问。
- ❌ 把 `PHOTO_SIGNING_SECRET`、`CONVERTER_TOKEN`、腾讯云密钥写进仓库、`.env`、`wrangler.toml` 明文或日志。
- ❌ 在 `/photo/*` 响应里返回 `objectKey`、bucket 域名或原图直链。
- ❌ 声称「签名方案能阻止用户保存/截屏已显示图片」（做不到，文档和 UI 都不能这么写）。
- ❌ 给 `coscmd upload` 加 `-s`（见 §8.1）。
- ❌ 在摄影页把 `*.workers.dev` 当 API 域名（国内不可达）。

---

## 11. 审计发现的清理/优化项（附处理决定）

> 本次任务范围是**只产出本文档，未改动任何代码或配置**。以下是审计发现的实体垃圾与优化点，供后续按需取用。
>
> **已决策（用户确认）**：**第一批「纯删除」项不做** —— `node_modules-broken/`、`dist/`、`.photo-thumbs/`、根目录 `.pnpm-store/` **保留不动**。后续接手者**不要再提议删除这些目录**。
> **仍开放**：第二批（配置修正）与第三批（重构）未决策，可按需推进。

**第一批 · 纯删除 —— 已决定保留，不再处理**

1. ~~删除 `node_modules-broken/`（D1）~~
2. ~~删除 `dist/`（D3）~~
3. ~~删除 `.photo-thumbs/`（D4）~~
4. ~~删除根目录 `.pnpm-store/`（D2）~~

**第二批 · 配置修正（未处理）**

5. ~~把 `.pnpm-store/` 追加进 `.gitignore`~~ —— **实测已包含**，无需处理。
6. 把 `package.json` 里的 `"latest"` 全部换成 lock 中的实际版本（React 19.3.0 / Vite 8.3.0 / lucide-react 1.47.0 / @vitejs/plugin-react 6.1.x），消除 D5 的大版本漂移风险。
7. 修正 `doc/design.md` 里对 `worker/wrangler.toml` 的错误引用（D7）。

**第三批 · 需要决策的重构（未处理）**

8. **`src/styles.css` 去重**（C2）：把末尾 40+ 行重复/覆盖规则合并回各自区块，统一到一个可维护结构。**风险中等**（覆盖顺序敏感），需要逐页视觉回归。
9. **外包图片落地**（C1，共 6 处）：首屏 `.hero-poster`、4 张作品封面（unsplash）、关于页头像（picui）全部迁到自有存储。建议复用 R2 `photo` 桶 + 现有签名链路，或最小改动放 COS。
10. **字体自托管**（C3）：下载 Manrope / DM Sans woff2 子集，放 COS（国内）与 R2（国外），改 `@font-face` + `font-display: swap`，去掉第 1 行的 Google Fonts `@import`。**这是国内节点视觉一致性的关键修复。**
11. **补测试**（D10）：为 `/media/*` 视频代理（Range 请求、白名单拒绝）与页面回源逻辑添加 `node:test` 用例。
12. **页面自检清单外部化**（D8）：让 `deploy-cos.yml` 从 `dist/` 实际产出推导待探测路径，替代硬编码列表。

**第四批 · 已完成**

13. ✅ **国内节点的 JPG 原图改走上海桶** —— **已实现并测试通过**。
    - 实现方式：**没有**扩展签名/`ref` 结构。原图路由改为按来源选源（`fetchCosOriginal()` + R2 兜底），COS key 由 `originalKeysFor()` 从 R2 `objectKey` 派生候选（`spaceVariant` 定向还原分隔符下划线）。
    - 之所以不需要动签名：`ref` 里已经有 R2 `objectKey`，而 COS key 可由它确定性派生 —— 派不出的情况用候选兜底，命中不了再回落 R2，因此不必把两套 key 都塞进签名。
    - 数据侧无需上传：上海桶本来就是三层全量镜像（见 §3.3 的实测表）。
    - 新增 6 条测试；3 组变异测试确认它们能抓住回归（移除空格变体 → 2 条红；原图分流不区分国内外 → 1 条红；移除兜底 → 1 条红）。测试总数 20 → **26**。

**第五批 · 待决策**

14. **上海桶公开可读的处置**（安全，见 §5.2 实测偏差）。三个选项：
    - (a) **接受现状**：泄漏的是 800px 缩略图、2000px 预览图与 6–32 MB 的 JPG 原图；而这些图本来就会显示给访客。成本最低。
    - (b) **关掉公共读**：桶改为私有。**注意这会让国内侧全部失效** —— `fetchCosImage()` / `fetchCosOriginal()` 都是无凭据的普通 `fetch`，私有桶必须改用带 COS 签名的请求（手写 COS v5 签名或引入 SDK）才能继续工作。
    - (c) **改用 COS 私有 + Worker 侧签名请求**：最彻底但最复杂，工作量最大。
15. **照片桶内的 `assets/` 残留**（15 个对象）。配 ListBucket 权限后枚举发现：照片桶 `photo-1331415098` 的 `assets/` 前缀下躺着**旧站点构建产物**（`main-*.js`、`jsx-runtime-*.css` 等，hash 与当前构建均不匹配），是早年误传。**不影响照片功能**（`loadPhotoCatalog` 只收 `.jpg/.jpeg`），但白占空间。
    另注：桶内每个分类目录与 `thumbs/`、`previews/` 下都有一个 **0 字节目录占位对象**（`人像/`、`thumbs/` 等，COS 控制台建目录时生成），属正常现象，无需处理。
16. **`local-map.json` 与实际桶命名的差异**（信息，非缺陷）。`.photo-thumbs/local-map.json` 记录的 key 是「空格→下划线」形态（`人像/bocchi_(5_-_12).jpg`），而桶内实测是**保留空格**形态（`bocchi (5 - 12)`）。若日后用它做同步脚本，不要直接当 COS key 用。

---

## 12. 演进路线（短期维持现状，以下为预留方向）

当前形态是**纯静态 + Serverless 媒体层，无数据库/无登录/无 CMS**。短期维持，以下方向可按需推进（按投入从小到大）：

### 12.1 R2 清单外部化（最小改动，收益明确）

**目标**：不必为了改一条标题/年份而重新部署 Worker。

- 现状：`loadPhotoCatalog()` 直接 `list` 整个桶 + 读元信息，目录缓存 5 分钟。
- 方案：在 `photo` 桶放一个保留对象（如 `_catalog.json`），先读它；缺失或校验失败时回落到现有的自动扫描。因为 `listImages()` 已经排除以 `_` 开头的 key，这个保留对象**不会污染清单**——代码里已经预留了这个约定。
- 同时把 `PHOTO_EXIF_SCAN` 的负担彻底移出请求路径：上传时写好 customMetadata（`title`/`year`/`camera`/`lens`/`description`/`width`/`height`/`focalPoint`，代码已全部支持且优先级最高）。

### 12.2 轻量后台（中等投入）

- 用 Cloudflare Access（或单个 `ADMIN_TOKEN` secret）保护一组管理接口：改元信息、改分类、触发转换、下架照片。
- 写操作只落 `_catalog.json` 覆盖层，**不动原图**；这样回滚只需删覆盖层。
- 复用现有鉴权思路（HMAC + 恒定时间比较），不要另造一套。

### 12.3 图片处理增强

- 现状：AVIF 由**独立 Worker 手动批量触发**（`photo-avif-batch`），上海 COS 的副本另行同步。
- 方向 A：把「转 AVIF」接入 R2 事件通知 / 队列，上传即自动转换，替代人工触发。
- 方向 B：**取消上海 COS 副本**，改用 Cloudflare 中国网络或直接上自定义域 + 智能加速，减少一份数据同步与命名不一致的坑（对应 B3、B4）。
- 方向 C：若坚持双源，把「R2 原图 → COS 变体」的同步脚本进仓库（目前是 `.photo-thumbs/` 里的一次性脚本，见 D4），并让命名转换规则**单一来源**，消除候选键枚举兜底。
- ⚠️ **不要启用 Cloudflare Images 的按需变换**：`worker/README.md` 与代码注释都明确记录了当前策略是「不依赖 Images 变换，缩略图/预览图由外部生成并写回存储」，且 `PHOTO_EXIF_SCAN` 默认关闭正是为了规避 Worker CPU 限制。按需变换会重新引入 CPU 与缓存变体爆炸问题。

### 12.4 内容与 SEO

- 目前三个页面只有 `<title>`，摄影页额外有 `<meta name="description">`。缺 Open Graph / Twitter Card → 分享到社交平台无预览图。
- 缺 `sitemap.xml` / `robots.txt` / 结构化数据（`Person` / `ImageObject`）。
- 作品目前只有弹窗播视频，没有独立详情页（`doc/program.md` §7 已提出这个方向：创作背景、职责范围、剧照、制作过程）。

### 12.5 工程化

- **初始化 git 仓库并接远端**（D9）—— 这是让现有两条 Actions 流水线真正可用的前提。
- 引入样式方案约束（或至少把 `styles.css` 拆分 + 去重）以阻止 C2 继续劣化。
- 统一 `deploy.yml` 与 `deploy-cos.yml` 的包管理器与 Node 版本。

---

## 13. 维护 SOP（照着做即可）

### 13.1 本地开发

```powershell
pnpm install
pnpm dev                  # http://127.0.0.1:5173
```

- `/` 首页、`/capabilities/` 能力页、`/photography/` 摄影页。
- 摄影页在 DEV 下走 `/photo`，由 `vite.config.js` 的 `localPhotoApi` 插件处理：
  1. 先尝试代理到 `http://127.0.0.1:8788`（若你在另一个终端跑了 `pnpm worker:dev`）。
  2. 失败则回落到**内联调用 Worker**，用一次性随机 secret + 空 R2 桩 → 显示 DEMO 清单。
- 需要看**真实远端 R2 照片**时，另开一个终端：

```powershell
pnpm worker:dev --var "PHOTO_SIGNING_SECRET:local-preview-secret"
```

- 验证：`pnpm test`、`pnpm build`。真实 JPG 读取必须靠部署后的远端 R2 binding 才能端到端验证。

### 13.2 新增一个作品视频

1. 上传 mp4 到 R2 `video` 桶，记下**确切对象名**（含中文/全角括号）。
2. 在 `worker/src/index.js` 的 `media` Map 加一行 `['slug.mp4', 'R2里的真实名.mp4']`。
3. 在 `src/main.jsx` 的 `projects` 加一项，`mediaPath` 用 **URL 编码后**的 slug，`image` 放封面。
4. `pnpm test && pnpm build`，本地点开验证播放与 Range 拖拽。
5. `pnpm worker:deploy` 部署 Worker；push `main` 触发两条站点流水线。

### 13.3 新增一张照片

1. 按 `分类/文件名.jpg` 上传 JPG 原图到 R2 `photo` 桶（一级目录即页面分类）。**只有 `.jpg`/`.jpeg` 进清单**，且 key 不能以 `_` 开头。
2. 建议同时写 customMetadata（`title`/`year`/`camera`/`lens`/`description`/`width`/`height`/`focalPoint`）—— 否则在不开启 EXIF 扫描时只能靠文件名推断。
3. 生成 AVIF 变体：
   - R2 侧：调 `photo-avif-batch`（带 Bearer token 与 `?prefix=`）。
   - 上海 COS 侧：把 `thumbs/<分类>/<名>.avif`（约 800px、~41 KB）与 `previews/<分类>/<名>.avif`（2000px、~220 KB）同步上传到桶 `photo-1331415098`。**注意命名一致性**（见 §5.5），命名不一致会触发候选键枚举兜底甚至 404。
4. `assetId` 与 `version`（ETag）由 Worker 自动派生，无需手动维护；换原图后 URL 自动变化。
5. 若新增了分类，同步更新 `worker/src/index.js` 的 `COS_CATEGORIES` 并重新部署。

### 13.4 部署站点

本目录就是 git 工作仓库，直接提交推送即可：

```powershell
git add -A ; git commit -m "..." ; git push origin main
```

推送后由两条 Actions 流水线分别发布到 GitHub Pages（国外）与香港 COS（国内）。
**仓库信息**：`origin` = `https://github.com/ShouraiSan/portfolio.git`，分支 `main`。

两条流水线并行执行。完成后用一次 HTTP 请求确认结果：

```
https://kensym-1331415098.cos.ap-hongkong.myqcloud.com/deploy-report.txt
```

看 `status=OK`、`pages_ok=yes`、`assets_cache=3/3`。缓存头未生效是最常见的失败（见 §8.1 的 `-s` 说明）。

### 13.5 部署 Worker

```powershell
pnpm worker:check      # dry-run，先看有没有配置错误
pnpm worker:deploy
```

### 13.6 故障速查

| 症状 | 优先排查 |
| --- | --- |
| 摄影页全部 403 + CORS 报错 | `ALLOWED_ORIGINS` 是否缺当前域名变体（裸域/www、`cos.`/`cos-website.`）—— 见 A3 |
| 摄影页图片全部加载失败（页面能开） | 是否误用了 `*.workers.dev` 域名；国内不可达 —— 见 §4.2 |
| 某几张图 404 | 文件名是否落在 `thumbCandidates` 候选集合里；COS 侧命名是否与 R2 一致 —— 见 B3、§5.5 |
| 换个域名后本地预览图片全挂 | `vite.config.js` 的 `replaceAll` 正则没跟着改 —— 见 A4 |
| 视频 404 | `media` Map 与 `main.jsx` 的 `mediaPath` 不同步 —— 见 A6 |
| 国内访问图片慢 | 请求是否落到 R2（`Origin`/`Referer` 被剥离）—— 见 A2 |
| 改了照片元信息但不生效 | 目录缓存 5 分钟 TTL —— 见 B1 |
| 部署成功但新页面不可达 | `deploy-cos.yml` 的硬编码自检清单没更新 —— 见 D8 |
| Actions 报 `Multiple versions of pnpm specified` | `pnpm/action-setup` 里又写了 `version` —— 见 §8.1 |
| COS 上缓存头为空 | 上传时加了 `-s` —— 见 §8.1 |

---

## 14. 参考文档索引

| 文档 | 内容 | 可信度 |
| --- | --- | --- |
| `readme.md`（本文） | 完整交接手册 | **当前权威** |
| `worker/README.md` | 主 Worker 的部署步骤、内容维护、缓存与安全设计 | **权威**（与代码一致） |
| `image-converter/README.md` | AVIF 转换 Worker 的部署与触发 | **权威** |
| `doc/program.md` | 站点定位、板块内容、文案与视觉规范来源 | 内容仍有参考价值；「代码实现参考」章节已过时（页面路径已改为目录形式） |
| `doc/design.md` | 摄影页的历史需求稿与 11 条验收标准 | 需求意图有效；其中的文件路径引用有漂移（§3 提到 `worker/wrangler.toml`） |
| `src/styles.css` 内注释 | 部分设计决策的原始说明 | 权威 |
| `vite.config.js` 内注释 | 新增页面的既定约定、去 crossorigin 的原因 | 权威 |

---

## 15. 交接后第一步建议

1. 读 §9「已知坑」全表 —— 这是最容易让你改坏线上的一节。
2. 读 `worker/src/index.js`（454 行，全文注释充分，是理解整条媒体链路的核心）。
3. 读 `worker/README.md` —— 部署与维护细节的权威来源。
4. 跑一遍 `pnpm install && pnpm test && pnpm build`，确认本地基线是绿的。
5. 需要动内容 → 按 §13 的 SOP；需要动架构 → 先读 §10 改动边界与 §12 演进路线。
