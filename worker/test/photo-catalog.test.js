import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPhotoCatalogCache, loadPhotoCatalog, yearFor } from '../src/photo-catalog.js';

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}

test('catalog derives category, title, dimensions, and private asset id from R2 objects', async () => {
  clearPhotoCatalogCache();
  const image = pngHeader(1600, 1200);
  const env = {
    PHOTO_SIGNING_SECRET: 'catalog-test-secret',
    photo: {
      list: async () => ({
        objects: [{
          key: '手办/my_first_figure.png',
          size: image.byteLength,
          etag: 'etag-001',
          uploaded: new Date('2025-03-01T00:00:00Z'),
          customMetadata: {},
        }],
        truncated: false,
      }),
      get: async () => ({ arrayBuffer: async () => image }),
    },
  };
  const catalog = await loadPhotoCatalog(env, null);
  assert.equal(catalog.demo, false);
  assert.deepEqual(catalog.categories, ['全部', '手办']);
  assert.equal(catalog.photos[0].category, '手办');
  assert.equal(catalog.photos[0].title, 'my first figure');
  assert.equal(catalog.photos[0].year, '2025');
  assert.equal(catalog.photos[0].width, 1600);
  assert.equal(catalog.photos[0].height, 1200);
  assert.match(catalog.photos[0].assetId, /^[0-9a-f-]{36}$/);
  assert.notEqual(catalog.photos[0].assetId, catalog.photos[0].objectKey);
});

test('EXIF years outside the plausible range fall back to the upload year', () => {
  assert.equal(yearFor(new Date('1899-12-31T00:00:00Z'), '2026'), '2026');
  assert.equal(yearFor(new Date('2025-03-01T00:00:00Z'), '2026'), '2025');
});
