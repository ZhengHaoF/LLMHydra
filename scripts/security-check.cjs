// LLMHydra 安全加固回归脚本
//
// 用途：验证 P0 安全措施是否仍然生效（登录限流、会话 token、配置脱敏、
//       掩码回填、登出失效、改密强度校验、代理鉴权、代理主链路回归）。
//
// 用法：
//   1. 准备一份测试用配置（不要直接用生产的 proxy_config.json，脚本会改动模型名）
//   2. 用隔离配置启动服务：
//        CONFIG_FILE=<测试配置> STATS_DB_PATH=<测试库> HOST=127.0.0.1 node index.js
//   3. 执行：
//        TEST_BASE=http://127.0.0.1:<端口> \
//        TEST_CFG=<测试配置路径> \
//        TEST_ADMIN_PW=<管理密码> \
//        TEST_PROXY_KEY=<代理密钥> \
//        TEST_MODEL_KEY=<配置里第一个模型的真实 api_key> \
//        TEST_GROUP=<配置组 ID> \
//        node scripts/security-check.cjs
//
// 注意：登录限流用例放在最后 —— 它会耗尽当前 IP 的 15 分钟配额，
//       放前面会让其余用例全部拿到 429。重跑前请重启服务实例。

const fs = require('fs');
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8093';
const CFG_FILE = process.env.TEST_CFG || '';
const MASK = '__LLMHYDRA_UNCHANGED__';

// 凭据一律从环境变量读取，不写进文件
const ADMIN_PW = process.env.TEST_ADMIN_PW;
const PROXY_KEY = process.env.TEST_PROXY_KEY;
const REAL_MODEL_KEY = process.env.TEST_MODEL_KEY;

let pass = 0;
let fail = 0;
const failures = [];

function ck(name, actual, expected) {
  if (String(actual) === String(expected)) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}  (期望 ${expected} / 实际 ${actual})`);
  }
}

function section(t) {
  console.log(`\n【${t}】`);
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  return { code: res.status, body: await res.text() };
}

async function postJson(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return req(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function getWithToken(path, token) {
  return req(path, { headers: { Authorization: `Bearer ${token}` } });
}

async function login(password) {
  const r = await postJson('/api/login', { password });
  let token = '';
  let success = false;
  try {
    const j = JSON.parse(r.body);
    token = j.token || '';
    success = !!j.success;
  } catch (_) { /* ignore */ }
  return { code: r.code, token, success };
}

function modelOnDisk() {
  return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')).models[0];
}

async function main() {
  if (!ADMIN_PW || !PROXY_KEY || !REAL_MODEL_KEY) {
    console.error('缺少环境变量：TEST_ADMIN_PW / TEST_PROXY_KEY / TEST_MODEL_KEY');
    process.exit(2);
  }

  // ---------- A. 未鉴权访问 ----------
  section('A. 未鉴权访问');
  ck('无 token 访问 /api/config', (await req('/api/config')).code, 401);
  ck('代理路径 + 错误 proxy_key',
    (await req('/v1/models', { headers: { Authorization: 'Bearer definitely-wrong' } })).code, 401);
  ck('代理路径 + 正确 proxy_key',
    (await req('/v1/models', { headers: { Authorization: `Bearer ${PROXY_KEY}` } })).code, 200);

  // ---------- B. 登录与会话 token ----------
  section('B. 登录与会话 token');
  ck('错误密码登录被拒', (await login('not-the-password')).code, 401);

  const ok = await login(ADMIN_PW);
  ck('正确密码登录成功', ok.success, true);
  ck('token 长度 43（32 字节 base64url）', ok.token.length, 43);
  ck('token 不等于密码明文', ok.token !== ADMIN_PW, true);
  ck('把密码当 token 使用被拒', (await getWithToken('/api/config', ADMIN_PW)).code, 401);
  ck('会话 token 可正常访问', (await getWithToken('/api/config', ok.token)).code, 200);

  // ---------- C. 配置脱敏 ----------
  section('C. /api/config 密钥脱敏');
  const cfgBody = (await getWithToken('/api/config', ok.token)).body;
  ck('不含真实上游 Key', cfgBody.includes(REAL_MODEL_KEY), false);
  ck('不含真实 proxy_key', cfgBody.includes(PROXY_KEY), false);
  ck('不含真实管理密码', cfgBody.includes(ADMIN_PW), false);
  ck('api_key 已替换为掩码', cfgBody.includes(MASK), true);

  // ---------- D. 掩码回填（编辑模型不覆盖原密钥） ----------
  section('D. 编辑模型不覆盖原密钥');
  const before = modelOnDisk();
  ck('改前磁盘密钥是真实值', before.endpoint.api_key, REAL_MODEL_KEY);

  const putRes = await req(`/api/models/${before.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ok.token}` },
    body: JSON.stringify({
      display_name: '改名验证',
      endpoint: { url: before.endpoint.url, api_key: MASK }
    })
  });
  ck('PUT 模型返回 200', putRes.code, 200);

  const after = modelOnDisk();
  ck('磁盘密钥仍为原值（未被掩码覆盖）', after.endpoint.api_key, REAL_MODEL_KEY);
  ck('其他字段改动已生效', after.display_name, '改名验证');

  // ---------- E. 登出使 token 失效 ----------
  section('E. 登出使 token 立即失效');
  ck('登出接口返回 200', (await postJson('/api/logout', {}, ok.token)).code, 200);
  ck('登出后原 token 不可用', (await getWithToken('/api/config', ok.token)).code, 401);

  // ---------- F. 改密强度校验 ----------
  section('F. 修改管理密码');
  const s2 = await login(ADMIN_PW);
  ck('重新登录成功', s2.success, true);

  const weak = await postJson('/api/admin/password',
    { current_password: ADMIN_PW, new_password: 'abc' }, s2.token);
  ck('弱新密码被拒绝(400)', weak.code, 400);

  const wrongCur = await postJson('/api/admin/password',
    { current_password: 'definitely-not-current', new_password: 'An0ther!Str0ng#99' }, s2.token);
  ck('当前密码错误被拒绝(403)', wrongCur.code, 403);

  // ---------- G. 代理主链路回归（确认密钥校验改动未破坏转发） ----------
  section('G. 代理主链路回归');
  const chat = await req('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROXY_KEY}` },
    body: JSON.stringify({
      model: process.env.TEST_GROUP || 't-group',
      messages: [{ role: 'user', content: 'ping' }],
      stream: false
    })
  });
  // 测试环境的上游密钥是假的，预期走完整条重试链后失败；
  // 这里只校验「请求确实进入了代理链路」而不是被密钥校验挡在门外
  ck('请求进入代理链路（非 401）', chat.code === 401, false);
  console.log(`  上游响应码: ${chat.code}`);

  // ---------- H. 登录限流（放最后，会耗尽配额） ----------
  section('H. 登录暴力破解限流（15 分钟内 10 次失败后封禁）');
  console.log('  连打 12 次错误密码...');
  const codes = [];
  for (let i = 0; i < 12; i++) {
    codes.push((await postJson('/api/login', { password: `brute-force-attempt-${i}` })).code);
  }
  console.log(`  响应序列: ${codes.join(' ')}`);
  const idx429 = codes.indexOf(429);
  ck('限流最终触发 429', idx429 >= 0, true);
  ck('429 出现前均为 401', idx429 < 0 ? true : codes.slice(0, idx429).every((c) => c === 401), true);
  ck('429 出现后均为 429', idx429 < 0 ? false : codes.slice(idx429).every((c) => c === 429), true);

  // ---------- 汇总 ----------
  console.log('\n' + '='.repeat(46));
  console.log(`结果：通过 ${pass} 项，失败 ${fail} 项`);
  if (fail > 0) {
    console.log('失败项：' + failures.join(' / '));
  }
  console.log('='.repeat(46));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
