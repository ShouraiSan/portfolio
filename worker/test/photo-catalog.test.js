import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPhotoCatalogCache, loadPhotoCatalog, yearFor } from '../src/photo-catalog.js';

function jpegHeader(width, height) {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return bytes.buffer;
}

test('catalog derives category, title, dimensions, and private asset id from R2 objects', async () => {
  clearPhotoCatalogCache();
  const image = jpegHeader(1600, 1200);
  const env = {
    PHOTO_SIGNING_SECRET: 'catalog-test-secret',
    PHOTO_EXIF_SCAN: 'true',
    photo: {
      list: async () => ({
        objects: [{
          key: '手办/my_first_figure.jpg',
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

test('production catalog can skip EXIF parsing to stay within Worker CPU limits', async () => {
  clearPhotoCatalogCache();
  const reads = [];
  const env = {
    PHOTO_SIGNING_SECRET: 'catalog-test-secret',
    photo: {
      list: async () => ({
        objects: [{ key: '街头/new_upload.jpg', size: 100, etag: 'etag-002', uploaded: new Date('2026-09-20T00:00:00Z'), customMetadata: {} }],
        truncated: false,
      }),
      // 记录读到哪些对象
      get: async (key) => { reads.push(key); return null; },
    },
  };
  const catalog = await loadPhotoCatalog(env, null);

  // 关键约束：**不得读取图片二进制**（那是 PHOTO_EXIF_SCAN 才做的事，会撞 CPU 上限）。
  // 唯一允许的 get 是那一次旁挂清单探测；返回 null 时按「无旁挂数据」继续。
  assert.deepEqual(reads, ['_camera.json']);

  assert.equal(catalog.photos[0].category, '街头');
  assert.equal(catalog.photos[0].title, 'new upload');
  assert.equal(catalog.photos[0].year, '2026');
  // 没有旁挂数据时 camera 仍为空（与引入旁挂之前一致）
  assert.equal(catalog.photos[0].camera, '');
});

test('EXIF years outside the plausible range fall back to the upload year', () => {
  assert.equal(yearFor(new Date('1899-12-31T00:00:00Z'), '2026'), '2026');
  assert.equal(yearFor(new Date('2025-03-01T00:00:00Z'), '2026'), '2025');
});

// ---- 机身/镜头/年份旁挂清单（_camera.json）--------------------------------
//
// 背景：清单构建不读图片二进制，所以 camera/lens/year 只能来自 R2 对象
// customMetadata；而现有对象上没有这些字段，灯箱的「机身 / 镜头」一直不显示。
// 旁挂清单补这个空缺，且**必须只补空缺、不覆盖对象自身 metadata**。

function sidecarEnv(sidecarBody, customMetadata = {}) {
  return {
    PHOTO_SIGNING_SECRET: 'catalog-test-secret',
    photo: {
      list: async () => ({
        objects: [{
          key: '风光/Chenshan_Park-7889.jpg', size: 100, etag: 'etag-003',
          uploaded: new Date('2026-01-01T00:00:00Z'), customMetadata,
        }],
        truncated: false,
      }),
      get: async (key) => (key === '_camera.json'
        ? { text: async () => JSON.stringify(sidecarBody) }
        : null),
    },
  };
}

test('camera sidecar fills camera, lens and year when object metadata is absent', async () => {
  clearPhotoCatalogCache();
  const env = sidecarEnv({
    photos: [{ key: '风光/Chenshan_Park-7889.jpg', camera: 'NIKON CORPORATION NIKON Z 8', lens: 'NIKKOR Z 24-70mm f/4 S', year: '2024' }],
  });
  const catalog = await loadPhotoCatalog(env, null);
  assert.equal(catalog.photos[0].camera, 'NIKON CORPORATION NIKON Z 8');
  assert.equal(catalog.photos[0].lens, 'NIKKOR Z 24-70mm f/4 S');
  assert.equal(catalog.photos[0].year, '2024');
});

test('camera sidecar matches despite separator differences between key forms', async () => {
  clearPhotoCatalogCache();
  // 清单里用空格形态，对象键是下划线形态 —— 规范化后必须仍然命中。
  // 这一点很重要：R2 与 COS 两侧的分隔符写法并不统一，匹配不能依赖字面相等。
  const env = sidecarEnv({
    photos: [{ key: '风光/Chenshan Park-7889.jpg', camera: 'NIKON Z 8', lens: 'NIKKOR Z 50mm f/1.8 S', year: '2025' }],
  });
  const catalog = await loadPhotoCatalog(env, null);
  assert.equal(catalog.photos[0].camera, 'NIKON Z 8');
  assert.equal(catalog.photos[0].lens, 'NIKKOR Z 50mm f/1.8 S');
});

test('object customMetadata wins over the camera sidecar', async () => {
  clearPhotoCatalogCache();
  // 对象上写好的 metadata 是权威来源；旁挂清单只是过渡手段，不得覆盖它。
  const env = sidecarEnv(
    { photos: [{ key: '风光/Chenshan_Park-7889.jpg', camera: 'FROM-SIDECAR', lens: 'SIDECAR-LENS', year: '1999' }] },
    { camera: 'FROM-OBJECT', lens: 'OBJECT-LENS', year: '2020' },
  );
  const catalog = await loadPhotoCatalog(env, null);
  assert.equal(catalog.photos[0].camera, 'FROM-OBJECT');
  assert.equal(catalog.photos[0].lens, 'OBJECT-LENS');
  assert.equal(catalog.photos[0].year, '2020');
});

test('a malformed or missing camera sidecar degrades silently', async () => {
  clearPhotoCatalogCache();
  const broken = {
    PHOTO_SIGNING_SECRET: 'catalog-test-secret',
    photo: {
      list: async () => ({
        objects: [{ key: '街头/x.jpg', size: 10, etag: 'e1', uploaded: new Date('2026-01-01T00:00:00Z'), customMetadata: {} }],
        truncated: false,
      }),
      get: async (key) => (key === '_camera.json' ? { text: async () => 'not json at all' } : null),
    },
  };
  const catalog = await loadPhotoCatalog(broken, null);
  // 解析失败不应影响清单本身，camera 退回空串
  assert.equal(catalog.photos.length, 1);
  assert.equal(catalog.photos[0].camera, '');
});
