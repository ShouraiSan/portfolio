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

const VARIANTS = Object.freeze({
  thumbnail: { widths: [480, 768, 1200], qualities: [68, 76], fits: ['cover'] },
  lightbox: { widths: [1200, 1600, 2400], qualities: [76, 82], fits: ['contain'] },
});
const FORMATS = ['avif', 'webp', 'jpeg'];
const IMAGE_OUTPUT_FORMATS = Object.freeze({
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
});
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
  return [assetId, variant.mode, variant.width, variant.quality, variant.format, variant.fit, variant.version, variant.exp, variant.ref || ''].join('|');
}

async function referenceKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`photo-reference|${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function createPhotoReference(photo, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify({ key: photo.objectKey, version: photo.version }));
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

export function normalizeVariant(searchParams) {
  const variant = {
    mode: searchParams.get('mode') || '', width: Number(searchParams.get('w')),
    quality: Number(searchParams.get('q')), format: searchParams.get('fmt') || '',
    fit: searchParams.get('fit') || '', version: searchParams.get('v') || '',
    exp: Number(searchParams.get('exp')), ref: searchParams.get('ref') || '',
  };
  const preset = VARIANTS[variant.mode];
  if (!preset || !preset.widths.includes(variant.width) || !preset.qualities.includes(variant.quality)
    || !FORMATS.includes(variant.format) || !preset.fits.includes(variant.fit)
    || !/^[A-Za-z0-9._-]{1,40}$/.test(variant.version) || !Number.isSafeInteger(variant.exp)
    || !/^[A-Za-z0-9_-]{20,1024}$/.test(variant.ref)) return null;
  return variant;
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

async function signedImageUrl(baseUrl, photo, mode, width, format, quality, fit, exp, ref, secret) {
  const variant = { mode, width, format, quality, fit, version: photo.version, exp, ref };
  const url = new URL(`${baseUrl}/photo/image/${photo.assetId}`);
  url.search = new URLSearchParams({ mode, w: String(width), q: String(quality), fmt: format, fit, v: photo.version, exp: String(exp), ref, sig: await createPhotoSignature(photo.assetId, variant, secret) });
  return { width, url: url.toString() };
}

async function publicPhoto(photo, baseUrl, exp, secret) {
  const result = {
    assetId: photo.assetId, title: photo.title, category: photo.category, year: photo.year,
    camera: photo.camera, lens: photo.lens, description: photo.description,
    width: photo.width, height: photo.height, focalPoint: photo.focalPoint, pending: photo.pending,
  };
  if (photo.pending) return result;
  const ref = await createPhotoReference(photo, secret);
  result.images = {};
  for (const [mode, preset] of Object.entries(VARIANTS)) {
    result.images[mode] = {};
    const quality = preset.qualities.at(-1);
    for (const format of FORMATS) result.images[mode][format] = await Promise.all(preset.widths.map((width) => signedImageUrl(baseUrl, photo, mode, width, format, quality, preset.fits[0], exp, ref, secret)));
  }
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

export async function transformPhoto(object, env, variant) {
  if (!env.IMAGES?.input) throw new Error('Images binding is not configured');
  return env.IMAGES.input(object.body)
    .transform({ width: variant.width, fit: variant.fit, withoutEnlargement: true })
    .output({ format: IMAGE_OUTPUT_FORMATS[variant.format], quality: variant.quality });
}

async function handlePhotoImage(request, env, cors, assetId) {
  const url = new URL(request.url);
  const variant = normalizeVariant(url.searchParams);
  if (!variant || !/^[0-9a-f-]{36}$/i.test(assetId)) return jsonResponse({ error: 'Invalid image request' }, 400, cors);
  if (!await verifyPhotoSignature(assetId, variant, url.searchParams.get('sig'), env.PHOTO_SIGNING_SECRET)) return jsonResponse({ error: 'Invalid or expired image request' }, 403, cors);
  const reference = await readPhotoReference(variant.ref, env.PHOTO_SIGNING_SECRET);
  if (!reference || reference.version !== variant.version) return jsonResponse({ error: 'Image not found' }, 404, cors);
  if (!env.photo?.get) return jsonResponse({ error: 'Photo service unavailable' }, 503, cors);

  const canonicalUrl = new URL(url);
  canonicalUrl.searchParams.delete('sig');
  canonicalUrl.searchParams.delete('exp');
  canonicalUrl.searchParams.set('__origin', request.headers.get('Origin') || requestOrigin(request.headers.get('Referer')) || '');
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(canonicalUrl, { method: 'GET' });
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return request.method === 'HEAD' ? new Response(null, cached) : cached;

  const object = await env.photo.get(reference.key);
  if (!object) return jsonResponse({ error: 'Image not found' }, 404, cors);
  let output;
  try { output = await transformPhoto(object, env, variant); }
  catch { return jsonResponse({ error: 'Image transformation unavailable' }, 503, cors); }

  const imageResponse = typeof output.response === 'function' ? await output.response() : output;
  const headers = photoHeaders(cors);
  headers.set('Content-Type', `image/${variant.format}`);
  headers.set('Content-Disposition', 'inline');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('CDN-Cache-Control', 'public, max-age=31536000, immutable');
  const response = new Response(imageResponse.body, { status: 200, headers });
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
