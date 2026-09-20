import exifr from 'exifr';

const IMAGE_EXTENSION = /\.jpe?g$/i;
const METADATA_RANGE_BYTES = 512 * 1024;
const CATALOG_TTL_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();
let cachedCatalog;

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function assetIdFor(objectKey, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`photo-asset|${objectKey}`)));
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\0/g, '').trim() : '';
}

function filenameTitle(objectKey) {
  const filename = objectKey.split('/').at(-1).replace(/\.[^.]+$/, '');
  try { return decodeURIComponent(filename).replace(/[_-]+/g, ' ').trim(); }
  catch { return filename.replace(/[_-]+/g, ' ').trim(); }
}

function categoryFor(objectKey) {
  const parts = objectKey.split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '未分类';
}

export function yearFor(value, fallback = '', minimum = 1990) {
  const year = value instanceof Date && !Number.isNaN(value.valueOf())
    ? value.getFullYear()
    : Number(String(value || '').match(/(?:19|20)\d{2}/)?.[0]);
  return year >= minimum && year <= new Date().getFullYear() + 1 ? String(year) : fallback;
}

function dimensionsFromHeader(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === 'VP8X') {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return [width, height];
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
      }
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return [0, 0];
}

function cameraFor(exif, custom) {
  if (custom.camera) return custom.camera;
  const make = cleanText(exif.Make);
  const model = cleanText(exif.Model);
  if (!make) return model;
  if (!model || model.toLowerCase().startsWith(make.toLowerCase())) return model || make;
  return `${make} ${model}`;
}

async function readImageMetadata(env, object) {
  const custom = object.customMetadata || {};
  const allowExifScan = env.PHOTO_EXIF_SCAN === 'true';
  const needsBinary = allowExifScan && !(custom.width && custom.height && custom.year && custom.camera && custom.lens && custom.title);
  let buffer;
  let exif = {};
  if (needsBinary) {
    const body = await env.photo.get(object.key, { range: { offset: 0, length: Math.min(object.size, METADATA_RANGE_BYTES) } });
    if (body) {
      buffer = await body.arrayBuffer();
      try { exif = await exifr.parse(buffer, { gps: false, icc: false, userComment: false }) || {}; }
      catch { exif = {}; }
    }
  }

  const headerDimensions = buffer ? dimensionsFromHeader(buffer) : [0, 0];
  const width = Number(custom.width || exif.ExifImageWidth || exif.PixelXDimension || exif.ImageWidth || headerDimensions[0]) || 4;
  const height = Number(custom.height || exif.ExifImageHeight || exif.PixelYDimension || exif.ImageHeight || headerDimensions[1]) || 3;
  const takenAt = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate;
  const modifiedYear = object.uploaded instanceof Date ? String(object.uploaded.getFullYear()) : '';

  return {
    title: cleanText(custom.title || exif.Title || exif.XPTitle || exif.ImageDescription) || filenameTitle(object.key),
    year: custom.year ? yearFor(custom.year, modifiedYear, 1900) : yearFor(takenAt, modifiedYear),
    camera: cameraFor(exif, custom),
    lens: cleanText(custom.lens || exif.LensModel || exif.Lens),
    description: cleanText(custom.description || exif.Description || exif.ImageDescription),
    width,
    height,
    focalPoint: cleanText(custom.focalPoint) || '50% 50%',
  };
}

async function listImages(bucket) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ cursor, include: ['customMetadata', 'httpMetadata'] });
    objects.push(...page.objects.filter((object) => IMAGE_EXTENSION.test(object.key) && !object.key.startsWith('_')));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function loadPhotoCatalog(env, fallbackCatalog) {
  if (!env.photo?.list) return fallbackCatalog;
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) return cachedCatalog.value;

  const objects = await listImages(env.photo);
  if (objects.length === 0) return fallbackCatalog;
  const idSecret = env.PHOTO_ASSET_ID_SECRET || env.PHOTO_SIGNING_SECRET;
  const photos = await Promise.all(objects.map(async (object) => {
    const metadata = await readImageMetadata(env, object);
    return {
      assetId: await assetIdFor(object.key, idSecret),
      objectKey: object.key,
      category: categoryFor(object.key),
      version: cleanText(object.etag).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || '1',
      pending: false,
      ...metadata,
    };
  }));
  photos.sort((left, right) => left.category.localeCompare(right.category, 'zh-CN') || left.title.localeCompare(right.title, 'zh-CN'));
  const categories = ['全部', ...new Set(photos.map((photo) => photo.category))];
  const value = { demo: false, categories, photos, photosById: new Map(photos.map((photo) => [photo.assetId, photo])) };
  cachedCatalog = { expiresAt: Date.now() + CATALOG_TTL_MS, value };
  return value;
}

export function clearPhotoCatalogCache() {
  cachedCatalog = undefined;
}
