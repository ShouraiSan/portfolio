import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { createPhotoSignature, imageKeysFor, normalizePhotoRequest, originalKeysFor, thumbCandidates, verifyPhotoSignature } from '../src/index.js';
import { clearPhotoCatalogCache } from '../src/photo-catalog.js';

const secret = 'test-signing-secret';
const opaqueRef = 'abcdefghijklmnopqrstuvwxyz0123456789_-';
const allowed = 'https://portfolio-media.jlmafuture.workers.dev,https://shouraisan.github.io,https://kensym15.top,http://127.0.0.1:5173';
const env = { ALLOWED_ORIGINS: allowed, PHOTO_SIGNING_SECRET: secret, photo: { get: async () => null } };
const trustedHeaders = { Referer: 'http://127.0.0.1:5173/photography.html', Origin: 'http://127.0.0.1:5173' };

test('manifest rejects missing and foreign referers', async () => {
  assert.equal((await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest'), env)).status, 403);
  const foreign = new Request('https://kensym15.dpdns.org/photo/manifest', { headers: { Referer: 'https://example.com/' } });
  assert.equal((await worker.fetch(foreign, env)).status, 403);
});

test('workers.dev origin can load the gallery it serves', async () => {
  const origin = 'https://portfolio-media.jlmafuture.workers.dev';
  const request = new Request(`${origin}/photo/manifest`, { headers: { Referer: `${origin}/photography.html`, Origin: origin } });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
});

test('public manifest hides object keys and exposes pending demo records', async () => {
  const request = new Request('https://kensym15.dpdns.org/photo/manifest', { headers: trustedHeaders });
  const response = await worker.fetch(request, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.demo, true);
  assert.ok(body.photos.every((photo) => photo.pending));
  assert.equal(JSON.stringify(body).includes('objectKey'), false);
  assert.equal(JSON.stringify(body).includes('REPLACE_ME'), false);
});

test('large catalogs expose one signed original JPG URL per photo', async () => {
  clearPhotoCatalogCache();
  const photos = Array.from({ length: 58 }, (_, index) => ({
    key: `风光/photo-${index}.jpg`, size: 100, etag: `etag-${index}`,
    uploaded: new Date('2026-01-01T00:00:00Z'), customMetadata: {},
  }));
  const bucket = { list: async () => ({ objects: photos, truncated: false }), get: async () => null };
  const request = new Request('https://kensym15.dpdns.org/photo/manifest', { headers: trustedHeaders });
  const response = await worker.fetch(request, { ...env, photo: bucket });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.photos.length, 58);
  const image = body.photos[0].images;
  assert.deepEqual(Object.keys(image.thumbnail), ['jpeg']);
  assert.deepEqual(Object.keys(image.lightbox), ['jpeg']);
  assert.equal(image.thumbnail.jpeg[0].url, body.photos[0].original.url);
  assert.equal(image.lightbox.jpeg[0].url, body.photos[0].original.url);
  assert.equal(new URL(body.photos[0].original.url).searchParams.has('fmt'), false);
  assert.equal(JSON.stringify(body).includes('objectKey'), false);
  clearPhotoCatalogCache();
});

test('signed image route returns the R2 JPG bytes without Images transformation', async () => {
  clearPhotoCatalogCache();
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  const object = {
    key: '风光/original.jpg', size: original.byteLength, etag: 'etag-original', httpEtag: '"etag-original"',
    uploaded: new Date('2026-01-01T00:00:00Z'), customMetadata: {}, body: original,
  };
  const bucket = {
    list: async () => ({ objects: [object], truncated: false }),
    get: async (key) => key === object.key ? object : null,
  };
  const directEnv = { ...env, photo: bucket };
  const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers: trustedHeaders }), directEnv);
  const manifest = await manifestResponse.json();
  const imageResponse = await worker.fetch(new Request(manifest.photos[0].original.url, { headers: trustedHeaders }), directEnv);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), original);
  clearPhotoCatalogCache();
});

const originalObject = {
  key: '风光/original.jpg', size: 4, etag: 'etag-original', httpEtag: '"etag-original"',
  uploaded: new Date('2026-01-01T00:00:00Z'), customMetadata: {}, body: new Uint8Array([1, 2, 3, 4]),
};
const cosThumbObject = {
  key: 'thumbs/风光/original.avif', size: 3, httpEtag: '"etag-cos"', body: new Uint8Array([5, 6, 7]),
};
// 预览图在 COS 侧同样按「分类目录」组织：previews/<分类>/<文件名>.avif
// （Worker 仍会兜底尝试平铺形式 previews/<文件名>.avif，兼容早期上传）
const cosPreviewObject = {
  key: 'previews/风光/original.avif', size: 6, httpEtag: '"etag-preview"', body: new Uint8Array([8, 9, 10, 11]),
};
// R2 侧的预览图与缩略图是不同对象，用于区分「到底读的哪一份」
const r2PreviewObject = {
  key: 'previews/风光/original.avif', size: 5, httpEtag: '"etag-r2-preview"', body: new Uint8Array([21, 22, 23, 24, 25]),
};

// R2 侧同时提供原图、thumbs/ 缩略图、previews/ 预览图
function thumbBucket() {
  return {
    list: async () => ({ objects: [originalObject], truncated: false }),
    get: async (key) => key === originalObject.key ? originalObject
      : key === cosThumbObject.key ? cosThumbObject
        : key === cosPreviewObject.key ? r2PreviewObject : null,
  };
}

test('manifest exposes a signed preview url for the lightbox', async () => {
  clearPhotoCatalogCache();
  const directEnv = { ...env, photo: thumbBucket(), COS_THUMB_HOST: 'https://cos.example.com' };
  const headers = { Referer: 'https://kensym15.top/photography/', Origin: 'https://kensym15.top' };
  const res = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
  const photo = (await res.json()).photos[0];
  assert.match(photo.preview.url, /variant=preview/);
  // 原图仍然不带 variant（走 R2）
  assert.equal(new URL(photo.original.url).searchParams.has('variant'), false);
  // 缩略图与预览图是两条不同的签名地址
  assert.notEqual(photo.preview.url, photo.thumbnail.url);
  clearPhotoCatalogCache();
});

test('preview requests resolve to previews/<category>/ on COS', async () => {
  clearPhotoCatalogCache();
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requested.push(typeof input === 'string' ? input : input.url);
    return new Response(cosPreviewObject.body, { status: 200, headers: { 'Content-Type': 'image/avif' } });
  };
  try {
    const directEnv = { ...env, photo: thumbBucket(), COS_THUMB_HOST: 'https://cos.example.com' };
    const headers = { Referer: 'https://kensym15.top/photography/', Origin: 'https://kensym15.top' };
    const res = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await res.json()).photos[0];
    const image = await worker.fetch(new Request(photo.preview.url, { headers }), directEnv);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/avif');
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), cosPreviewObject.body);
    // 首选分类目录形式 previews/<分类>/<文件名>.avif，
    // 且「已知分类」必须排在首位，避免先试其他分类造成无效请求
    assert.equal(requested.length > 0, true);
    assert.match(requested[0], /^https:\/\/cos\.example\.com\/previews\/[^/]+\//);
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});

test('preview requests still require a valid signature', async () => {
  clearPhotoCatalogCache();
  const directEnv = { ...env, photo: thumbBucket(), COS_THUMB_HOST: 'https://cos.example.com' };
  const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers: trustedHeaders }), directEnv);
  const previewUrl = new URL((await manifestResponse.json()).photos[0].preview.url);
  previewUrl.searchParams.set('sig', `${previewUrl.searchParams.get('sig')}x`);
  const denied = await worker.fetch(new Request(previewUrl.toString(), { headers: trustedHeaders }), directEnv);
  assert.equal(denied.status, 403);
  clearPhotoCatalogCache();
});

test('China node (kensym15.top) loads grid thumbnails from Shanghai COS', async () => {
  clearPhotoCatalogCache();
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const href = typeof input === 'string' ? input : input.url;
    requested.push(href);
    return new Response(cosThumbObject.body, { status: 200, headers: { 'Content-Type': 'image/avif' } });
  };
  try {
    const directEnv = { ...env, photo: thumbBucket(), COS_THUMB_HOST: 'https://cos.example.com', COS_THUMB_PREFIX: 'thumbs' };
    const headers = { Referer: 'https://kensym15.top/photography.html', Origin: 'https://kensym15.top' };
    const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await manifestResponse.json()).photos[0];
    assert.match(photo.thumbnail.url, /variant=thumb/);
    assert.equal(new URL(photo.original.url).searchParams.has('variant'), false);

    const imageResponse = await worker.fetch(new Request(photo.thumbnail.url, { headers }), directEnv);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/avif');
    assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), cosThumbObject.body);
    // 国内来源必须走 COS；R2 上有同名缩略图也不应被使用
    assert.equal(requested.length > 0, true);
    assert.match(requested[0], /^https:\/\/cos\.example\.com\/thumbs\//);
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});

test('overseas node (GitHub Pages) loads grid thumbnails from R2', async () => {
  clearPhotoCatalogCache();
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requested.push(typeof input === 'string' ? input : input.url);
    return new Response(null, { status: 500 });
  };
  try {
    const directEnv = { ...env, photo: thumbBucket(), COS_THUMB_HOST: 'https://cos.example.com', COS_THUMB_PREFIX: 'thumbs' };
    const headers = { Referer: 'https://shouraisan.github.io/portfolio/photography.html', Origin: 'https://shouraisan.github.io' };
    const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await manifestResponse.json()).photos[0];

    const imageResponse = await worker.fetch(new Request(photo.thumbnail.url, { headers }), directEnv);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/avif');
    assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), cosThumbObject.body);
    // 国外来源应直接读 R2，完全不访问 COS
    assert.equal(requested.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});

test('thumbnail falls back to R2 when the COS copy is unavailable', async () => {
  clearPhotoCatalogCache();
  const originalFetch = globalThis.fetch;
  // 模拟 COS 不可用
  globalThis.fetch = async () => { throw new Error('cos down'); };
  try {
    const directEnv = { ...env, photo: thumbBucket(), COS_THUMB_HOST: 'https://cos.example.com', COS_THUMB_PREFIX: 'thumbs' };
    const headers = { Referer: 'https://kensym15.top/photography.html', Origin: 'https://kensym15.top' };
    const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await manifestResponse.json()).photos[0];
    // 国内来源：缩略图与预览图都应从上海 COS 回落到 R2 上对应的那一份
    const thumbnail = await worker.fetch(new Request(photo.thumbnail.url, { headers }), directEnv);
    assert.equal(thumbnail.status, 200);
    assert.deepEqual(new Uint8Array(await thumbnail.arrayBuffer()), cosThumbObject.body);
    const preview = await worker.fetch(new Request(photo.preview.url, { headers }), directEnv);
    assert.equal(preview.status, 200);
    assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), r2PreviewObject.body);
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});

test('overseas node never falls back to Shanghai COS when R2 misses', async () => {
  clearPhotoCatalogCache();
  const requested = [];
  const originalFetch = globalThis.fetch;
  // COS 侧"有图"（任何命中都会返回 200），用来证明国外节点根本不去问它
  globalThis.fetch = async (input) => {
    requested.push(typeof input === 'string' ? input : input.url);
    return new Response(cosThumbObject.body, { status: 200, headers: { 'Content-Type': 'image/avif' } });
  };
  try {
    // 空的 R2：原图仍可被 list 出来（否则没有清单），但取图时一律落空
    const emptyBucket = {
      list: async () => ({ objects: [originalObject], truncated: false }),
      get: async (key) => key === originalObject.key ? originalObject : null,
    };
    const directEnv = { ...env, photo: emptyBucket, COS_THUMB_HOST: 'https://cos.example.com', COS_THUMB_PREFIX: 'thumbs' };
    const headers = { Referer: 'https://shouraisan.github.io/portfolio/photography.html', Origin: 'https://shouraisan.github.io' };
    const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await manifestResponse.json()).photos[0];

    const thumbnail = await worker.fetch(new Request(photo.thumbnail.url, { headers }), directEnv);
    assert.equal(thumbnail.status, 404);
    const preview = await worker.fetch(new Request(photo.preview.url, { headers }), directEnv);
    assert.equal(preview.status, 404);
    // R2 是唯一主节点：国外来源即使 R2 取不到，也不得回落到上海 COS
    assert.equal(requested.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});

test('thumbnail requests still require a valid signature', async () => {
  clearPhotoCatalogCache();
  const directEnv = { ...env, photo: thumbBucket(), COS_THUMB_HOST: 'https://cos.example.com', COS_THUMB_PREFIX: 'thumbs' };
  const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers: trustedHeaders }), directEnv);
  const thumbUrl = new URL((await manifestResponse.json()).photos[0].thumbnail.url);
  thumbUrl.searchParams.set('sig', `${thumbUrl.searchParams.get('sig')}x`);
  const denied = await worker.fetch(new Request(thumbUrl.toString(), { headers: trustedHeaders }), directEnv);
  assert.equal(denied.status, 403);
  clearPhotoCatalogCache();
});

test('original image requests accept only signed reference fields', () => {
  const valid = new URLSearchParams(`v=demo-1&exp=2000000000&ref=${opaqueRef}`);
  const invalid = new URLSearchParams(`v=demo-1&exp=invalid&ref=${opaqueRef}`);
  assert.equal(normalizePhotoRequest(valid).version, 'demo-1');
  assert.equal(normalizePhotoRequest(invalid), null);
});

test('signatures reject expiry and tampering', async () => {
  const now = 2_000_000_000;
  const variant = { version: 'demo-1', exp: now + 300, ref: opaqueRef };
  const assetId = 'a7f81d2e-94c6-4b37-b815-3e60e1d9af42';
  const signature = await createPhotoSignature(assetId, variant, secret);
  assert.equal(await verifyPhotoSignature(assetId, variant, signature, secret, now), true);
  assert.equal(await verifyPhotoSignature(assetId, { ...variant, version: 'demo-2' }, signature, secret, now), false);
  assert.equal(await verifyPhotoSignature(assetId, { ...variant, ref: `${opaqueRef}changed` }, signature, secret, now), false);
  assert.equal(await verifyPhotoSignature(assetId, { ...variant, exp: now - 1 }, signature, secret, now), false);
});

test('unknown signed asset does not disclose internal paths', async () => {
  const now = Math.floor(Date.now() / 1000);
  const assetId = '11111111-2222-4333-8444-555555555555';
  const variant = { version: 'demo-1', exp: now + 300, ref: opaqueRef };
  const sig = await createPhotoSignature(assetId, variant, secret);
  const query = new URLSearchParams({ v: variant.version, exp: String(variant.exp), ref: variant.ref, sig });
  const request = new Request(`https://kensym15.dpdns.org/photo/image/${assetId}?${query}`, { headers: trustedHeaders });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 404);
  assert.equal((await response.text()).includes('REPLACE_ME'), false);
});

test('image route rejects expired signatures, tampered versions, and illegal paths', async () => {
  const now = Math.floor(Date.now() / 1000);
  const assetId = 'a7f81d2e-94c6-4b37-b815-3e60e1d9af42';
  const valid = { version: 'demo-1', exp: now + 300, ref: opaqueRef };
  const signature = await createPhotoSignature(assetId, valid, secret);
  const makeUrl = (variant, sig = signature) => {
    const query = new URLSearchParams({ v: variant.version, exp: String(variant.exp), ref: variant.ref, sig });
    return `https://kensym15.dpdns.org/photo/image/${assetId}?${query}`;
  };

  const tampered = new Request(makeUrl({ ...valid, version: 'demo-2' }), { headers: trustedHeaders });
  assert.equal((await worker.fetch(tampered, env)).status, 403);

  const expiredVariant = { ...valid, exp: now - 10 };
  const expiredSignature = await createPhotoSignature(assetId, expiredVariant, secret);
  const expired = new Request(makeUrl(expiredVariant, expiredSignature), { headers: trustedHeaders });
  assert.equal((await worker.fetch(expired, env)).status, 403);

  const missingReference = new Request(`https://kensym15.dpdns.org/photo/image/${assetId}?v=${valid.version}&exp=${valid.exp}&sig=${signature}`, { headers: trustedHeaders });
  assert.equal((await worker.fetch(missingReference, env)).status, 400);

  const illegalPath = new Request('https://kensym15.dpdns.org/photo/image/not-a-valid-asset-id', { headers: trustedHeaders });
  assert.equal((await worker.fetch(illegalPath, env)).status, 404);
});

// ---------------------------------------------------------------------------
// COS 侧「保留半角空格」的命名兜底
//
// 实测桶内布局：58 张原图里 27 张的文件名含半角空格
// （例如 "bocchi (5 - 12)"、"hobby_figure（nomark (1 - 26)"），
// R2 侧的 objectKey 用下划线形态，两侧只有「空格 <-> 下划线」这一处差异。
// 缺了这一变体时缩略图/预览图会全部取不到，前端 onError 回落到整张原图。
// ---------------------------------------------------------------------------

test('thumbCandidates generates the space-preserving variant', () => {
  const candidates = thumbCandidates('人像/_DSC6557.JPG');
  assert.ok(candidates.includes('_DSC6557'), 'should keep the plain base name');

  // 桶内实测：`thumbs/人像/bocchi (5 - 12).avif` 存在，而 `bocchi_(5_-_12).avif` 不存在。
  // 因此从下划线形态的 objectKey 出发必须能推出含空格的形态。
  const spaced = thumbCandidates('人像/bocchi_(5_-_12).jpg');
  assert.ok(
    spaced.includes('bocchi (5 - 12)'),
    `space variant missing, got: ${spaced.join(' | ')}`,
  );

  // 含固有下划线的名字（hobby_figure）配合一个空格，真实对应
  // 桶内的 `thumbs/手办/hobby_figure（nomark (1 - 26).avif`
  const mixed = thumbCandidates('手办/hobby_figure（nomark_(1_-_26).jpg');
  assert.ok(
    mixed.includes('hobby_figure（nomark (1 - 26)'),
    `mixed variant missing, got: ${mixed.join(' | ')}`,
  );
  // 原始 key 形态必须保留（零成本命中路径）
  assert.ok(mixed.includes('hobby_figure（nomark_(1_-_26)'), 'original base name must be preserved');
});

test('imageKeysFor resolves grouped thumb and preview keys for space-containing names', () => {
  const photo = { objectKey: '人像/bocchi_(5_-_12).jpg', category: '人像', variant: 'thumb' };
  const thumbKeys = imageKeysFor(photo);
  assert.ok(thumbKeys.includes('thumbs/人像/bocchi (5 - 12).avif'), 'thumb key with spaces required');
  // 已知分类必须排在最前，避免先试其他分类造成无效请求
  assert.ok(thumbKeys[0].startsWith('thumbs/人像/'), `known category should lead, got ${thumbKeys[0]}`);

  const previewKeys = imageKeysFor({ ...photo, variant: 'preview' });
  assert.ok(previewKeys.includes('previews/人像/bocchi (5 - 12).avif'), 'preview key with spaces required');
  // 平铺历史结构仍作为兜底保留
  assert.ok(previewKeys.includes('previews/bocchi (5 - 12).avif'), 'flat legacy preview key required');
});

test('originalKeysFor keeps the original extension case and offers a space variant', () => {
  // 大小写逐个文件继承原始命名：桶内既有大写 .JPG 也有小写 .jpg
  const upper = originalKeysFor('人像/_DSC6557.JPG');
  assert.equal(upper[0], '人像/_DSC6557.JPG');
  assert.ok(!upper.some((key) => key.endsWith('.jpg')), 'must not lowercase the extension');

  // 精确形态永远排首位：COS key 与 R2 key 相同的那些照片零成本命中
  assert.equal(originalKeysFor('风光/Chenshan_Park-7889.jpg')[0], '风光/Chenshan_Park-7889.jpg');
  assert.equal(originalKeysFor('风光/Hokkaidou-3.jpg')[0], '风光/Hokkaidou-3.jpg');

  // 含空格的对象名（桶内 58 张里的 27 张）必须能推出「空格 -> 下划线」形态
  assert.ok(
    originalKeysFor('人像/bocchi (5 - 12).jpg').includes('人像/bocchi_(5_-_12).jpg'),
    'space -> underscore variant required',
  );
  // 固有下划线 + 空格混合命名，下划线必须保留
  assert.ok(
    originalKeysFor('手办/hobby_figure（nomark (1 - 26).jpg').includes('手办/hobby_figure（nomark_(1_-_26).jpg'),
    'inherent underscore must survive the transformation',
  );

  const empty = originalKeysFor('');
  assert.deepEqual(empty, [], 'empty key yields no candidates');
});

test('China node loads the original JPG from Shanghai COS', async () => {
  clearPhotoCatalogCache();
  const requested = [];
  const originalFetch = globalThis.fetch;
  const cosBytes = new Uint8Array([0x43, 0x4f, 0x53]);   // "COS"
  const r2Bytes = new Uint8Array([0x52, 0x32]);          // "R2"
  globalThis.fetch = async (input) => {
    requested.push(typeof input === 'string' ? input : input.url);
    return new Response(cosBytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  };
  try {
    const r2Object = {
      key: '风光/Chenshan_Park-7889.jpg', size: r2Bytes.byteLength, etag: 'etag-r2', httpEtag: '"etag-r2"',
      uploaded: new Date('2026-01-01T00:00:00Z'), customMetadata: {}, body: r2Bytes,
    };
    const bucket = {
      list: async () => ({ objects: [r2Object], truncated: false }),
      get: async (key) => key === r2Object.key ? r2Object : null,
    };
    const directEnv = { ...env, photo: bucket, COS_THUMB_HOST: 'https://cos.example.com' };
    const headers = { Referer: 'https://kensym15.top/photography/', Origin: 'https://kensym15.top' };
    const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await manifestResponse.json()).photos[0];

    const image = await worker.fetch(new Request(photo.original.url, { headers }), directEnv);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    // 必须来自 COS 的字节，而不是 R2 的那份
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), cosBytes);
    assert.equal(requested.length > 0, true);
    // encodePath() 逐段百分号编码，因此中文分类目录在 URL 里是编码后的形态
    assert.match(requested[0], /^https:\/\/cos\.example\.com\/%E9%A3%8E%E5%85%89\//);
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});

test('overseas original never contacts Shanghai COS', async () => {
  clearPhotoCatalogCache();
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requested.push(typeof input === 'string' ? input : input.url);
    return new Response(new Uint8Array([0x43]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  };
  try {
    const r2Bytes = new Uint8Array([0x52, 0x32]);
    const r2Object = {
      key: '风光/Chenshan_Park-7889.jpg', size: r2Bytes.byteLength, etag: 'etag-r2', httpEtag: '"etag-r2"',
      uploaded: new Date('2026-01-01T00:00:00Z'), customMetadata: {}, body: r2Bytes,
    };
    const bucket = {
      list: async () => ({ objects: [r2Object], truncated: false }),
      get: async (key) => key === r2Object.key ? r2Object : null,
    };
    const directEnv = { ...env, photo: bucket, COS_THUMB_HOST: 'https://cos.example.com' };
    const headers = { Referer: 'https://shouraisan.github.io/portfolio/photography.html', Origin: 'https://shouraisan.github.io' };
    const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await manifestResponse.json()).photos[0];

    const image = await worker.fetch(new Request(photo.original.url, { headers }), directEnv);
    assert.equal(image.status, 200);
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), r2Bytes);
    // R2 是唯一主节点：国外来源的原图不得触碰 COS
    assert.equal(requested.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});

test('China node falls back to R2 original when the COS mirror is unavailable', async () => {
  clearPhotoCatalogCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('cos down'); };
  try {
    const r2Bytes = new Uint8Array([0x52, 0x32, 0x46]);
    const r2Object = {
      key: '风光/Chenshan_Park-7889.jpg', size: r2Bytes.byteLength, etag: 'etag-r2', httpEtag: '"etag-r2"',
      uploaded: new Date('2026-01-01T00:00:00Z'), customMetadata: {}, body: r2Bytes,
    };
    const bucket = {
      list: async () => ({ objects: [r2Object], truncated: false }),
      get: async (key) => key === r2Object.key ? r2Object : null,
    };
    const directEnv = { ...env, photo: bucket, COS_THUMB_HOST: 'https://cos.example.com' };
    const headers = { Referer: 'https://kensym15.top/photography/', Origin: 'https://kensym15.top' };
    const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await manifestResponse.json()).photos[0];
    const image = await worker.fetch(new Request(photo.original.url, { headers }), directEnv);
    assert.equal(image.status, 200);
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), r2Bytes);
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});
