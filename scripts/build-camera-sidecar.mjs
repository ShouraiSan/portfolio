// 生成 .photo-camera.json —— 摄影页灯箱所用的机身/镜头/年份旁挂清单。
//
// 为什么需要它：
//   Worker 的清单构建刻意不读图片二进制（PHOTO_EXIF_SCAN 默认关闭，因为逐张读
//   512 KB + 解析 EXIF 会撞 Worker CPU 上限）。代价是 camera/lens/year 只能来自
//   R2 对象的 customMetadata；而现有对象的 metadata 里没有这些字段，于是清单里
//   camera 全是空串，灯箱的「机身 / 镜头」一行永远不显示。
//
//   与其改写 58 个 R2 对象的 metadata（S3 API 的原地 copy 需要凭据，若要重传则
//   是 0.4 GB），不如放一个几 KB 的旁挂 JSON：listImages() 已经排除以 `_` 开头的
//   对象，因此它不会被当成照片，也不污染清单。
//
// 数据来源：本地原图 EXIF（默认 I:\Lr调色导出），经 .photo-thumbs/local-map.json
// 建立与桶内对象名的对应关系。
//
// 用法： node scripts/build-camera-sidecar.mjs
// 产物： .photo-camera.json（项目根目录，需上传到 R2 桶 photo 的根路径）

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import exifr from 'exifr';

const ROOT = resolve(import.meta.dirname, '..');
const LOCAL_MAP = resolve(ROOT, '.photo-thumbs/local-map.json');
const OUT = resolve(ROOT, '.photo-camera.json');

// 与 Worker 侧保持同一套规范化思路：小写、全角括号转半角、_ - 空格 视为等价、去前导下划线。
// 这样即使 R2 对象键与本地命名在分隔符上有差异，也能对上号。
const norm = (s) => String(s).toLowerCase()
  .replace(/（/g, '(').replace(/）/g, ')')
  .replace(/[_\-\s]+/g, ' ')
  .replace(/^[\s_]+/, '')
  .trim();

if (!existsSync(LOCAL_MAP)) {
  console.error(`缺少 ${LOCAL_MAP}`);
  console.error('该文件记录桶内对象名与本地原图路径的对应关系，是生成旁挂清单的依据。');
  process.exit(1);
}

const map = JSON.parse(readFileSync(LOCAL_MAP, 'utf8'));
const photos = [];
const missing = [];

for (const entry of map) {
  const key = entry.key;                       // 桶内对象名（分类/文件名）
  const local = entry.local;                   // 本地原图绝对路径
  if (!existsSync(local)) { missing.push(key); continue; }

  let exif = {};
  try {
    exif = await exifr.parse(local, { gps: false, icc: false, userComment: false }) || {};
  } catch { exif = {}; }

  const make = String(exif.Make || '').trim();
  const model = String(exif.Model || '').trim();
  // 与 photo-catalog.js 的 cameraFor() 同一规则：型号已含厂牌前缀时不重复书写
  let camera = '';
  if (make && model && !model.toLowerCase().startsWith(make.toLowerCase())) camera = `${make} ${model}`;
  else camera = model || make;

  const takenAt = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate;
  const year = takenAt instanceof Date && !Number.isNaN(takenAt.valueOf()) ? String(takenAt.getFullYear()) : '';

  photos.push({
    key,
    camera: camera.trim(),
    lens: String(exif.LensModel || exif.Lens || '').trim(),
    year,
  });
}

const payload = {
  // 说明：Worker 用规范化后的 "分类/文件名（无扩展名）" 做匹配，因此本文件里的
  // key 采用桶内对象名的原样写法即可，分隔符差异由规范化吸收。
  note: '机身/镜头/年份旁挂清单。由 scripts/build-camera-sidecar.mjs 生成，上传到 R2 桶 photo 的根路径。新增照片后重跑该脚本并重新上传。',
  generatedAt: new Date().toISOString(),
  photos,
};

writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

const withCamera = photos.filter((p) => p.camera).length;
const withLens = photos.filter((p) => p.lens).length;
const withYear = photos.filter((p) => p.year).length;
console.log(`已写入 ${OUT}`);
console.log(`  照片总数: ${photos.length}`);
console.log(`  含机身  : ${withCamera}`);
console.log(`  含镜头  : ${withLens}`);
console.log(`  含年份  : ${withYear}`);
if (missing.length) {
  console.log(`  本地原图不可达，已跳过 ${missing.length} 张:`);
  missing.slice(0, 10).forEach((m) => console.log(`    ${m}`));
}
