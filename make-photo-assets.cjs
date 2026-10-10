// 图片资源生成工具（缩略图 + 灯箱预览图）—— 需要时手动运行，不属于构建流程
//
// 用途：
//   1. 网格缩略图  800px  AVIF q60  → .photo-thumbs/upload-thumbs/   上传到 COS 的 thumbs/
//   2. 灯箱预览图 2000px  AVIF q65  → .photo-thumbs/upload-previews/ 上传到 COS 的 previews/
//
// 设计说明：
//   - 只扫描本地图库（默认 I:\Lr调色导出），不需要 COS 的 ListBucket 权限
//   - 资源文件名 = 本地导出文件名（去掉相机前缀的下划线差异由 normalize 兼容），
//     与 Worker 侧由 R2 对象键推导候选键的逻辑一致
//   - 一律从本地 .jpg 生成，不使用桶里已有的 .avif
//
// 用法：
//   1. 临时安装图像库：  pnpm add -D sharp --ignore-workspace-root-check
//   2. 生成：            node make-photo-assets.cjs
//      可选环境变量：    LOCAL_ROOT / THUMB_WIDTH / PREVIEW_WIDTH / PREVIEW_QUALITY
//   3. 上传：            把 upload-thumbs/ 拖到 COS 的 thumbs/，upload-previews/ 拖到 previews/
//   4. 用完移除依赖：    pnpm remove sharp
const fs = require('fs');
const path = require('path');

let sharp;
try { sharp = require('sharp'); } catch {
  console.error('缺少 sharp。请先执行：pnpm add -D sharp --ignore-workspace-root-check');
  process.exit(1);
}

const LOCAL_ROOT = process.env.LOCAL_ROOT || 'I:\\Lr调色导出';
const THUMB_WIDTH = Number(process.env.THUMB_WIDTH || 800);
const THUMB_QUALITY = Number(process.env.THUMB_QUALITY || 60);
const PREVIEW_WIDTH = Number(process.env.PREVIEW_WIDTH || 2000);
const PREVIEW_QUALITY = Number(process.env.PREVIEW_QUALITY || 65);
const CONCURRENCY = 4;

const OUT = path.join(__dirname, '.photo-thumbs');
const DEST_THUMB = path.join(OUT, 'upload-thumbs');
const DEST_PREVIEW = path.join(OUT, 'upload-previews');

// 与 Worker 侧 thumbCandidates 保持同一套规范化思路：
// 小写、全角括号转半角、_ - 空格 视为等价、去掉前导下划线
const norm = (s) => String(s).toLowerCase()
  .replace(/（/g, '(').replace(/）/g, ')')
  .replace(/[_\-\s]+/g, ' ')
  .replace(/^[\s_]+/, '')
  .trim();

// 输出文件名不使用本地名字，而是采用「线上已验证可用的名字」。
// 原因：COS 侧文件名与 Worker 的候选键推导规则必须完全对齐，
// 自己另起一套命名（例如把空格换成下划线）会导致 Worker 找不到对象。
// 参考目录 .photo-thumbs/upload 保存的就是当前线上正在使用、已实测可用的 58 个名字。
const REFERENCE_DIR = path.join(__dirname, '.photo-thumbs', 'upload');

function readReferenceNames() {
  if (!fs.existsSync(REFERENCE_DIR)) return null;
  const list = [];
  for (const cat of fs.readdirSync(REFERENCE_DIR)) {
    const dir = path.join(REFERENCE_DIR, cat);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.avif$/i.test(f)) continue;
      list.push({ category: cat, name: f });
    }
  }
  return list.length ? list : null;
}

function scanLocal(root) {
  const found = new Map();
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(jpe?g|png|tiff?)$/i.test(e.name)) continue;
      const base = e.name.replace(/\.[^.]+$/, '');
      let size = 0;
      try { size = fs.statSync(full).size; } catch { continue; }
      const item = { local: full, size, base };
      const key = norm(base);
      const prev = found.get(key);
      // 同名多份时保留体积最大的（通常是原始导出）
      if (!prev || size > prev.size) found.set(key, item);
    }
  })(root);
  return found;
}

async function makeOne(item, width, quality, destDir) {
  const outPath = path.join(destDir, item.name);
  const buf = await sharp(item.local)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .avif({ quality, effort: 6 })
    .toBuffer();
  fs.writeFileSync(outPath, buf);
  const meta = await sharp(buf).metadata();
  return { name: item.name, srcSize: item.size, outSize: buf.length, w: meta.width, h: meta.height };
}

async function runBatch(items, label, width, quality, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  console.log(`\n生成${label} ${width}px AVIF q${quality}…`);
  const results = [];
  const failed = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const done = await Promise.all(batch.map(async (it) => {
      try { return await makeOne(it, width, quality, destDir); }
      catch (e) { return { error: String((e && e.message) || e), name: it.base }; }
    }));
    for (const d of done) {
      if (d.error) { failed.push(d); console.log(`  [失败] ${d.name} — ${d.error}`); }
      else results.push(d);
    }
  }
  const srcTotal = results.reduce((n, r) => n + r.srcSize, 0);
  const outTotal = results.reduce((n, r) => n + r.outSize, 0);
  console.log(`  成功 ${results.length}${failed.length ? ` / 失败 ${failed.length}` : ''}`);
  if (results.length) {
    console.log(`  源图合计: ${(srcTotal / 1048576).toFixed(1)} MB`);
    console.log(`  产出合计: ${(outTotal / 1048576).toFixed(2)} MB   平均 ${(outTotal / results.length / 1024).toFixed(0)} KB   压缩比 ${(srcTotal / outTotal).toFixed(0)}×`);
  }
  return { results, failed };
}

(async () => {
  if (!fs.existsSync(LOCAL_ROOT)) {
    console.error(`源图目录不存在: ${LOCAL_ROOT}（可用 LOCAL_ROOT 环境变量指定）`);
    process.exit(1);
  }
  console.log(`源图目录: ${LOCAL_ROOT}`);
  const local = scanLocal(LOCAL_ROOT);
  console.log(`扫描到本地图片: ${local.size} 个`);

  // 以「线上已验证可用的名字」为准，逐个到本地图库找源图。
  // 这样产出的文件名与 Worker 的候选键推导规则必然一致，不会出现找不到对象的问题。
  const reference = readReferenceNames();
  if (!reference) {
    console.error(`缺少参考清单目录: ${REFERENCE_DIR}`);
    console.error('该目录保存线上正在使用的文件名，是本脚本的命名依据，不能删除。');
    process.exit(1);
  }
  const items = [];
  const missing = [];
  for (const ref of reference) {
    const hit = local.get(norm(ref.name.replace(/\.avif$/i, '')));
    if (hit) items.push({ ...hit, name: ref.name, category: ref.category });
    else missing.push(`${ref.category}/${ref.name}`);
  }
  console.log(`按线上清单匹配本地源图: ${items.length}/${reference.length}`);
  if (missing.length) {
    console.log('  本地图库缺少以下源图（这些将不会生成）:');
    missing.forEach((m) => console.log('    ' + m));
  }
  if (!items.length) { console.error('没有可处理的图片'); process.exit(1); }

  const thumbs = await runBatch(items, '网格缩略图', THUMB_WIDTH, THUMB_QUALITY, DEST_THUMB);
  const previews = await runBatch(items, '灯箱预览图', PREVIEW_WIDTH, PREVIEW_QUALITY, DEST_PREVIEW);

  // 输出对照清单，便于核对
  const index = previews.results.map((p) => {
    const t = thumbs.results.find((x) => x.name === p.name);
    return `${p.name}\t预览 ${(p.outSize / 1024).toFixed(0)} KB (${p.w}×${p.h})\t缩略图 ${t ? (t.outSize / 1024).toFixed(0) + ' KB' : '—'}`;
  });
  fs.writeFileSync(path.join(OUT, 'assets-index.txt'), index.join('\n'), 'utf8');

  console.log('\n================ 完成 ================');
  console.log(`  缩略图: ${DEST_THUMB.replace(__dirname + path.sep, '')}  → 上传到 COS 的 thumbs/`);
  console.log(`  预览图: ${DEST_PREVIEW.replace(__dirname + path.sep, '')}  → 上传到 COS 的 previews/`);
  console.log(`  对照清单: .photo-thumbs/assets-index.txt`);
})();
