// 一次性验证脚本：把官方 Node SDK（cos-nodejs-sdk-v5/sdk/util.js）的 getAuth
// 原样移植过来，与 worker/src/index.js 的 cosAuthorization() 逐例比对。
// 两者一致即证明 Worker 实现与官方算法等价。
//
// 运行： node worker/test/cos-signature.verify.mjs
// 这不是单元测试（不参与 pnpm test），是可重复执行的核对工具。

import { createHash, createHmac } from 'node:crypto';
import { cosAuthorization } from '../src/index.js';

// --- 官方算法的忠实移植（仅保留我们需要的分支：无 query、单 host 头） ---
function camSafeUrlEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function officialAuthorization({ SecretId, SecretKey, method, host, pathname, now, expires = 600 }) {
  const qSignAlgorithm = 'sha1';
  const qAk = SecretId;
  const qKeyTime = `${now};${now + expires}`;
  const qSignTime = qKeyTime;
  const qHeaderList = 'host';
  const qUrlParamList = '';

  // 步骤一：SignKey
  const signKey = createHmac('sha1', SecretKey).update(qKeyTime).digest('hex');

  // 步骤二：FormatString（method \n pathname \n urlParams \n headers \n）
  const formatString = [
    String(method).toLowerCase(),
    pathname,
    '',                                              // 无 query 参数
    'host=' + camSafeUrlEncode(host).toLowerCase(),  // 单头，obj2str 形态
    '',
  ].join('\n');

  // 步骤三：StringToSign = "sha1\n" + qSignTime + "\n" + SHA1(FormatString) + "\n"
  const res = createHash('sha1').update(Buffer.from(formatString, 'utf8')).digest('hex');
  const stringToSign = ['sha1', qSignTime, res, ''].join('\n');

  // 步骤四：Signature
  const qSignature = createHmac('sha1', signKey).update(stringToSign).digest('hex');

  // 步骤五：Authorization
  return [
    'q-sign-algorithm=' + qSignAlgorithm,
    'q-ak=' + qAk,
    'q-sign-time=' + qSignTime,
    'q-key-time=' + qKeyTime,
    'q-header-list=' + qHeaderList,
    'q-url-param-list=' + qUrlParamList,
    'q-signature=' + qSignature,
  ].join('&');
}

// --- 真实场景的用例（取自桶内实际对象名与真实 host） ---
const SECRET_ID = 'test-secret-id-verify-000000000000';
const SECRET_KEY = 'TESTsecretKEYtestSECRETkeytestSECRETkey0';
const HOST = 'photo-1331415098.cos.ap-shanghai.myqcloud.com';

const cases = [
  ['纯 ASCII 键', '/thumbs/%E4%BA%BA%E5%83%8F/_DSC6557.avif'],
  ['中文分类目录', '/previews/%E9%A3%8E%E5%85%89/Chenshan_Park-7889.avif'],
  ['含空格键（编码为 %20）', '/thumbs/%E4%BA%BA%E5%83%8F/bocchi%20(5%20-%2012).avif'],
  ['全角括号 + 空格', '/thumbs/%E6%89%8B%E5%8A%9E/hobby_figure%EF%BC%88nomark%20(1%20-%2026).avif'],
  ['原图（大写扩展名）', '/%E4%BA%BA%E5%83%8F/_DSC6557.JPG'],
  ['原图（小写扩展名）', '/%E9%A3%8E%E5%85%89/Chenshan_Park-7889.jpg'],
  ['根路径', '/'],
];

const NOW = 1791644920; // 固定时间戳，保证可重复

let pass = 0;
let fail = 0;

for (const [label, pathname] of cases) {
  const input = {
    secretId: SECRET_ID,
    secretKey: SECRET_KEY,
    method: 'GET',
    host: HOST,
    pathname,
    now: NOW,
  };
  const mine = await cosAuthorization(input);
  const official = officialAuthorization({
    SecretId: SECRET_ID, SecretKey: SECRET_KEY, method: 'GET', host: HOST, pathname, now: NOW,
  });
  if (mine === official) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        mine    : ${mine}`);
    console.log(`        official: ${official}`);
  }
}

// --- 额外断言：签名结构正确性 + 时间窗口 ---
console.log('');
const auth = await cosAuthorization({
  secretId: SECRET_ID, secretKey: SECRET_KEY, method: 'GET', host: HOST, pathname: '/', now: NOW,
});
const parts = Object.fromEntries(auth.split('&').map((kv) => {
  const idx = kv.indexOf('=');
  return [kv.slice(0, idx), kv.slice(idx + 1)];
}));

const structureChecks = [
  ['q-sign-algorithm 为 sha1', parts['q-sign-algorithm'] === 'sha1'],
  ['q-ak 回显 SecretId', parts['q-ak'] === SECRET_ID],
  ['q-header-list 为 host', parts['q-header-list'] === 'host'],
  ['q-url-param-list 为空', parts['q-url-param-list'] === ''],
  ['q-key-time 形如 start;start+600', parts['q-key-time'] === `${NOW};${NOW + 600}`],
  ['q-sign-time 与 q-key-time 相同', parts['q-sign-time'] === parts['q-key-time']],
  ['q-signature 为 40 位十六进制', /^[0-9a-f]{40}$/.test(parts['q-signature'])],
  ['参数顺序遵循官方约定', auth.indexOf('q-sign-algorithm') === 0 && auth.indexOf('q-signature') > auth.indexOf('q-key-time')],
];
for (const [label, ok] of structureChecks) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); } else { fail += 1; console.log(`  FAIL  ${label}`); }
}

// --- 确定性：同输入必须同输出；不同 pathname 必须不同 ---
const again = await cosAuthorization({
  secretId: SECRET_ID, secretKey: SECRET_KEY, method: 'GET', host: HOST, pathname: '/', now: NOW,
});
const other = await cosAuthorization({
  secretId: SECRET_ID, secretKey: SECRET_KEY, method: 'GET', host: HOST, pathname: '/x', now: NOW,
});
const determinismChecks = [
  ['相同输入产生相同签名', again === auth],
  ['不同 pathname 产生不同签名', other !== auth],
  ['不同密钥产生不同签名', (await cosAuthorization({
    secretId: SECRET_ID, secretKey: SECRET_KEY + 'x', method: 'GET', host: HOST, pathname: '/', now: NOW,
  })) !== auth],
];
for (const [label, ok] of determinismChecks) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); } else { fail += 1; console.log(`  FAIL  ${label}`); }
}

console.log('');
console.log(`结果：pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
