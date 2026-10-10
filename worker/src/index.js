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
// R2 与 COS 的文件名只有分隔符与前导下划线这两处差异，因此按变体逐个尝试。
const COS_CATEGORIES = ['人像', '手办', '街头', '风光'];

function thumbCandidates(objectKey) {
  const filename = String(objectKey || '').split('/').at(-1).replace(/\.[^.]+$/, '');
  let decoded = filename;
  try { decoded = decodeURIComponent(filename); } catch { /* 保留原样 */ }
  // 四组基名：原名、连字符→下划线、下划线→连字符、空格→下划线。
  // 最后一组是必需的：COS 侧的资源存在「空格转下划线但保留原有连字符」的混合命名，
  // 例如 R2 的 "Chenshan Park-7889" 对应 COS 的 "Chenshan_Park-7889"，
  // 只做前三种替换会漏掉这一形态，导致图片 404。
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
// 两者的目录结构不同，请注意：
//   thumbs/   缩略图 800px  -> thumbs/<分类>/<文件名>.avif
//   previews/ 预览图 2000px -> previews/<文件名>.avif   （平铺，无分类层，桶里就是这么放的）
// R2 与 COS 的文件名只有分隔符与前导下划线这几处差异，因此按变体逐个尝试。
function imageKeysFor(photo) {
  const variant = photo.variant === 'preview' ? 'preview' : 'thumb';
  const defaultPrefix = variant === 'preview' ? 'previews' : 'thumbs';
  const prefix = String(photo.prefix || defaultPrefix).replace(/^\/+|\/+$/g, '');
  const flat = variant === 'preview';
  const category = String(photo.category || '');
  const categories = flat
    ? ['']
    : (COS_CATEGORIES.includes(category) ? [category] : COS_CATEGORIES);
  const keys = [];
  for (const cat of categories) {
    for (const name of thumbCandidates(photo.objectKey)) {
      keys.push(cat ? `${prefix}/${cat}/${name}.avif` : `${prefix}/${name}.avif`);
    }
  }
  return keys;
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
      const response = await fetch(`${host}/${encodePath(key)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(20_000),
      });
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

// 按来源选源（国内 -> 上海 COS，国外 -> R2），任一侧失败自动回落到另一侧。
// photo.variant 决定取缩略图（thumbs/）还是预览图（previews/）。
export async function fetchThumb(request, env, photo) {
  const prefersCos = isChinaNodeRequest(request);
  const primary = prefersCos ? fetchCosImage : fetchR2Image;
  const fallback = prefersCos ? fetchR2Image : fetchCosImage;
  return (await primary(env, photo)) || (await fallback(env, photo));
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
