// 缩略图生成工具（需要时手动运行，不属于构建流程）
//
// 用途：把本地原图压成摄影页网格缩略图（800px / AVIF q60），
//       输出到 .photo-thumbs/upload/，结构与你 COS 桶的 thumbs/ 一一对应，
//       直接拖拽上传即可。
//
// 用法：
//   1. 临时安装图像库：  pnpm add -D sharp --ignore-workspace-root-check
//   2. 运行：            node make-thumbs-batch.cjs
//   3. 上传：            把 .photo-thumbs/upload/ 下的分类目录拖到 COS 的 thumbs/ 下
//   4. 用完移除依赖：    pnpm remove sharp
//
// 说明：
//   - 源图目录默认 I:\Lr调色导出，可用 LOCAL_ROOT 环境变量覆盖
//   - 照片清单从 COS 桶实时读取（利用桶的 ListBucket 权限），无需手工维护映射表
//   - 匹配规则：把两侧文件名规范化（小写、全角括号转半角、_ - 空格 视为等价）后比对，
//     因为 COS 文件名与本地导出名在这些字符上并不完全一致
const fs = require('fs');
const path = require('path');
const https = require('https');

let sharp;
try { sharp = require('sharp'); } catch {
  console.error('缺少 sharp。请先执行：pnpm add -D sharp --ignore-workspace-root-check');
  process.exit(1);
}

const LOCAL_ROOT = process.env.LOCAL_ROOT || 'I:\\Lr调色导出';
const COS = process.env.COS_BASE || 'https://kensym-1331415098.cos.ap-hongkong.myqcloud.com';
const CATEGORIES = ['人像', '手办', '街头', '风光'];
const WIDTH = Number(process.env.THUMB_WIDTH || 800);
const QUALITY = Number(process.env.THUMB_QUALITY || 60);
const CONCURRENCY = 4;

const OUT = path.join(__dirname, '.photo-thumbs');
const DEST = path.join(OUT, 'upload');

function get(url) {
  return new Promise((resolve) => {
    https.get(url, { timeout: 120000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (s) => {
      const chunks = [];
      s.on('data', (c) => chunks.push(c));
      s.on('end', () => resolve({ code: s.statusCode, buf: Buffer.concat(chunks) }));
    }).on('error', (e) => resolve({ code: 0, err: e.message }))
      .on('timeout', function () { this.destroy(); resolve({ code: 0, err: 'timeout' }); });
  });
}

const norm = (s) => String(s).toLowerCase()
  .replace(/（/g, '(').replace(/）/g, ')')
  .replace(/[_\-\s]+/g, ' ')
  .trim();

function scanLocal(root) {
  const found = new Map();
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(jpe?g|png|tiff?)$/i.test(e.name)) continue;
      const key = norm(e.name.replace(/\.[^.]+$/, ''));
      let size = 0;
      try { size = fs.statSync(full).size; } catch { continue; }
      // 同名多份时保留体积最大的（通常是原始导出）
      const prev = found.get(key);
      if (!prev || size > prev.size) found.set(key, { local: full, size });
    }
  })(root);
  return found;
}

async function buildOne(item) {
  const rel = `${item.category}/${item.cosName}`;
  const outPath = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const buf = await sharp(item.local)
    .rotate()
    .resize({ width: WIDTH, withoutEnlargement: true })
    .avif({ quality: QUALITY, effort: 6 })
    .toBuffer();
  fs.writeFileSync(outPath, buf);
  return { rel, srcSize: item.size, outSize: buf.length };
}

(async () => {
  if (!fs.existsSync(LOCAL_ROOT)) {
    console.error(`源图目录不存在: ${LOCAL_ROOT}（可用 LOCAL_ROOT 环境变量指定）`);
    process.exit(1);
  }

  console.log(`源图目录: ${LOCAL_ROOT}`);
  console.log('从 COS 读取照片清单…');
  const items = [];
  for (const cat of CATEGORIES) {
    const r = await get(`${COS}/?prefix=${encodeURIComponent(cat + '/')}&max-keys=1000`);
    const xml = r.buf ? r.buf.toString() : '';
    if (/<Code>AccessDenied<\/Code>/.test(xml)) {
      console.error(`列出 ${cat}/ 被拒绝：桶未开启 ListBucket 权限`);
      process.exit(1);
    }
    const names = [...xml.matchAll(/<Key>([^<]*\.jpe?g)<\/Key>/gi)].map((m) => decodeURIComponent(m[1].split('/')[1]));
    names.forEach((n) => items.push({ category: cat, cosName: n.replace(/\.[^.]+$/, '.avif'), cosBase: n }));
    console.log(`  ${cat}: ${names.length} 张`);
  }
  if (items.length === 0) { console.error('未找到任何照片'); process.exit(1); }

  console.log('\n扫描本地原图…');
  const local = scanLocal(LOCAL_ROOT);
  console.log(`  本地候选: ${local.size} 个`);

  const matched = [];
  const missing = [];
  for (const it of items) {
    const hit = local.get(norm(it.cosBase.replace(/\.[^.]+$/, '')));
    if (hit) matched.push({ ...it, ...hit });
    else missing.push(`${it.category}/${it.cosBase}`);
  }
  console.log(`  匹配成功: ${matched.length}/${items.length}`);
  if (missing.length) {
    console.log('  未找到本地原图:');
    missing.forEach((m) => console.log('    ' + m));
  }
  if (matched.length === 0) { console.error('没有可处理的照片'); process.exit(1); }

  fs.rmSync(DEST, { recursive: true, force: true });
  console.log(`\n生成 ${WIDTH}px AVIF q${QUALITY}…`);
  const results = [];
  for (let i = 0; i < matched.length; i += CONCURRENCY) {
    const batch = matched.slice(i, i + CONCURRENCY);
    const done = await Promise.all(batch.map(async (it) => {
      try { return await buildOne(it); }
      catch (e) { return { error: String((e && e.message) || e), rel: `${it.category}/${it.cosName}` }; }
    }));
    for (const d of done) {
      if (d.error) console.log(`  [失败] ${d.rel} — ${d.error}`);
      else results.push(d);
    }
  }

  const srcTotal = results.reduce((n, r) => n + r.srcSize, 0);
  const outTotal = results.reduce((n, r) => n + r.outSize, 0);
  console.log('\n================ 汇总 ================');
  console.log(`  成功: ${results.length}/${matched.length}`);
  console.log(`  源图合计:   ${(srcTotal / 1048576).toFixed(1)} MB`);
  console.log(`  缩略图合计: ${(outTotal / 1048576).toFixed(2)} MB`);
  console.log(`  压缩比:     ${(srcTotal / outTotal).toFixed(0)}×`);
  console.log(`\n输出目录: .photo-thumbs/upload/  （拖到 COS 的 thumbs/ 下即可）`);
})();
