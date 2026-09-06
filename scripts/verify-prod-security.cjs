// LLMHydra 生产安全行为验证（本地 → 公网域名）
// 凭据从本地 proxy_config.json 读取（8/31 已与生产同步，部署不覆盖配置），
// 不打印任何真实密钥，只输出 PASS/FAIL 与长度。
// 用法: node scripts/verify-prod-security.cjs   (可加 TEST_BASE 环境变量覆盖目标)

const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE || 'https://platform.infocloud.top';
const CFG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'proxy_config.json'), 'utf8')
);
const PW = CFG.settings.admin_password;
const PK = CFG.settings.proxy_key;
const MASK = '__LLMHYDRA_UNCHANGED__';

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${extra ? '  <- ' + extra : ''}`); fail++; }
}

async function jpost(url, body, token) {
  const r = await fetch(BASE + url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: r.status, json, text };
}

async function jget(url, token) {
  const r = await fetch(BASE + url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { code: r.status, text: await r.text() };
}

(async () => {
  console.log(`目标: ${BASE}`);
  console.log(`本地配置: 管理密码长度=${PW.length}, proxy_key长度=${PK.length}, models=${CFG.models.length}`);

  console.log('\n[A] 未鉴权访问');
  let r = await jget('/api/config');
  ck('无 token 访问 /api/config -> 401', r.code === 401, `got ${r.code}`);

  console.log('\n[B] 登录拿会话 token');
  const bad = await jpost('/api/login', { password: 'definitely-wrong-pw' });
  ck('错误密码 -> 401', bad.code === 401, `got ${bad.code}`);
  const good = await jpost('/api/login', { password: PW });
  ck('正确密码 -> success', good.code === 200 && good.json && good.json.success === true, `got ${good.code}`);
  const token = good.json && good.json.token;
  ck('token 存在且非密码明文', !!token && token !== PW, token ? `len=${token.length}` : 'no token');
  if (token) ck('token 为 43 位随机串', token.length === 43, `len=${token.length}`);
  const asPw = await jget('/api/config', PW);
  ck('旧密码当 token -> 401', asPw.code === 401, `got ${asPw.code}`);

  console.log('\n[C] /api/config 密钥脱敏');
  const cfg = await jget('/api/config', token);
  ck('带 token 访问 -> 200', cfg.code === 200, `got ${cfg.code}`);
  ck('含掩码哨兵', cfg.text.includes(MASK));
  let leaked = [];
  for (const m of CFG.models) {
    if (m.endpoint && m.endpoint.api_key && cfg.text.includes(m.endpoint.api_key)) leaked.push(m.id);
  }
  if (cfg.text.includes(PK)) leaked.push('proxy_key');
  if (cfg.text.includes(PW)) leaked.push('admin_password');
  ck('无真实密钥泄漏', leaked.length === 0, leaked.join(','));

  console.log('\n[D] 代理链路');
  const models = await jget('/v1/models', PK);
  ck('/v1/models 带 proxy_key -> 200', models.code === 200, `got ${models.code}`);
  const noKey = await jget('/v1/models');
  ck('/v1/models 无 key -> 401', noKey.code === 401, `got ${noKey.code}`);

  console.log('\n[E] 登出');
  if (token) {
    await jpost('/api/logout', {}, token);
    const after = await jget('/api/config', token);
    ck('登出后 token 失效 -> 401', after.code === 401, `got ${after.code}`);
  }

  console.log('\n[F] /models/test 掩码回填（回归：脱敏后测试不再报 Invalid API Key）');
  // [E] 已登出，重新登录拿新会话
  const relogin = await jpost('/api/login', { password: PW });
  const t2 = relogin.json && relogin.json.token;
  ck('[F] 重新登录拿新 token', !!t2);
  const keyed = CFG.models.find((m) => m.endpoint && m.endpoint.url && m.endpoint.api_key);
  if (keyed && t2) {
    const norm = (u) => u.replace(/\/+$/, '');
    const t = await jpost('/api/models/test', {
      endpoint: { url: norm(keyed.endpoint.url), api_key: MASK },
      model_id: keyed.model_id,
      thinking_enabled: false,
      ssl_verify: keyed.ssl_verify !== false,
      endpoint_timeout: 30,
      api_type: 'openai'
    }, t2);
    const raw = JSON.stringify(t.json || t.text || '').toLowerCase();
    const authErr = raw.includes('invalid api key') || raw.includes('invalid_key') || raw.includes('api key');
    ck(`测试请求可完成 (${keyed.model_id})`, t.code === 200, `got ${t.code} ${(t.text || '').slice(0, 120)}`);
    ck('不再出现 Invalid API Key', !authErr);
    if (t.json && t.json.success) console.log('    （上游返回成功，密钥有效）');
    else if (t.json && t.json.response) console.log('    （上游有响应，非鉴权错误）');
  } else {
    console.log('    SKIP: 本地配置没有带密钥的模型或登录失败');
  }

  console.log(`\n════════ 通过 ${pass} 项，失败 ${fail} 项 ════════`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e.message); process.exit(2); });
