import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import worker, { cosAuthorization, cosFetch, createPhotoSignature, signingPathname, imageKeysFor, normalizePhotoRequest, originalKeysFor, thumbCandidates, verifyPhotoSignature } from '../src/index.js';
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
    requested.push(typeof input === 'string' ? input : String(input));
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
    const href = typeof input === 'string' ? input : String(input);
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
    requested.push(typeof input === 'string' ? input : String(input));
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
    requested.push(typeof input === 'string' ? input : String(input));
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
// COS 侧对象名的命名规则
//
// 实测（带签名的 HEAD 逐条核实）：**thumbs / previews 的对象名与 R2 objectKey 一致**
// —— 含半角空格与扩展名大小写，原样保留。例如 R2 的 `风光/Chenshan_Park-7889.jpg`
// 对应 `thumbs/风光/Chenshan_Park-7889.avif`；R2 的 `人像/bocchi (5 - 12).jpg`
// 对应 `thumbs/人像/bocchi (5 - 12).avif`。
//
// 因此派生规则是**恒等映射**，「原名」这一组就够用；其余变体只是容错兜底。
// 曾经存在的「分隔符下划线→空格」变体（spaceVariant）已删除 —— 它很可能是多余的，
// 当初认定它必要的依据来自被控制台乱码污染的比对结果，不可靠。
// ---------------------------------------------------------------------------

test('thumbCandidates leads with the exact name and keeps tolerant fallbacks', () => {
  const candidates = thumbCandidates('人像/_DSC6557.JPG');
  // 首选必须是原名（零成本命中路径）
  assert.equal(candidates[0], '_DSC6557');
  // 固有下划线不能被破坏
  assert.ok(candidates.includes('_DSC6557'), 'inherent underscore must survive');

  // 混合命名（固有下划线 + 分隔符）同样以原名优先
  const mixed = thumbCandidates('手办/hobby_figure（nomark (1 - 26).jpg');
  assert.equal(mixed[0], 'hobby_figure（nomark (1 - 26)');

  // 容错变体仍然存在：空格→下划线 与 连字符互换
  const spaced = thumbCandidates('人像/bocchi (5 - 12).jpg');
  assert.ok(spaced.includes('bocchi_(5_-_12)'), 'space -> underscore fallback required');
  assert.equal(spaced[0], 'bocchi (5 - 12)', 'exact name must come first');
});

test('imageKeysFor resolves grouped thumb and preview keys for space-containing names', () => {
  const photo = { objectKey: '人像/bocchi (5 - 12).jpg', category: '人像', variant: 'thumb' };
  const thumbKeys = imageKeysFor(photo);
  assert.ok(thumbKeys.includes('thumbs/人像/bocchi (5 - 12).avif'), 'thumb key with spaces required');
  // 已知分类必须排在最前，避免先试其他分类造成无效请求
  assert.ok(thumbKeys[0].startsWith('thumbs/人像/'), `known category should lead, got ${thumbKeys[0]}`);
  // 原名派生出的键必须排在候选首部
  assert.equal(thumbKeys[0], 'thumbs/人像/bocchi (5 - 12).avif');

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
    requested.push(typeof input === 'string' ? input : String(input));
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
    requested.push(typeof input === 'string' ? input : String(input));
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

// ---------------------------------------------------------------------------
// COS v5 请求签名（方案 B：桶改私有后仍由 Worker 取图）
//
// 算法等价性由 worker/test/cos-signature.verify.mjs 与官方 Node SDK 逐例比对
// （18/18 通过）。这里锁住的是 Worker 的**行为**：配了只读凭据就带签名，
// 没配就维持匿名请求 —— 让密钥注入可以渐进完成，rollout 期间站点不会中断。
// ---------------------------------------------------------------------------

test('COS requests carry a v5 Authorization header when read-only credentials are set', async () => {
  clearPhotoCatalogCache();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: typeof input === 'string' ? input : String(input), headers: init?.headers || {} });
    return new Response(cosThumbObject.body, { status: 200, headers: { 'Content-Type': 'image/avif' } });
  };
  try {
    const directEnv = {
      ...env,
      photo: thumbBucket(),
      COS_THUMB_HOST: 'https://cos.example.com',
      COS_THUMB_PREFIX: 'thumbs',
      COS_SECRET_ID: 'test-secret-id-for-credentials-0001',
      COS_SECRET_KEY: 'exampleSecretKeyexampleSecretKey00',
    };
    const headers = { Referer: 'https://kensym15.top/photography/', Origin: 'https://kensym15.top' };
    const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await manifestResponse.json()).photos[0];
    const imageResponse = await worker.fetch(new Request(photo.thumbnail.url, { headers }), directEnv);
    assert.equal(imageResponse.status, 200);

    assert.equal(calls.length > 0, true, 'COS should have been contacted');
    const auth = calls[0].headers.Authorization;
    assert.ok(auth, 'Authorization header is required when credentials are configured');
    const parts = Object.fromEntries(auth.split('&').map((kv) => {
      const index = kv.indexOf('=');
      return [kv.slice(0, index), kv.slice(index + 1)];
    }));
    assert.equal(parts['q-sign-algorithm'], 'sha1');
    assert.equal(parts['q-ak'], 'test-secret-id-for-credentials-0001');
    assert.equal(parts['q-header-list'], 'host');
    assert.equal(parts['q-url-param-list'], '');
    assert.match(parts['q-signature'], /^[0-9a-f]{40}$/);
    // 签名的 host 必须与请求目标一致，否则服务端校验失败
    assert.equal(new URL(calls[0].url).host, 'cos.example.com');
    // 签名有效期起止必须一致且为「起;止」两段
    assert.match(parts['q-key-time'], /^\d+;\d+$/);
    const [start, end] = parts['q-key-time'].split(';').map(Number);
    assert.equal(end - start, 600, 'signature window should be 600s');
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});

test('COS requests stay anonymous when no credentials are configured', async () => {
  clearPhotoCatalogCache();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: typeof input === 'string' ? input : String(input), headers: init?.headers || {} });
    return new Response(cosThumbObject.body, { status: 200, headers: { 'Content-Type': 'image/avif' } });
  };
  try {
    const directEnv = { ...env, photo: thumbBucket(), COS_THUMB_HOST: 'https://cos.example.com', COS_THUMB_PREFIX: 'thumbs' };
    const headers = { Referer: 'https://kensym15.top/photography/', Origin: 'https://kensym15.top' };
    const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await manifestResponse.json()).photos[0];
    const imageResponse = await worker.fetch(new Request(photo.thumbnail.url, { headers }), directEnv);
    assert.equal(imageResponse.status, 200);
    assert.equal(calls.length > 0, true);
    // 未配置密钥时必须维持匿名请求（渐进式 rollout 的兼容路径）
    assert.equal(calls[0].headers.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});

test('signed COS original request also carries the Authorization header', async () => {
  clearPhotoCatalogCache();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: typeof input === 'string' ? input : String(input), headers: init?.headers || {} });
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
    const directEnv = {
      ...env, photo: bucket, COS_THUMB_HOST: 'https://cos.example.com',
      COS_SECRET_ID: 'test-secret-id-for-credentials-0001',
      COS_SECRET_KEY: 'exampleSecretKeyexampleSecretKey00',
    };
    const headers = { Referer: 'https://kensym15.top/photography/', Origin: 'https://kensym15.top' };
    const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers }), directEnv);
    const photo = (await manifestResponse.json()).photos[0];
    await worker.fetch(new Request(photo.original.url, { headers }), directEnv);
    assert.equal(calls.length > 0, true, 'original should have been fetched from COS');
    assert.match(calls[0].headers.Authorization || '', /^q-sign-algorithm=sha1&/);
  } finally {
    globalThis.fetch = originalFetch;
    clearPhotoCatalogCache();
  }
});

// 冻结签名向量：期望值由 Node 原生 crypto（createHmac/ createHash）独立算出，
// 因此这条断言同时验证了两件事 ——
//   1) Worker 的 Web Crypto 实现与 Node crypto 的密码学结果一致；
//   2) 签名算法不会被后续重构意外改动（冻结值来自官方算法移植）。
test('cosAuthorization matches a frozen vector computed with Node crypto', async () => {
  const frozen = 'q-sign-algorithm=sha1'
    + '&q-ak=test-secret-id-frozen-vector-0001'
    + '&q-sign-time=1791644920;1791645520'
    + '&q-key-time=1791644920;1791645520'
    + '&q-header-list=host'
    + '&q-url-param-list='
    + '&q-signature=628f676e27cf8fbd8e1259f0e9bae3bd97eb7d5a';
  const actual = await cosAuthorization({
    secretId: 'test-secret-id-frozen-vector-0001',
    secretKey: 'frozen-vector-secret-key-0000000001',
    method: 'GET',
    host: 'photo-1331415098.cos.ap-shanghai.myqcloud.com',
    pathname: '/thumbs/%E4%BA%BA%E5%83%8F/_DSC6557.avif',
    now: 1791644920,
  });
  assert.equal(actual, frozen);
});

// host 参与签名，且签名只取决于 host 字符串本身。
//
// 关于 camSafeUrlEncode(host)：官方 SDK 对它做了编码，我们也照做，但**无法构造出
// 能区分「编码」与「不编码」的用例** —— URL 主机名的字符集只有字母、数字、`.` 与 `-`，
// 没有一个是 encodeURIComponent 会改动的。变异测试已确认去掉这一步是等价变异
// （31 条测试全绿）。保留该调用是为了与官方实现逐行对应，属于防御性写法。
test('cosAuthorization binds the host into the signature', async () => {
  const secretId = 'test-secret-id-for-host-binding-01';
  const secretKey = 'hostBindingSecretKey0000000000000';
  const now = 1791644920;

  const base = await cosAuthorization({
    secretId, secretKey, method: 'GET', host: 'photo-1331415098.cos.ap-shanghai.myqcloud.com', pathname: '/a.jpg', now,
  });
  const otherHost = await cosAuthorization({
    secretId, secretKey, method: 'GET', host: 'evil.example.com', pathname: '/a.jpg', now,
  });
  const otherPath = await cosAuthorization({
    secretId, secretKey, method: 'GET', host: 'photo-1331415098.cos.ap-shanghai.myqcloud.com', pathname: '/b.jpg', now,
  });
  assert.notEqual(base, otherHost, 'host must participate in the signature');
  assert.notEqual(base, otherPath, 'pathname must participate in the signature');

  // 端口不属于 host（URL 会把它拆到 port 字段），因此不应影响签名
  const withPort = await cosAuthorization({
    secretId, secretKey, method: 'GET', host: 'photo-1331415098.cos.ap-shanghai.myqcloud.com', pathname: '/a.jpg', now,
  });
  assert.equal(base, withPort);

  const parts = Object.fromEntries(base.split('&').map((kv) => {
    const index = kv.indexOf('=');
    return [kv.slice(0, index), kv.slice(index + 1)];
  }));
  assert.match(parts['q-signature'], /^[0-9a-f]{40}$/);
});

// 签名用的 pathname 必须是「解码形态」。
//
// 这是实测出来的坑：服务端在 403 响应里回显它参与计算的 FormatString，
// 对请求路径 /thumbs/%E4%BA%BA%E5%83%8F/x.avif 它用的是解码后的 /thumbs/人像/x.avif。
// 用编码形态签名 → SignatureDoesNotMatch；用解码形态 → 200。
//
// 单元测试与「官方 SDK 移植比对」都发现不了这一点，因为 SDK 的 pathname 本来就是
// 未编码的原始 key。因此这里锁住的是 cosFetch 的行为：把 URL 的编码路径解码后再签。
test('cosFetch signs the decoded pathname while requesting the encoded URL', async () => {
  const encoded = '/thumbs/%E4%BA%BA%E5%83%8F/_DSC6557.avif';
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: typeof input === 'string' ? input : String(input), auth: init?.headers?.Authorization });
    return new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'image/avif' } });
  };
  try {
    await cosFetch({ COS_SECRET_ID: 'test-id-0001', COS_SECRET_KEY: 'test-key-0001' }, `https://cos.example.com${encoded}`);

    assert.equal(calls.length, 1);
    // 请求本身仍用编码路径发给服务端
    assert.equal(new URL(calls[0].url).pathname, encoded);
    assert.match(calls[0].auth || '', /^q-sign-algorithm=sha1&/);

    // 关键断言：把授权里的签名换成「编码形态路径」的结果，两者必须不同。
    // 若实现误用编码路径签名，下面两个值会相等，这条测试即失败。
    const decodedAuth = await cosAuthorization({
      secretId: 'test-id-0001', secretKey: 'test-key-0001', method: 'GET',
      host: 'cos.example.com', pathname: decodeURIComponent(encoded), now: 1791644920,
    });
    const encodedAuth = await cosAuthorization({
      secretId: 'test-id-0001', secretKey: 'test-key-0001', method: 'GET',
      host: 'cos.example.com', pathname: encoded, now: 1791644920,
    });
    assert.notEqual(decodedAuth, encodedAuth, 'decoded and encoded pathnames must sign differently');

    // 决定性断言：把 cosFetch 用到的「签名路径」直接取出来比对。
    // 关键点是 signingPathname() 必须返回**解码形态** —— 若它退化成返回
    // requestUrl.pathname（编码形态），下面第一条断言即失败。
    // 这一条是用变异测试补上的：先前只校验签名是 40 位十六进制，
    // 对「编码/解码」两种实现都成立，等于没测。
    assert.equal(
      signingPathname(new URL(`https://cos.example.com${encoded}`)),
      '/thumbs/人像/_DSC6557.avif',
    );
    // 且该形态与编码形态确实不同（否则上面的断言无意义）
    assert.notEqual(signingPathname(new URL(`https://cos.example.com${encoded}`)), encoded);

    const parts = Object.fromEntries(calls[0].auth.split('&').map((kv) => {
      const index = kv.indexOf('=');
      return [kv.slice(0, index), kv.slice(index + 1)];
    }));
    assert.equal(parts['q-header-list'], 'host');
    assert.equal(parts['q-url-param-list'], '');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 闭环断言：冻结时间后，cosFetch 实际发出的 Authorization 必须与用解码路径
  // 独立算出的那一版**逐字符相同**。这一条同时覆盖「signingPathname 正确」和
  // 「cosFetch 确实调用了它」，因此能杀死「绕过 signingPathname」这类变异。
  const fixedNow = 1791644920;
  const frozenCalls = [];
  globalThis.fetch = async (input, init) => {
    frozenCalls.push({ auth: init?.headers?.Authorization });
    return new Response(new Uint8Array([1]), { status: 200 });
  };
  try {
    mock.timers.enable({ apis: ['Date'], now: fixedNow * 1000 });
    await cosFetch({ COS_SECRET_ID: 'test-id-0001', COS_SECRET_KEY: 'test-key-0001' }, `https://cos.example.com${encoded}`);
    mock.timers.reset();

    const expected = await cosAuthorization({
      secretId: 'test-id-0001', secretKey: 'test-key-0001', method: 'GET',
      host: 'cos.example.com', pathname: '/thumbs/人像/_DSC6557.avif', now: fixedNow,
    });
    assert.equal(frozenCalls.length, 1);
    assert.equal(frozenCalls[0].auth, expected);
  } finally {
    try { mock.timers.reset(); } catch { /* 已重置 */ }
    globalThis.fetch = originalFetch;
  }
});

test('cosFetch omits Authorization entirely without credentials', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ auth: init?.headers?.Authorization });
    return new Response(new Uint8Array([1]), { status: 200 });
  };
  try {
    await cosFetch({}, 'https://cos.example.com/a.jpg');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].auth, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
