// 真实桶验证：用 .dev.vars 里的只读子用户凭据，调用**生产实现** cosFetch()
// 对上海 COS 的真实对象发起请求，确认 COS v5 签名被腾讯云接受。
//
// 为什么需要这个脚本：单元测试只能证明「我们的实现与官方 Node SDK 算法一致」，
// 无法证明「腾讯云服务端真的认这个签名」。路径编码形态这类差异只有打真实接口才暴露
// —— 事实上第一次运行就以 SignatureDoesNotMatch 抓出了该问题。
//
// 运行： node worker/test/cos-live-verify.mjs
// 前置： 项目根目录存在 .dev.vars（含 COS_SECRET_ID / COS_SECRET_KEY），已被 gitignore
//
// 安全性：只读凭据、只发 GET；所有输出对密钥与 Authorization 头做掩码。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cosAuthorization, cosFetch } from '../src/index.js';

const ROOT = resolve(import.meta.dirname, '../..');
const HOST = 'photo-1331415098.cos.ap-shanghai.myqcloud.com';

function loadDevVars() {
  const text = readFileSync(resolve(ROOT, '.dev.vars'), 'utf8');
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    vars[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return vars;
}

// 掩码：任何要打印的敏感串都先过这里
function mask(value) {
  const text = String(value || '');
  if (text.length <= 6) return '*'.repeat(text.length);
  return `${text.slice(0, 3)}${'*'.repeat(6)}${text.slice(-2)} (len=${text.length})`;
}

const vars = loadDevVars();
if (!vars.COS_SECRET_ID || !vars.COS_SECRET_KEY) {
  console.error('缺少 COS_SECRET_ID / COS_SECRET_KEY，请先创建 .dev.vars');
  process.exit(2);
}

// cosFetch 只关心这两个键，其余环境变量与本验证无关
const env = { COS_SECRET_ID: vars.COS_SECRET_ID, COS_SECRET_KEY: vars.COS_SECRET_KEY };

// 真实对象名，覆盖最容易签错的形态
const CASES = [
  ['纯 ASCII 路径',                '/thumbs/%E4%BA%BA%E5%83%8F/_DSC6557.avif',                              'image/avif'],
  ['中文分类 + 半角空格',          '/thumbs/%E4%BA%BA%E5%83%8F/bocchi%20(5%20-%2012).avif',                'image/avif'],
  ['全角括号 + 空格（混合命名）',   '/thumbs/%E6%89%8B%E5%8A%9E/hobby_figure%EF%BC%88nomark%20(1%20-%2026).avif', 'image/avif'],
  ['预览图 2000px',                '/previews/%E9%A3%8E%E5%85%89/Chenshan_Park-7889.avif',                  'image/avif'],
  ['原图（大写扩展名）',            '/%E4%BA%BA%E5%83%8F/_DSC6557.JPG',                                       'image/jpeg'],
  ['原图（小写扩展名）',            '/%E9%A3%8E%E5%85%89/Chenshan_Park-7889.jpg',                             'image/jpeg'],
];

let pass = 0;
let fail = 0;

console.log(`目标桶：${HOST}`);
console.log(`凭据  ：SecretId ${mask(vars.COS_SECRET_ID)}，SecretKey ${mask(vars.COS_SECRET_KEY)}`);
console.log('');

for (const [label, pathname, expectedType] of CASES) {
  let response;
  try {
    response = await cosFetch(env, `https://${HOST}${pathname}`);
  } catch (error) {
    fail += 1;
    console.log(`  FAIL  ${label}  — 网络错误: ${error.message}`);
    continue;
  }
  const contentType = response.headers.get('content-type') || '';
  if (response.ok && contentType.startsWith(expectedType)) {
    pass += 1;
    const length = response.headers.get('content-length');
    console.log(`  PASS  ${label}  — HTTP ${response.status}, ${contentType}${length ? `, ${length} bytes` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}  — HTTP ${response.status}, content-type=${contentType || '<无>'}`);
    if (response.status === 403) {
      const body = await response.text();
      const code = (body.match(/<Code>(.*?)<\/Code>/) || [])[1] || '';
      console.log(`        服务端错误码: ${code || body.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
}

// 反向验证：篡改签名必须被拒，否则说明桶仍是公开读、签名根本没被校验
console.log('');
const probePath = '/thumbs/%E4%BA%BA%E5%83%8F/_DSC6557.avif';
const goodAuth = await cosAuthorization({
  secretId: vars.COS_SECRET_ID, secretKey: vars.COS_SECRET_KEY, method: 'GET', host: HOST,
  pathname: decodeURIComponent(probePath),
});
const tampered = goodAuth.replace(/q-signature=[0-9a-f]{8}/, 'q-signature=deadbeef');
const tamperResponse = await fetch(`https://${HOST}${probePath}`, {
  headers: { Authorization: tampered, Range: 'bytes=0-511' },
  signal: AbortSignal.timeout(30_000),
});
if (tamperResponse.status === 403 || tamperResponse.status === 401) {
  pass += 1;
  console.log(`  PASS  篡改签名被拒绝（HTTP ${tamperResponse.status}）`);
} else {
  fail += 1;
  console.log(`  FAIL  篡改签名未被拒绝（HTTP ${tamperResponse.status}）`);
}

// 匿名请求：桶改为私有之后应变为 403。当前若仍为 200，说明桶还是公开读。
const anonResponse = await fetch(`https://${HOST}${probePath}`, {
  headers: { Range: 'bytes=0-511' },
  signal: AbortSignal.timeout(30_000),
});
if (anonResponse.status === 403) {
  pass += 1;
  console.log('  PASS  匿名请求已被拒绝（桶已私有化）');
} else {
  console.log(`  待办  匿名请求仍返回 HTTP ${anonResponse.status} —— 桶还是公开读，第 4 步尚未执行`);
}

console.log('');
console.log(`结果：pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
