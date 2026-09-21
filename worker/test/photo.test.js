import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { createPhotoSignature, normalizePhotoRequest, verifyPhotoSignature } from '../src/index.js';
import { clearPhotoCatalogCache } from '../src/photo-catalog.js';

const secret = 'test-signing-secret';
const opaqueRef = 'abcdefghijklmnopqrstuvwxyz0123456789_-';
const allowed = 'https://portfolio-media.jlmafuture.workers.dev,https://shouraisan.github.io,http://127.0.0.1:5173';
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

test('manifest exposes a signed AVIF thumbnail while retaining the signed JPG original', async () => {
  clearPhotoCatalogCache();
  const original = {
    key: '风光/original.jpg', size: 4, etag: 'etag-original', httpEtag: '"etag-original"',
    uploaded: new Date('2026-01-01T00:00:00Z'), customMetadata: {}, body: new Uint8Array([1, 2, 3, 4]),
  };
  const avif = { key: '风光/original.avif', size: 3, httpEtag: '"etag-avif"', body: new Uint8Array([5, 6, 7]) };
  const bucket = {
    list: async () => ({ objects: [original], truncated: false }),
    get: async (key) => key === original.key ? original : key === avif.key ? avif : null,
  };
  const directEnv = { ...env, photo: bucket };
  const manifestResponse = await worker.fetch(new Request('https://kensym15.dpdns.org/photo/manifest', { headers: trustedHeaders }), directEnv);
  const manifest = await manifestResponse.json();
  const photo = manifest.photos[0];
  assert.match(photo.thumbnail.url, /variant=avif/);
  assert.equal(new URL(photo.original.url).searchParams.has('variant'), false);
  const imageResponse = await worker.fetch(new Request(photo.thumbnail.url, { headers: trustedHeaders }), directEnv);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/avif');
  assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), avif.body);
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
