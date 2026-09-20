import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { createPhotoSignature, normalizeVariant, transformPhoto, verifyPhotoSignature } from '../src/index.js';
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

test('large catalogs reuse one signature per photo across allowed variants', async () => {
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
  assert.equal(new URL(image.thumbnail.avif[0].url).searchParams.get('sig'), new URL(image.lightbox.jpeg[2].url).searchParams.get('sig'));
  assert.equal(JSON.stringify(body).includes('objectKey'), false);
  clearPhotoCatalogCache();
});

test('variant whitelist accepts presets and rejects arbitrary dimensions', () => {
  const valid = new URLSearchParams(`mode=thumbnail&w=768&q=76&fmt=webp&fit=cover&v=demo-1&exp=2000000000&ref=${opaqueRef}`);
  const invalid = new URLSearchParams(`mode=thumbnail&w=769&q=76&fmt=webp&fit=cover&v=demo-1&exp=2000000000&ref=${opaqueRef}`);
  assert.equal(normalizeVariant(valid).width, 768);
  assert.equal(normalizeVariant(invalid), null);
});

test('Cloudflare Images receives MIME output formats', async () => {
  let outputOptions;
  const pipeline = {
    transform: () => pipeline,
    output: (options) => { outputOptions = options; return pipeline; },
  };
  const envWithImages = { IMAGES: { input: () => pipeline } };

  await transformPhoto({ body: new ReadableStream() }, envWithImages, {
    width: 768,
    fit: 'cover',
    format: 'webp',
    quality: 76,
  });

  assert.deepEqual(outputOptions, { format: 'image/webp', quality: 76 });
});

test('signatures reject expiry and tampering', async () => {
  const now = 2_000_000_000;
  const variant = { mode: 'thumbnail', width: 768, quality: 76, format: 'webp', fit: 'cover', version: 'demo-1', exp: now + 300, ref: opaqueRef };
  const assetId = 'a7f81d2e-94c6-4b37-b815-3e60e1d9af42';
  const signature = await createPhotoSignature(assetId, variant, secret);
  assert.equal(await verifyPhotoSignature(assetId, variant, signature, secret, now), true);
  assert.equal(await verifyPhotoSignature(assetId, { ...variant, width: 1200 }, signature, secret, now), true);
  assert.equal(await verifyPhotoSignature(assetId, { ...variant, version: 'demo-2' }, signature, secret, now), false);
  assert.equal(await verifyPhotoSignature(assetId, { ...variant, ref: `${opaqueRef}changed` }, signature, secret, now), false);
  assert.equal(await verifyPhotoSignature(assetId, { ...variant, exp: now - 1 }, signature, secret, now), false);
});

test('unknown signed asset does not disclose internal paths', async () => {
  const now = Math.floor(Date.now() / 1000);
  const assetId = '11111111-2222-4333-8444-555555555555';
  const variant = { mode: 'thumbnail', width: 768, quality: 76, format: 'webp', fit: 'cover', version: 'demo-1', exp: now + 300, ref: opaqueRef };
  const sig = await createPhotoSignature(assetId, variant, secret);
  const query = new URLSearchParams({ mode: variant.mode, w: String(variant.width), q: String(variant.quality), fmt: variant.format, fit: variant.fit, v: variant.version, exp: String(variant.exp), ref: variant.ref, sig });
  const request = new Request(`https://kensym15.dpdns.org/photo/image/${assetId}?${query}`, { headers: trustedHeaders });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 404);
  assert.equal((await response.text()).includes('REPLACE_ME'), false);
});

test('image route rejects expired signatures, tampered variants, and illegal paths', async () => {
  const now = Math.floor(Date.now() / 1000);
  const assetId = 'a7f81d2e-94c6-4b37-b815-3e60e1d9af42';
  const valid = { mode: 'thumbnail', width: 768, quality: 76, format: 'webp', fit: 'cover', version: 'demo-1', exp: now + 300, ref: opaqueRef };
  const signature = await createPhotoSignature(assetId, valid, secret);
  const makeUrl = (variant, sig = signature) => {
    const query = new URLSearchParams({ mode: variant.mode, w: String(variant.width), q: String(variant.quality), fmt: variant.format, fit: variant.fit, v: variant.version, exp: String(variant.exp), ref: variant.ref, sig });
    return `https://kensym15.dpdns.org/photo/image/${assetId}?${query}`;
  };

  const tampered = new Request(makeUrl({ ...valid, version: 'demo-2' }), { headers: trustedHeaders });
  assert.equal((await worker.fetch(tampered, env)).status, 403);

  const expiredVariant = { ...valid, exp: now - 10 };
  const expiredSignature = await createPhotoSignature(assetId, expiredVariant, secret);
  const expired = new Request(makeUrl(expiredVariant, expiredSignature), { headers: trustedHeaders });
  assert.equal((await worker.fetch(expired, env)).status, 403);

  const arbitrarySize = new Request(makeUrl({ ...valid, width: 769 }), { headers: trustedHeaders });
  assert.equal((await worker.fetch(arbitrarySize, env)).status, 400);

  const illegalPath = new Request('https://kensym15.dpdns.org/photo/image/not-a-valid-asset-id', { headers: trustedHeaders });
  assert.equal((await worker.fetch(illegalPath, env)).status, 404);
});
