import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { avifKeyFor, convertPrefix, isJpegKey } from '../worker.js';

test('builds AVIF keys beside JPG and detects JPEG extensions case-insensitively', () => {
  assert.equal(avifKeyFor('photos/xxx.jpg'), 'photos/xxx.avif');
  assert.equal(avifKeyFor('photos/xxx.JPEG'), 'photos/xxx.avif');
  assert.equal(isJpegKey('photos/xxx.JPG'), true);
  assert.equal(isJpegKey('photos/xxx.png'), false);
});

test('paginates, skips existing AVIF, converts JPGs, and continues after errors', async () => {
  const puts = [];
  const listed = [
    { key: 'photos/first.jpg' },
    { key: 'photos/existing.jpeg' },
    { key: 'photos/ignore.png' },
    { key: 'photos/broken.JPG' },
  ];
  const env = {
    R2: {
      list: async ({ cursor } = {}) => cursor
        ? { objects: listed.slice(2), truncated: false }
        : { objects: listed.slice(0, 2), truncated: true, cursor: 'next-page' },
      head: async (key) => key === 'photos/existing.avif' ? { key } : null,
      get: async (key) => key === 'photos/broken.JPG' ? null : { body: new ReadableStream() },
      put: async (key, body, options) => puts.push({ key, body, options }),
    },
    IMAGES: {
      input: () => ({
        output: async (options) => ({
          response: () => new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'Content-Type': options.format },
          }),
        }),
      }),
    },
  };

  const result = await convertPrefix('photos/', env);
  assert.equal(result.pages, 2);
  assert.equal(result.scanned, 3);
  assert.deepEqual(result.results.map((item) => item.status), ['converted', 'skipped', 'error']);
  assert.deepEqual(puts.map((item) => item.key), ['photos/first.avif']);
  assert.equal(puts[0].options.httpMetadata.contentType, 'image/avif');
  assert.match(puts[0].options.httpMetadata.cacheControl, /immutable/);
});

test('requires the admin token and accepts prefix query parameters', async () => {
  const env = {
    CONVERTER_TOKEN: 'secret',
    R2: { list: async () => ({ objects: [], truncated: false }), head: () => {}, get: () => {}, put: () => {} },
    IMAGES: { input: () => {} },
  };
  const unauthorized = await worker.fetch(new Request('https://example.com/?prefix=photos/'), env);
  assert.equal(unauthorized.status, 401);
  const authorized = await worker.fetch(new Request('https://example.com/?prefix=photos/', { headers: { Authorization: 'Bearer secret' } }), env);
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).prefix, 'photos/');
});
