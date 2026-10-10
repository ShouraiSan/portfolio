import { loadPhotoCatalog } from './photo-catalog.js';

const media = new Map([
  ['2026japan_tour.mp4', '2026japan_tour.mp4'],
  ['Hokkaidou_tour（4k）.mp4', 'Hokkaidou_tour（4k）.mp4'],
  ['KANSAI(4k).mp4', 'KANSAI(4k).mp4'],
  ['未知彼时花开名.mp4', '未知彼时花开名.mp4'],
]);

// DEMO / 待替换：仅在这里替换分类、记录与 R2 objectKey，并上传对应原图。
// objectKey 永远不会由 manifest 或错误响应返回给浏览器。
const demoPhotoCategories = ['全部', '人像', '风光', '街头', '手办'];
const demoPhotoManifest = [
  { assetId: 'a7f81d2e-94c6-4b37-b815-3e60e1d9af42', objectKey: 'REPLACE_ME/portrait-01.jpg', title: '待命名人像 01', category: '人像', year: '2026', camera: '待替换', lens: '', description: 'DEMO / 待替换作品信息', width: 4, height: 5, focalPoint: '50% 40%', version: 'demo-1', pending: true },
  { assetId: 'e293cb7a-356d-48a2-8d93-0a77114603f5', objectKey: 'REPLACE_ME/landscape-01.jpg', title: '待命名风光 01', category: '风光', year: '2026', camera: '待替换', lens: '', description: 'DEMO / 待替换作品信息', width: 3, height: 2, focalPoint: '50% 50%', version: 'demo-1', pending: true },
  { assetId: '59bcfa30-0ca4-4596-93de-41947a8fb728', objectKey: 'REPLACE_ME/street-01.jpg', title: '待命名街头 01', category: '街头', year: '2026', camera: '待替换', lens: '', description: 'DEMO / 待替换作品信息', width: 4, height: 3, focalPoint: '50% 50%', version: 'demo-1', pending: true },
  { assetId: 'cf1048bd-9f61-4562-ae4b-1e29fa6de827', objectKey: 'REPLACE_ME/figure-01.jpg', title: '待命名手办 01', category: '手办', year: '2026', camera: '待替换', lens: '', description: 'DEMO / 待替换作品信息', width: 2, height: 3, focalPoint: '50% 50%', version: 'demo-1', pending: true },
  { assetId: 'd6153ca9-8642-4d6d-8efd-b47ce77a9620', objectKey: 'REPLACE_ME/portrait-02.jpg', title: '待命名人像 02', category: '人像', year: '2026', camera: '待替换', lens: '', description: 'DEMO / 待替换作品信息', width: 5, height: 4, focalPoint: '50% 50%', version: 'demo-1', pending: true },
  { assetId: '2e9b731f-5f16-4ea4-bda7-c02315527c39', objectKey: 'REPLACE_ME/landscape-02.jpg', title: '待命名风光 02', category: '风光', year: '2026', camera: '待替换', lens: '', description: 'DEMO / 待替换作品信息', width: 16, height: 10, focalPoint: '50% 50%', version: 'demo-1', pending: true },
];
const demoCatalog = {
  demo: true,
  categories: demoPhotoCategories,
  photos: demoPhotoManifest,
  photosById: new Map(demoPhotoManifest.map((photo) => [photo.assetId, photo])),
};

const SIGNATURE_TTL_SECONDS = 15 * 60;
const encoder = new TextEncoder();

function trustedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function requestOrigin(value) {
  try { return value ? new URL(value).origin : null; } catch { return null; }
}

function corsHeaders(origin, allowed) {
  return origin && allowed.includes(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, ETag',
    'Vary': 'Origin',
  } : {};
}

function isTrustedRequest(request, allowed) {
  const origin = request.headers.get('Origin');
  const refererOrigin = requestOrigin(request.headers.get('Referer'));
  return Boolean(refererOrigin && allowed.includes(refererOrigin)) && (!origin || allowed.includes(origin));
}

function portfolioUrl(request, env) {
  const site = new URL(env.PORTFOLIO_ORIGIN);
  const requestUrl = new URL(request.url);
  const path = requestUrl.pathname === '/' ? '' : requestUrl.pathname.replace(/^\//, '');
  return new URL(path + requestUrl.search, site);
}

function applySecurityHeaders(headers) {
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('X-Content-Type-Options', 'nosniff');
}

function photoHeaders(cors = {}) {
  const headers = new Headers(cors);
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  applySecurityHeaders(headers);
  return headers;
}

function jsonResponse(value, status, cors, cacheControl = 'no-store') {
  const headers = photoHeaders(cors);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', cacheControl);
  return new Response(JSON.stringify(value), { status, headers });
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

// ---------------------------------------------------------------------------
// 腾讯云 COS v5 请求签名（HMAC-SHA1，与照片用的 HMAC-SHA256 不同）
//
// 算法照 https://cloud.tencent.com/document/product/436/7778 与官方 Node SDK
// （cos-nodejs-sdk-v5/sdk/util.js 的 getAuth）逐条实现：
//   1. SignKey     = HMAC-SHA1(SecretKey, KeyTime)
//   2. FormatString= method \n pathname \n urlParams \n headers \n
//   3. StringToSign= "sha1" \n KeyTime \n SHA1(FormatString) \n
//   4. Signature   = HMAC-SHA1(SignKey, StringToSign)
//
// 关键约束：
//   * pathname 必须是**请求里实际发送的那种 URL 编码形态**（SDK 的 UseRawKey 语义），
//     不做解码，否则 key 含中文/空格时签名不匹配。
//   * 参与签名的 header 名在 Authorization 里必须小写，且按小写字典序排列。
//   * 我们只签 host 一个头，也没有 query 参数，因此两个 list 字段分别是 "host" 与 ""。
// ---------------------------------------------------------------------------
const COS_AUTH_EXPIRES_SECONDS = 600;

// 与 SDK 的 camSafeUrlEncode 一致：encodeURIComponent 之外还要转义 ! ' ( ) *
function camSafeUrlEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

async function hmacSha1Hex(value, key) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha1Hex(value) {
  const digest = await crypto.subtle.digest('SHA-1', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// 生成 Authorization 头。now 可注入，便于测试得到确定性结果。
export async function cosAuthorization({ secretId, secretKey, method, host, pathname, now }) {
  const startedAt = now ?? Math.floor(Date.now() / 1000);
  const keyTime = `${startedAt};${startedAt + COS_AUTH_EXPIRES_SECONDS}`;

  // 步骤一：SignKey
  const signKey = await hmacSha1Hex(keyTime, secretKey);

  // 步骤二：FormatString。无 query、仅签 host。
  const formatString = [
    String(method || 'get').toLowerCase(),
    pathname,
    '',        // urlParamList：无 query 参数
    'host=' + camSafeUrlEncode(host).toLowerCase(),
    '',
  ].join('\n');

  // 步骤三：StringToSign
  const stringToSign = ['sha1', keyTime, await sha1Hex(formatString), ''].join('\n');

  // 步骤四：Signature
  const signature = await hmacSha1Hex(stringToSign, signKey);

  // 步骤五：Authorization
  return [
    'q-sign-algorithm=sha1',
    'q-ak=' + secretId,
    'q-sign-time=' + keyTime,
    'q-key-time=' + keyTime,
    'q-header-list=host',
    'q-url-param-list=',
    'q-signature=' + signature,
  ].join('&');
}

// ── 签名用的 pathname 必须是「解码形态」 ──────────────────────────────────
// 这一点极易搞错，且**只有对真实 COS 发请求才能发现**（单元测试与官方 SDK 移植
// 都验证不出来，因为 SDK 的 pathname 本身就是未编码的原始 key）。
//
// 实测依据：服务端在 403 响应里回显它参与计算的 FormatString ——
// 对请求路径 `/thumbs/%E4%BA%BA%E5%83%8F/_DSC6557.avif`，它用的是解码后的
// `/thumbs/人像/_DSC6557.avif`。用解码形态签名 → 200；用编码形态 → SignatureDoesNotMatch。
//
// 因此这里对 requestUrl.pathname 做一次解码再签名，而实际请求仍用带编码的 URL 发出。
function signingPathname(url) {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    // 路径含非法百分号序列时退回原样，避免因解码异常导致整个取图失败
    return url.pathname;
  }
}
export { signingPathname };

// 统一出口：配了 COS 只读凭据就带签名请求，未配则维持匿名请求。
// 这样密钥注入是渐进式的 —— rollout 期间站点不会因为缺少 secret 而中断。
// 导出是为了让真实桶验证脚本能直接调用生产实现，而不是另写一份副本。
export async function cosFetch(env, url) {
  const secretId = String(env.COS_SECRET_ID || '');
  const secretKey = String(env.COS_SECRET_KEY || '');
  const requestUrl = new URL(url);
  const headers = { 'User-Agent': 'Kensym Portfolio Worker' };
  if (secretId && secretKey) {
    headers.Authorization = await cosAuthorization({
      secretId,
      secretKey,
      method: 'GET',
      host: requestUrl.host,
      pathname: signingPathname(requestUrl),
    });
  }
  return fetch(requestUrl, { method: 'GET', headers, signal: AbortSignal.timeout(30_000) });
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function signaturePayload(assetId, variant) {
  const payload = [assetId, variant.version, variant.exp, variant.ref || ''];
  if (variant.variant && variant.variant !== 'original') payload.push(variant.variant);
  return payload.join('|');
}

async function referenceKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`photo-reference|${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function createPhotoReference(photo, secret, key = photo.objectKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify({ key, version: photo.version }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await referenceKey(secret), plaintext);
  const payload = new Uint8Array(iv.length + ciphertext.byteLength);
  payload.set(iv);
  payload.set(new Uint8Array(ciphertext), iv.length);
  return base64Url(payload);
}

async function readPhotoReference(value, secret) {
  try {
    if (!/^[A-Za-z0-9_-]{20,1024}$/.test(value || '')) return null;
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    const payload = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.slice(0, 12) }, await referenceKey(secret), payload.slice(12));
    const reference = JSON.parse(new TextDecoder().decode(plaintext));
    return typeof reference.key === 'string' && typeof reference.version === 'string' ? reference : null;
  } catch { return null; }
}

export function normalizePhotoRequest(searchParams) {
  const value = {
    version: searchParams.get('v') || '',
    exp: Number(searchParams.get('exp')),
    ref: searchParams.get('ref') || '',
  };
  const variant = searchParams.get('variant') || '';
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(value.version) || !Number.isSafeInteger(value.exp)
    || !/^[A-Za-z0-9_-]{20,1024}$/.test(value.ref)
    || (variant && variant !== 'avif' && variant !== 'thumb' && variant !== 'preview')) return null;
  if (variant) value.variant = variant;
  return value;
}

// 摄影页网格缩略图的对象键。
// 必须用 R2 对象键（objectKey）而不是 title：title 由 filenameTitle() 生成，
// 其中 /[_-]+/g 会被替换成空格，连字符与下划线信息已丢失
// （例如 "bocchi (5 - 12)" 会变成 "bocchi (5   12)"），无法还原真实文件名。
// R2 与 COS 的文件名在分隔符与前导下划线上可能有差异，因此按变体逐个尝试。
const COS_CATEGORIES = ['人像', '手办', '街头', '风光'];

export function thumbCandidates(objectKey) {
  const filename = String(objectKey || '').split('/').at(-1).replace(/\.[^.]+$/, '');
  let decoded = filename;
  try { decoded = decodeURIComponent(filename); } catch { /* 保留原样 */ }
  // 四组基名：原名、连字符→下划线、下划线→连字符、空格→下划线。
  // 「原名」这一组通常直接命中 —— 实测 COS 的 thumbs/previews 对象名与 R2 objectKey
  // 一致（含空格与大小写，原样保留），所以后面几组只是容错兜底。
  const bases = [
    decoded,
    decoded.replace(/-/g, '_'),
    decoded.replace(/_/g, '-'),
    decoded.replace(/ /g, '_'),
  ];
  const candidates = [];
  for (const base of bases) {
    candidates.push(base);
    candidates.push(base.replace(/^_+/, ''));
    candidates.push(`_${base.replace(/^_+/, '')}`);
  }
  return [...new Set(candidates.filter(Boolean))];
}

function encodePath(key) {
  return String(key || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

// 缩略图与预览图的对象键。
// 两者都按「分类目录」组织：<prefix>/<分类>/<文件名>.avif
// 预览图额外兼容平铺形式 <prefix>/<文件名>.avif（早期上传没有分类层时的结构）。
// R2 与 COS 的文件名只有分隔符与前导下划线这几处差异，因此按变体逐个尝试。
export function imageKeysFor(photo) {
  const variant = photo.variant === 'preview' ? 'preview' : 'thumb';
  const defaultPrefix = variant === 'preview' ? 'previews' : 'thumbs';
  const prefix = String(photo.prefix || defaultPrefix).replace(/^\/+|\/+$/g, '');
  const category = String(photo.category || '');
  // 已知分类时把它排在第一位，其余分类作为兜底，减少无效请求
  const ordered = COS_CATEGORIES.includes(category)
    ? [category, ...COS_CATEGORIES.filter((c) => c !== category)]
    : COS_CATEGORIES;
  const names = thumbCandidates(photo.objectKey);
  const keys = [];
  for (const cat of ordered) {
    for (const name of names) keys.push(`${prefix}/${cat}/${name}.avif`);
  }
  // 预览图再补一组平铺候选，兼容历史结构
  if (variant === 'preview') {
    for (const name of names) keys.push(`${prefix}/${name}.avif`);
  }
  return keys;
}

// 原图（JPG）在 COS 侧的候选对象键。
// COS 侧原图直接放在一级分类目录下：<分类>/<文件名>，没有额外的前缀层。
// 命名差异与 thumbs/previews 相同：R2 用下划线，COS 保留半角空格
// （58 张里 27 张含空格），且**扩展名大小写逐个文件继承原始命名**
// （实测同桶内既有 `_DSC6557.JPG` 也有 `Chenshan_Park-7889.jpg`），因此不做扩展名归一化。
export function originalKeysFor(objectKey) {
  const key = String(objectKey || '').replace(/^\/+/, '');
  const slash = key.lastIndexOf('/');
  if (slash <= 0) return key ? [key] : [];
  const dir = key.slice(0, slash);
  const filename = key.slice(slash + 1);
  if (!filename) return [];
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  // 首选原名（实测 COS 原图名与 R2 objectKey 一致，含空格与扩展名大小写）；
  // 只额外保留「空格→下划线」这一个反向兜底，防止两侧命名不完全同步。
  const variants = [
    base,
    base.replace(/ /g, '_'),
  ];
  return [...new Set(variants.filter(Boolean).map((name) => `${dir}/${name}${extension}`))];
}

// 从上海 COS 读取原图 JPG（仅国内节点使用；R2 出口免费，国外节点不应跨境读 COS）
async function fetchCosOriginal(env, objectKey) {
  const host = String(env.COS_THUMB_HOST || '').replace(/\/+$/, '');
  if (!host) return null;
  for (const key of originalKeysFor(objectKey)) {
    try {
      const response = await cosFetch(env, `${host}/${encodePath(key)}`);
      if (response.ok && response.body) {
        const length = response.headers.get('Content-Length');
        return { body: response.body, size: length ? Number(length) : undefined, key };
      }
    } catch {
      // 网络异常时继续尝试下一个候选
    }
  }
  return null;
}

// 从 R2 读取图片资源（国外节点走这里：Global CDN 到 R2 更快）
async function fetchR2Image(env, photo) {
  if (!env.photo?.get) return null;
  for (const key of imageKeysFor(photo)) {
    try {
      const object = await env.photo.get(key);
      if (object) return { body: object.body, size: object.size, etag: object.httpEtag };
    } catch {
      // 继续尝试下一个候选键
    }
  }
  return null;
}

// 从上海 COS 读取图片资源（国内节点走这里：免跨境）
async function fetchCosImage(env, photo) {
  const host = String(env.COS_THUMB_HOST || '').replace(/\/+$/, '');
  if (!host) return null;
  for (const key of imageKeysFor(photo)) {
    try {
      const response = await cosFetch(env, `${host}/${encodePath(key)}`);
      if (response.ok && response.body) {
        const length = response.headers.get('Content-Length');
        return { body: response.body, size: length ? Number(length) : undefined };
      }
    } catch {
      // 网络异常时继续尝试下一个候选
    }
  }
  return null;
}

export function isChinaNodeRequest(request) {
  const origin = request.headers.get('Origin') || requestOrigin(request.headers.get('Referer')) || '';
  // 国内入口 kensym15.top（以及本地开发）走上海 COS，其余（GitHub Pages 等）走 R2
  return /(^|\.)kensym15\.top$/i.test(new URL(origin || 'https://invalid/').hostname)
    || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
}

// 按来源选源。R2 是唯一主节点：国外（及一切未识别的来源）只读 R2，绝不触碰上海 COS。
// 只有国内入口 kensym15.top（及本地开发）才把上海 COS 当作首选源，且失败时回落到 R2。
// photo.variant 决定取缩略图（thumbs/）还是预览图（previews/）。
export async function fetchThumb(request, env, photo) {
  if (!isChinaNodeRequest(request)) return fetchR2Image(env, photo);
  return (await fetchCosImage(env, photo)) || (await fetchR2Image(env, photo));
}

export async function createPhotoSignature(assetId, variant, secret) {
  return hmac(signaturePayload(assetId, variant), secret);
}

export async function verifyPhotoSignature(assetId, variant, signature, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!signature || !secret || variant.exp < nowSeconds || variant.exp > nowSeconds + SIGNATURE_TTL_SECONDS + 60) return false;
  const expected = await createPhotoSignature(assetId, variant, secret);
  return constantTimeEqual(expected, signature);
}

async function rateLimit(request, env) {
  if (!env.PHOTO_RATE_LIMITER?.limit) return true;
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  return (await env.PHOTO_RATE_LIMITER.limit({ key })).success;
}

function signedImageUrl(baseUrl, photo, exp, ref, signature, variant = 'original') {
  const url = new URL(`${baseUrl}/photo/image/${photo.assetId}`);
  const params = new URLSearchParams({ v: photo.version, exp: String(exp), ref, sig: signature });
  if (variant !== 'original') params.set('variant', variant);
  url.search = params;
  return url.toString();
}

function avifKeyFor(objectKey) {
  return objectKey.replace(/\.jpe?g$/i, '.avif');
}

async function publicPhoto(photo, baseUrl, exp, secret) {
  const result = {
    assetId: photo.assetId, title: photo.title, category: photo.category, year: photo.year,
    camera: photo.camera, lens: photo.lens, description: photo.description,
    width: photo.width, height: photo.height, focalPoint: photo.focalPoint, pending: photo.pending,
  };
  if (photo.pending) return result;
  // original（灯箱大图）：仍从 R2 读取，流量免费。ref 加密的是 R2 对象键。
  const ref = await createPhotoReference(photo, secret);
  const signature = await createPhotoSignature(photo.assetId, { version: photo.version, exp, ref }, secret);
  const url = signedImageUrl(baseUrl, photo, exp, ref, signature);
  result.original = { url };
  // thumbnail（网格小图）：按来源分流 —— 国内入口读上海 COS，国外节点读 R2。
  // 无论哪个源都经过签名校验，直连对象存储无法绕过。
  const thumbKey = `thumb:${photo.category}/${String(photo.objectKey || '').split('/').at(-1)}`;
  const thumbRef = await createPhotoReference(photo, secret, thumbKey);
  const thumbSignature = await createPhotoSignature(photo.assetId, { version: photo.version, exp, ref: thumbRef, variant: 'thumb' }, secret);
  result.thumbnail = { url: signedImageUrl(baseUrl, photo, exp, thumbRef, thumbSignature, 'thumb') };
  // preview（灯箱预览图 2000px，约 220 KB）：灯箱默认显示它，取代原先直接拉 13.5 MB 原图。
  // 与缩略图同一套分流逻辑，区别只在 COS 侧目录为平铺的 previews/。
  const previewKey = `preview:${photo.category}/${String(photo.objectKey || '').split('/').at(-1)}`;
  const previewRef = await createPhotoReference(photo, secret, previewKey);
  const previewSignature = await createPhotoSignature(photo.assetId, { version: photo.version, exp, ref: previewRef, variant: 'preview' }, secret);
  result.preview = { url: signedImageUrl(baseUrl, photo, exp, previewRef, previewSignature, 'preview') };
  // Retain the old response shape for already-deployed clients during rollout.
  const legacyEntry = { width: 2400, url };
  result.images = {
    thumbnail: { jpeg: [legacyEntry] },
    lightbox: { jpeg: [legacyEntry] },
  };
  return result;
}

async function handlePhotoManifest(request, env, cors) {
  if (!env.PHOTO_SIGNING_SECRET) return jsonResponse({ error: 'Photo service unavailable' }, 503, cors);
  const catalog = await loadPhotoCatalog(env, demoCatalog);
  const exp = Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS;
  const url = new URL(request.url);
  const baseUrl = env.PHOTO_PUBLIC_ORIGIN || `${url.protocol}//${url.host}`;
  const photos = await Promise.all(catalog.photos.map((photo) => publicPhoto(photo, baseUrl, exp, env.PHOTO_SIGNING_SECRET)));
  return jsonResponse({ demo: catalog.demo, categories: catalog.categories, expiresAt: exp, photos }, 200, cors, 'private, max-age=60');
}

async function handlePhotoImage(request, env, cors, assetId) {
  const url = new URL(request.url);
  const photoRequest = normalizePhotoRequest(url.searchParams);
  if (!photoRequest || !/^[0-9a-f-]{36}$/i.test(assetId)) return jsonResponse({ error: 'Invalid image request' }, 400, cors);
  if (!await verifyPhotoSignature(assetId, photoRequest, url.searchParams.get('sig'), env.PHOTO_SIGNING_SECRET)) return jsonResponse({ error: 'Invalid or expired image request' }, 403, cors);
  const reference = await readPhotoReference(photoRequest.ref, env.PHOTO_SIGNING_SECRET);
  const isThumb = photoRequest.variant === 'thumb';
  const isPreview = photoRequest.variant === 'preview';
  const isAvif = photoRequest.variant === 'avif';
  // thumb / preview 变体的 ref 里放的是逻辑键 "<thumb|preview>:<分类>/<R2 文件名>"，
  // 仅用于签名绑定与推导源对象键。
  const refKey = reference ? String(reference.key) : '';
  const isThumbRef = refKey.startsWith('thumb:');
  const isPreviewRef = refKey.startsWith('preview:');
  if (!reference || reference.version !== photoRequest.version) {
    return jsonResponse({ error: 'Image not found' }, 404, cors);
  }
  if (isThumb || isPreview) {
    const expected = isPreview ? isPreviewRef : isThumbRef;
    if (!expected) return jsonResponse({ error: 'Image not found' }, 404, cors);
  } else if (isThumbRef || isPreviewRef || (isAvif ? !/\.avif$/i.test(reference.key) : !/\.jpe?g$/i.test(reference.key))) {
    return jsonResponse({ error: 'Image not found' }, 404, cors);
  }

  const canonicalUrl = new URL(url);
  canonicalUrl.searchParams.delete('sig');
  canonicalUrl.searchParams.delete('exp');
  canonicalUrl.searchParams.delete('ref');
  canonicalUrl.searchParams.set('__origin', request.headers.get('Origin') || requestOrigin(request.headers.get('Referer')) || '');
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(canonicalUrl, { method: 'GET' });
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return request.method === 'HEAD' ? new Response(null, cached) : cached;

  // 缩略图 / 预览图：按来源选源（国内 -> 上海 COS，国外 -> R2），任一侧失败自动回落
  if (isThumb || isPreview) {
    const marker = isPreview ? 'preview:' : 'thumb:';
    const variant = isPreview ? 'preview' : 'thumb';
    const logicalKey = String(reference.key).slice(marker.length);
    const slash = logicalKey.indexOf('/');
    const photo = slash > 0
      ? { category: logicalKey.slice(0, slash), objectKey: logicalKey.slice(slash + 1), variant }
      : { category: '', objectKey: logicalKey, variant };
    const thumb = await fetchThumb(request, env, photo);
    if (!thumb) return jsonResponse({ error: 'Image not found' }, 404, cors);
    const headers = photoHeaders(cors);
    headers.set('Content-Type', 'image/avif');
    headers.set('Content-Disposition', 'inline');
    if (thumb.size) headers.set('Content-Length', String(thumb.size));
    if (thumb.etag) headers.set('ETag', thumb.etag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('CDN-Cache-Control', 'public, max-age=31536000, immutable');
    const response = new Response(thumb.body, { status: 200, headers });
    if (cache) await cache.put(cacheKey, response.clone());
    return request.method === 'HEAD' ? new Response(null, response) : response;
  }

  // 原图：国内节点优先从上海 COS 读（免跨境），失败或非国内来源则回落到 R2。
  // COS 侧原图是 R2 的等价镜像，命名差异由 originalKeysFor() 兜底。
  // 注意 `avif` 变体（历史/兼容用途）不走 COS：上海的兄弟文件命名不可靠，只认 R2。
  if (!isAvif && isChinaNodeRequest(request)) {
    const fromCos = await fetchCosOriginal(env, reference.key);
    if (fromCos) {
      const cosHeaders = photoHeaders(cors);
      cosHeaders.set('Content-Type', 'image/jpeg');
      cosHeaders.set('Content-Disposition', 'inline');
      cosHeaders.set('Content-Length', String(fromCos.size));
      cosHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
      cosHeaders.set('CDN-Cache-Control', 'public, max-age=31536000, immutable');
      const cosResponse = new Response(fromCos.body, { status: 200, headers: cosHeaders });
      if (cache) await cache.put(cacheKey, cosResponse.clone());
      return request.method === 'HEAD' ? new Response(null, cosResponse) : cosResponse;
    }
  }

  if (!env.photo?.get) return jsonResponse({ error: 'Photo service unavailable' }, 503, cors);
  const object = await env.photo.get(reference.key);
  if (!object) return jsonResponse({ error: 'Image not found' }, 404, cors);
  const headers = photoHeaders(cors);
  headers.set('Content-Type', isAvif ? 'image/avif' : 'image/jpeg');
  headers.set('Content-Disposition', 'inline');
  headers.set('Content-Length', String(object.size));
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('CDN-Cache-Control', 'public, max-age=31536000, immutable');
  const response = new Response(object.body, { status: 200, headers });
  if (cache) await cache.put(cacheKey, response.clone());
  return request.method === 'HEAD' ? new Response(null, response) : response;
}

export async function handlePhotoRequest(request, env, cors) {
  if (!await rateLimit(request, env)) return jsonResponse({ error: 'Too many requests' }, 429, cors);
  const url = new URL(request.url);
  if (url.pathname === '/photo/manifest') return handlePhotoManifest(request, env, cors);
  const match = url.pathname.match(/^\/photo\/image\/([0-9a-f-]{36})$/i);
  if (match) return handlePhotoImage(request, env, cors, match[1]);
  return jsonResponse({ error: 'Not found' }, 404, cors);
}

export default {
  async fetch(request, env) {
    const allowed = trustedOrigins(env);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, allowed);
    if (request.method === 'OPTIONS') return allowed.includes(origin) ? new Response(null, { status: 204, headers: cors }) : new Response('Forbidden', { status: 403 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const url = new URL(request.url);

    if (url.pathname.startsWith('/photo/')) {
      if (!isTrustedRequest(request, allowed)) return jsonResponse({ error: 'Forbidden' }, 403, cors);
      return handlePhotoRequest(request, env, cors);
    }
    if (!url.pathname.startsWith('/media/')) {
      const upstream = await fetch(portfolioUrl(request, env), { method: request.method, headers: { 'User-Agent': 'Kensym Portfolio Worker' } });
      const headers = new Headers(upstream.headers);
      headers.set('Cache-Control', 'public, max-age=300');
      applySecurityHeaders(headers);
      return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers });
    }
    if (!isTrustedRequest(request, allowed)) return new Response('Forbidden', { status: 403 });
    const slug = decodeURIComponent(url.pathname.replace(/^\/media\/?/, ''));
    const key = media.get(slug);
    if (!key) return new Response('Not found', { status: 404, headers: cors });
    const object = await env.MEDIA.get(key, { range: request.headers });
    if (!object) return new Response('Not found', { status: 404, headers: cors });

    const headers = new Headers(cors);
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    headers.set('CDN-Cache-Control', 'public, max-age=2592000');
    headers.set('Content-Disposition', 'inline');
    applySecurityHeaders(headers);
    const range = object.range;
    if (range) {
      headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
      headers.set('Content-Length', String(range.length));
    } else headers.set('Content-Length', String(object.size));
    return new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers });
  },
};
