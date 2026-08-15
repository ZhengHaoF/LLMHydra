// app.js — 单端口 Express：管理 API (/api/*) + HTTP 代理 (/*)

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');
const { isValidGroupId } = require('./config-manager');
const CircuitBreaker = require('./circuit-breaker');
const statsManager = require('./stats-manager');
const logManager = require('./log-manager');
const openrouter = require('./openrouter');

// SSE 连接数限制
const MAX_SSE_CONNECTIONS = 10;
let currentSSEConnections = 0;

function formatLogTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function log(msg) {
  console.log(`[${formatLogTime()}] ${msg}`);
  logManager.append(msg);
}

// 记录统计并广播统计更新事件（前端通过 SSE 收到后自动刷新）
function recordStats(entry) {
  statsManager.recordRequest(entry);
  logManager.broadcast({ type: 'stats', ts: Date.now() });
}

// ---- 工具 ----

// 代理请求体大小上限（20MB），防止无限制读入内存
const MAX_PROXY_BODY = 20 * 1024 * 1024;

function readBody(req, maxBytes = MAX_PROXY_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let overflowed = false;
    req.on('data', (c) => {
      if (overflowed) return;
      total += c.length;
      if (total > maxBytes) {
        overflowed = true;
        const err = new Error('request body too large');
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// 从上游错误响应 body 中提取简短可读的错误详情（OpenAI 兼容格式 error.message），避免日志过长
function extractErrorDetail(result) {
  const raw = typeof result.body === 'string' ? result.body : '';
  if (!raw) return result.reason || '';
  let detail = raw;
  try {
    const parsed = JSON.parse(raw);
    const err = parsed.error;
    if (typeof err === 'string' && err) detail = err;
    else if (err && typeof err.message === 'string' && err.message) detail = err.message;
    else if (typeof parsed.message === 'string' && parsed.message) detail = parsed.message;
    else detail = raw;
  } catch (_) { /* 非 JSON，直接使用原始 body */ }
  detail = detail.replace(/\s+/g, ' ').trim();
  return detail.length > 500 ? detail.slice(0, 500) + '…' : detail;
}

// 尝试一个模型（重试链上的一个节点）
function tryModel({ model, method, targetPath, baseHeaders, body, timeoutMs }) {
  return new Promise((resolve) => {
    const endpoint = model.endpoint;
    if (!endpoint || !endpoint.url) {
      return resolve({ ok: false, retryable: false, reason: 'model has no endpoint', modelId: model.id });
    }
    const upstreamUrl = new URL(endpoint.url);
    const proto = upstreamUrl.protocol === 'https:' ? https : http;
    const apiKey = (endpoint.api_key || '').trim();

    const reqHeaders = { ...baseHeaders };
    delete reqHeaders.host;
    delete reqHeaders['content-length'];
    delete reqHeaders['accept-encoding'];
    // 上游有自己的 api_key 才设置 Authorization；
    // 否则删除客户端带来的授权头，避免把代理密钥转发给上游
    delete reqHeaders.authorization;
    reqHeaders['content-length'] = Buffer.byteLength(body);
    if (apiKey) {
      reqHeaders['authorization'] = `Bearer ${apiKey}`;
    }

    const upstreamOpts = {
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port,
      path: targetPath,
      method,
      headers: reqHeaders,
      rejectUnauthorized: model.ssl_verify !== false
    };

    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };

    const upstreamReq = proto.request(upstreamOpts, (upstreamRes) => {
      const status = upstreamRes.statusCode;

      if (status >= 400 && status < 500) {
        const chunks = [];
        upstreamRes.on('data', (c) => chunks.push(c));
        upstreamRes.on('end', () => {
          settle({
            ok: false,
            retryable: status === 401 || status === 403 || status === 429,
            statusCode: status,
            body: Buffer.concat(chunks).toString(),
            modelId: model.id
          });
        });
        upstreamRes.on('error', () => {
          settle({ ok: false, retryable: false, statusCode: status, body: '', modelId: model.id });
        });
        return;
      }

      if (status >= 500) {
        upstreamRes.resume();
        upstreamRes.on('end', () => {
          settle({ ok: false, retryable: true, statusCode: status, reason: `HTTP ${status}`, modelId: model.id });
        });
        upstreamRes.on('error', () => {
          settle({ ok: false, retryable: true, statusCode: status, reason: `HTTP ${status}`, modelId: model.id });
        });
        return;
      }

      settle({ ok: true, upstreamRes, statusCode: status, modelId: model.id });
    });

    upstreamReq.on('error', (err) => {
      settle({ ok: false, retryable: true, reason: err.message, code: err.code, modelId: model.id });
    });

    const timer = setTimeout(() => {
      try { upstreamReq.destroy(new Error('endpoint timeout')); } catch (_) {}
      settle({ ok: false, retryable: true, reason: `timeout after ${timeoutMs}ms`, modelId: model.id });
    }, timeoutMs);

    upstreamReq.write(body);
    upstreamReq.end();
  });
}

function createProxyMiddleware(configManager, circuitBreaker) {
  return async function proxyMiddleware(req, res) {
    if (req.path.startsWith('/api')) return;

    // 代理密钥校验（在 readBody 之前，省资源）
    const settings = configManager.getSettings();
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || token !== settings.proxy_key) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid proxy key' }));
    }

    // 读 body 取 model 字段
    let rawBody;
    try {
      rawBody = await readBody(req);
    } catch (err) {
      const status = err.statusCode || 500;
      log(`[ERROR] 读取请求体失败: ${err.message}`);
      res.writeHead(status);
      res.end(status === 413 ? 'Request body too large (max 20MB)' : 'Failed to read request body');
      if (status === 413) {
        // 等 413 响应真正发出后再断开连接，中止客户端继续上传剩余 body
        res.on('finish', () => req.destroy());
      }
      return;
    }

    // 提取 group id（model 字段）
    let groupId = null;
    if (rawBody) {
      try {
        const parsed = JSON.parse(rawBody);
        if (typeof parsed.model === 'string' && parsed.model.trim()) {
          groupId = parsed.model.trim();
        }
      } catch (e) { /* pass through, treat as no model */ }
    }

    if (!groupId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'Missing or invalid "model" field. Pass a valid config group id (e.g. "deepseek-v4").'
      }));
    }

    const group = configManager.getGroupById(groupId);
    if (!group) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: `Config group not found: "${groupId}". Available: ${configManager.getConfig().groups.map((g) => g.id).join(', ') || '(none)'}`
      }));
    }

    const models = configManager.getGroupModels(group);
    if (models.length === 0) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Config group "${groupId}" has no available models` }));
    }

    const clientPath = req.originalUrl;
    const qIdx = clientPath.indexOf('?');
    const query = qIdx >= 0 ? clientPath.slice(qIdx) : '';
    let pathNoQuery = qIdx >= 0 ? clientPath.slice(0, qIdx) : clientPath;
    if (pathNoQuery.startsWith('/v1/')) {
      pathNoQuery = pathNoQuery.replace(/^\/v1/, '');
    } else if (pathNoQuery === '/v1') {
      pathNoQuery = '/';
    }
    const baseHeaders = { ...req.headers };
    const isStream = rawBody.includes('"stream":true') || rawBody.includes('"stream": true');

    // 按 chain 顺序尝试每个模型
    for (let i = 0; i < models.length; i++) {
      const model = models[i];

      // 熔断器检查：跳过已熔断的模型
      if (!circuitBreaker.isAvailable(model.id)) {
        const state = circuitBreaker.states.get(model.id);
        const until = state ? new Date(state.circuitOpenUntil).toISOString() : '';
        log(`[SKIP]  model #${i + 1} (${model.display_name}) — circuit breaker open until ${until}`);
        recordStats({
          group_id: groupId,
          model_id: model.id,
          model_display: model.display_name,
          path: pathNoQuery,
          status: 'skipped',
          error: 'circuit breaker open'
        });
        continue;
      }

      // 用第一个模型的 endpoint URL 作为基准
      let upstreamUrl;
      try {
        upstreamUrl = new URL(model.endpoint.url);
      } catch (e) {
        log(`[FAIL]  model #${i + 1} (${model.display_name}) — 无效端点 URL，跳过`);
        recordStats({
          group_id: groupId,
          model_id: model.id,
          model_display: model.display_name,
          path: pathNoQuery,
          status: 'failure',
          error: 'invalid endpoint url'
        });
        continue;
      }
      const targetPath = upstreamUrl.pathname.replace(/\/$/, '') + pathNoQuery + query;

      // 替换 model 字段为实际的 model_id
      let body = rawBody;
      if (model.model_id && body) {
        try {
          const json = JSON.parse(body);
          json.model = model.model_id;
          body = JSON.stringify(json);
        } catch (e) { /* pass through */ }
      }

      // thinking 注入：每个端点用各自的 model 配置
      if (model.thinking_enabled && body) {
        try {
          const json = JSON.parse(body);
          const userBudget = json.thinking && json.thinking.budget_tokens;
          json.thinking = { type: 'enabled' };
          if (userBudget) json.thinking.budget_tokens = userBudget;
          json.reasoning_effort = model.effort || 'medium';
          if (Array.isArray(json.messages)) {
            for (const msg of json.messages) {
              if (msg.role === 'assistant' && typeof msg.reasoning_content !== 'string') {
                msg.reasoning_content = '';
              }
            }
          }
          body = JSON.stringify(json);
        } catch (e) { /* pass through */ }
      }

      log(`${req.method} ${pathNoQuery}  [group=${groupId}/${model.display_name}]  try #${i + 1}/${models.length}  -> ${upstreamUrl.origin + targetPath}`);

      const timeoutMs = (model.endpoint_timeout || 30) * 1000;
      const modelStart = Date.now();

      const result = await tryModel({
        model,
        method: req.method,
        targetPath,
        baseHeaders,
        body,
        timeoutMs
      });

      if (result.ok) {
        circuitBreaker.recordSuccess(model.id);
        log(`[OK]    model #${i + 1} (${model.display_name}) status=${result.statusCode}`);
        const relayResult = await relayUpstream(result.upstreamRes, res, isStream);
        const latency = Date.now() - modelStart;
        const usage = relayResult && relayResult.usage ? relayResult.usage : null;
        recordStats({
          group_id: groupId,
          model_id: model.id,
          model_display: model.display_name,
          path: pathNoQuery,
          status: 'success',
          status_code: result.statusCode,
          prompt_tokens: usage ? (usage.prompt_tokens || 0) : 0,
          completion_tokens: usage ? (usage.completion_tokens || 0) : 0,
          total_tokens: usage ? (usage.total_tokens || 0) : 0,
          latency_ms: latency
        });
        return;
      }

      const latency = Date.now() - modelStart;
      const errDetail = extractErrorDetail(result);
      if (!result.retryable) {
        log(`[FAIL]  model #${i + 1} (${model.display_name}) ${result.statusCode || ''} — not retryable, abort.${errDetail ? ` upstream: ${errDetail}` : ''}`);
        const headers = { 'Content-Type': 'application/json' };
        res.writeHead(result.statusCode || 502, headers);
        let payload;
        try {
          payload = result.body ? JSON.parse(result.body) : { error: result.reason || 'upstream 4xx' };
        } catch {
          payload = { error: result.body || result.reason || 'upstream 4xx' };
        }
        res.end(JSON.stringify(payload));
        recordStats({
          group_id: groupId,
          model_id: model.id,
          model_display: model.display_name,
          path: pathNoQuery,
          status: 'failure',
          status_code: result.statusCode,
          latency_ms: latency,
          error: errDetail || result.reason || `HTTP ${result.statusCode}`
        });
        return;
      }

      circuitBreaker.recordFailure(model.id);
      log(`[FAIL]  model #${i + 1} (${model.display_name}) ${result.statusCode || ''} — try next.${errDetail ? ` upstream: ${errDetail}` : ''}`);
      recordStats({
        group_id: groupId,
        model_id: model.id,
        model_display: model.display_name,
        path: pathNoQuery,
        status: 'failure',
        status_code: result.statusCode,
        latency_ms: latency,
        error: result.reason || `HTTP ${result.statusCode}`
      });
    }

    log(`[ALL-FAIL] ${models.length} model(s) exhausted for group "${groupId}"`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'All models in chain failed', group: groupId, models_tried: models.length }));
  };
}

function relayUpstream(upstreamRes, clientRes, isStream) {
  const ct = upstreamRes.headers['content-type'] || '';

  if (isStream && ct.includes('text/event-stream')) {
    const rh = {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive'
    };
    clientRes.writeHead(upstreamRes.statusCode, rh);
    return handleSSE(upstreamRes, clientRes);
  } else if (ct.includes('application/json')) {
    return handleNonStreaming(upstreamRes, clientRes, upstreamRes.statusCode);
  } else {
    return new Promise((resolve) => {
      const rh = { ...upstreamRes.headers };
      delete rh['transfer-encoding'];
      clientRes.writeHead(upstreamRes.statusCode, rh);
      // 客户端断开时中止上游请求，避免泄漏连接
      const onClientClose = () => {
        if (!upstreamRes.destroyed) upstreamRes.destroy();
      };
      clientRes.on('close', onClientClose);
      upstreamRes.pipe(clientRes);
      upstreamRes.on('end', () => {
        clientRes.removeListener('close', onClientClose);
        resolve({ usage: null });
      });
      upstreamRes.on('error', () => {
        if (!clientRes.writableEnded) clientRes.end();
        clientRes.removeListener('close', onClientClose);
        resolve({ usage: null, error: true });
      });
    });
  }
}

function handleSSE(upstreamRes, clientRes) {
  return new Promise((resolve) => {
    let buffer = '';
    let lastUsage = null;

    // 客户端断开时中止上游请求，避免长流泄漏连接
    const onClientClose = () => {
      if (!upstreamRes.destroyed) upstreamRes.destroy();
    };
    clientRes.on('close', onClientClose);

    upstreamRes.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        let output = line;
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.usage) lastUsage = data.usage;
            if (data.choices && Array.isArray(data.choices)) {
              output = 'data: ' + JSON.stringify(data);
            }
          } catch (e) { /* pass through */ }
        }
        try { clientRes.write(output + '\n'); } catch (_) { /* 客户端可能已断开 */ }
      }
    });

    upstreamRes.on('end', () => {
      if (buffer) {
        const line = buffer.trim();
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.usage) lastUsage = data.usage;
            clientRes.write('data: ' + JSON.stringify(data) + '\n');
          } catch (e) { clientRes.write(line + '\n'); }
        } else if (line) {
          clientRes.write(line + '\n');
        }
      }
      clientRes.end();
      clientRes.removeListener('close', onClientClose);
      resolve({ usage: lastUsage });
    });

    upstreamRes.on('error', () => {
      if (!clientRes.writableEnded) clientRes.end();
      clientRes.removeListener('close', onClientClose);
      resolve({ usage: lastUsage, error: true });
    });
  });
}

function handleNonStreaming(upstreamRes, clientRes, statusCode) {
  return new Promise((resolve) => {
    let body = '';
    let usage = null;
    upstreamRes.on('data', c => body += c.toString());
    upstreamRes.on('end', () => {
      let responseBody = body;
      try {
        const data = JSON.parse(body);
        if (data.usage) usage = data.usage;
        if (data.choices && Array.isArray(data.choices)) {
          responseBody = JSON.stringify(data);
        }
      } catch (e) { /* not JSON */ }

      const headers = { ...upstreamRes.headers };
      delete headers['transfer-encoding'];
      headers['content-length'] = Buffer.byteLength(responseBody);
      clientRes.writeHead(statusCode, headers);
      clientRes.end(responseBody);
      resolve({ usage });
    });
    upstreamRes.on('error', () => {
      if (!clientRes.writableEnded) clientRes.end();
      resolve({ usage, error: true });
    });
  });
}

// ---- 创建应用 ----

function createApp(configManager) {
  const app = express();

  // 安全头
  app.use(helmet({
    contentSecurityPolicy: false,  // 允许内联脚本（Vue 需要）
    crossOriginEmbedderPolicy: false
  }));

  // 管理 API 限流
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 分钟
    max: 1000,  // 每个 IP 最多 1000 次请求
    standardHeaders: true,
    legacyHeaders: false
  });

  // 管理 API 鉴权中间件
  const adminAuth = (req, res, next) => {
    const adminPassword = configManager.getAdminPassword();

    // 优先从 Authorization header 取，其次从 query string 取（SSE 不支持自定义 header）
    let token = '';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Missing admin token' });
    }

    if (token !== adminPassword) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }

    next();
  };

  const circuitBreaker = new CircuitBreaker({
    threshold: configManager.getSettings().circuit_breaker_threshold,
    durationMs: configManager.getSettings().circuit_breaker_duration_min * 60 * 1000
  });

  const api = express.Router();
  api.use(apiLimiter);
  api.use(adminAuth);
  api.use(express.json({ limit: '10mb' }));

  // 整体配置（管理 API 已有 admin 鉴权，无需脱敏）
  api.get('/config', (req, res) => {
    res.json(configManager.getConfig());
  });

  // ---- 配置组 ----
  api.get('/groups', (req, res) => {
    res.json({ groups: configManager.getConfig().groups });
  });

  api.post('/groups', (req, res) => {
    const { id, name } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!isValidGroupId(id)) {
      return res.status(400).json({ error: '配置组 ID 仅允许中英文、数字和 -' });
    }
    try {
      const g = configManager.addGroup(id, name);
      res.json({ success: true, group: g });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.put('/groups/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);
    if (!configManager.updateGroup(id, req.body)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json({ success: true });
  });

  api.delete('/groups/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);
    if (!configManager.deleteGroup(id)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json({ success: true });
  });

  // ---- 模型 ----
  api.get('/models', (req, res) => {
    res.json({ models: configManager.getModels() });
  });

  api.post('/models', (req, res) => {
    const m = configManager.addModel(req.body);
    res.json({ success: true, model: m });
  });

  api.put('/models/:id', (req, res) => {
    const id = req.params.id;
    if (!configManager.updateModel(id, req.body)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    res.json({ success: true });
  });

  api.delete('/models/:id', (req, res) => {
    const id = req.params.id;
    if (!configManager.deleteModel(id)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    res.json({ success: true });
  });

  // ---- 端口 ----
  api.put('/config/port', (req, res) => {
    if (!req.body.port) return res.status(400).json({ error: 'Port required' });
    configManager.setPort(parseInt(req.body.port));
    res.json({ success: true });
  });

  // ---- 熔断器状态 ----
  api.get('/circuit-breaker', (req, res) => {
    res.json(circuitBreaker.getStatus());
  });

  // ---- 统计 ----
  api.get('/stats/overview', (req, res) => {
    res.json(statsManager.getOverview());
  });

  api.get('/stats/models', (req, res) => {
    res.json({ models: statsManager.getModelStats() });
  });

  api.get('/stats/groups', (req, res) => {
    res.json({ groups: statsManager.getGroupStats() });
  });

  api.get('/stats/recent', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json({ requests: statsManager.getRecentRequests(limit) });
  });

  api.get('/stats/daily', (req, res) => {
    const days = parseInt(req.query.days) || 30;
    res.json({ daily: statsManager.getDailyStats(days) });
  });

  api.delete('/stats', (req, res) => {
    statsManager.clearAll();
    res.json({ success: true });
  });

  // ---- 日志 ----
  api.get('/logs', (req, res) => {
    res.json({ logs: logManager.getRecent() });
  });

  api.get('/logs/stream', (req, res) => {
    if (currentSSEConnections >= MAX_SSE_CONNECTIONS) {
      return res.status(503).json({ error: 'Too many SSE connections' });
    }
    currentSSEConnections++;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('event: ready\ndata: {}\n\n');
    const unsubscribe = logManager.subscribe(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 30000);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      currentSSEConnections--;
    });
  });

  api.delete('/logs', (req, res) => {
    logManager.clear();
    res.json({ success: true });
  });

  // ---- OpenRouter 模型库 ----

  // 简单限流：1 分钟内最多刷新一次，避免前端手抖反复点
  let lastRefreshAt = 0;
  const REFRESH_COOLDOWN_MS = 60 * 1000;

  api.get('/openrouter/models', (req, res) => {
    const cached = openrouter.getCached(configManager);
    res.json(cached || { fetched_at: null, count: 0, models: [] });
  });

  api.post('/openrouter/refresh', async (req, res) => {
    const now = Date.now();
    if (now - lastRefreshAt < REFRESH_COOLDOWN_MS) {
      const waitSec = Math.ceil((REFRESH_COOLDOWN_MS - (now - lastRefreshAt)) / 1000);
      return res.status(429).json({ error: `操作过于频繁，请 ${waitSec} 秒后再试` });
    }
    lastRefreshAt = now;
    try {
      log('[OpenRouter] 开始拉取模型列表…');
      const payload = await openrouter.fetchAndCache(configManager);
      log(`[OpenRouter] 拉取完成，共 ${payload.count} 个模型`);
      res.json({ success: true, count: payload.count, fetched_at: payload.fetched_at });
    } catch (err) {
      log(`[OpenRouter] 拉取失败: ${err.message}`);
      // 失败回滚 lastRefreshAt，允许立即重试
      lastRefreshAt = 0;
      res.status(500).json({ error: err.message });
    }
  });

  api.get('/openrouter/match', (req, res) => {
    const modelId = (req.query.model_id || '').trim();
    if (!modelId) {
      return res.status(400).json({ error: 'model_id 不能为空' });
    }
    const match = openrouter.matchById(configManager, modelId);
    if (!match) {
      return res.json({ matched: false });
    }
    res.json({ matched: true, model: match });
  });

  // ---- 设置 ----
  api.get('/settings', (req, res) => {
    res.json(configManager.getSettings());
  });

  api.put('/settings', (req, res) => {
    const s = configManager.updateSettings(req.body);
    // 热更新熔断器配置
    circuitBreaker.updateConfig({
      threshold: s.circuit_breaker_threshold,
      durationMs: s.circuit_breaker_duration_min * 60 * 1000
    });
    res.json({ success: true, settings: s });
  });

  // ---- 代理密钥 ----
  api.get('/proxy-key', (req, res) => {
    res.json({ proxy_key: configManager.getProxyKey() });
  });

  api.post('/proxy-key/regenerate', (req, res) => {
    const newKey = configManager.regenerateProxyKey();
    res.json({ success: true, proxy_key: newKey });
  });

  // ---- 测试模型端点 ----
  api.post('/models/test', async (req, res) => {
    const { endpoint, model_id, thinking_enabled, effort, ssl_verify, endpoint_timeout } = req.body;

    if (!endpoint || !endpoint.url) {
      return res.status(400).json({ error: '缺少端点 URL' });
    }
    if (!model_id) {
      return res.status(400).json({ error: '缺少模型 ID' });
    }

    let upstreamUrl;
    try {
      upstreamUrl = new URL(endpoint.url);
    } catch (e) {
      return res.status(400).json({ error: '无效的端点 URL' });
    }
    const targetPath = upstreamUrl.pathname.replace(/\/$/, '') + '/chat/completions';
    const proto = upstreamUrl.protocol === 'https:' ? https : http;
    const apiKey = (endpoint.api_key || '').trim();

    // 构造测试请求体
    const testBody = {
      model: model_id,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 50
    };

    if (thinking_enabled) {
      testBody.thinking = { type: 'enabled' };
      testBody.reasoning_effort = effort || 'medium';
    }

    const bodyStr = JSON.stringify(testBody);

    const reqHeaders = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    };
    if (apiKey) {
      reqHeaders['Authorization'] = `Bearer ${apiKey}`;
    }

    const upstreamOpts = {
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port,
      path: targetPath,
      method: 'POST',
      headers: reqHeaders,
      rejectUnauthorized: ssl_verify !== false
    };

    const timeoutMs = (endpoint_timeout || 30) * 1000;

    try {
      const result = await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (v) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(v);
        };

        const upstreamReq = proto.request(upstreamOpts, (upstreamRes) => {
          const chunks = [];
          upstreamRes.on('data', c => chunks.push(c));
          upstreamRes.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString();
            let parsed = null;
            try {
              parsed = JSON.parse(rawBody);
            } catch (e) { /* not JSON */ }
            settle({
              status: upstreamRes.statusCode,
              body: parsed || rawBody,
              headers: upstreamRes.headers
            });
          });
          upstreamRes.on('error', () => {
            settle({ status: upstreamRes.statusCode, body: null, error: 'Response stream error' });
          });
        });

        upstreamReq.on('error', (err) => {
          settle({ status: 0, body: null, error: err.message });
        });

        const timer = setTimeout(() => {
          try { upstreamReq.destroy(new Error('timeout')); } catch (_) {}
          settle({ status: 0, body: null, error: `Timeout after ${timeoutMs}ms` });
        }, timeoutMs);

        upstreamReq.write(bodyStr);
        upstreamReq.end();
      });

      res.json({
        success: result.status >= 200 && result.status < 300,
        status: result.status,
        response: result.body,
        error: result.error
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- 重启 ----
  api.post('/restart', (req, res) => {
    res.json({ success: true, message: '正在重启...' });
    setTimeout(() => {
      const child = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'inherit', cwd: process.cwd() });
      child.unref();
      process.exit(0);
    }, 300);
  });

  // 登录接口（不需要鉴权）
  const publicApi = express.Router();
  publicApi.use(express.json({ limit: '1mb' }));
  publicApi.post('/login', (req, res) => {
    const { password } = req.body;
    const adminPassword = configManager.getAdminPassword();

    if (!password || password !== adminPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    res.json({ success: true, token: adminPassword });
  });

  app.use('/api', publicApi);
  app.use('/api', api);

  // ========== 代理中间件（仅 OpenAI 兼容路径） ==========
  const proxyPaths = ['/v1/chat/completions', '/chat/completions', '/v1/embeddings', '/embeddings', '/v1/models', '/models', '/v1/responses', '/responses', '/v1/completions', '/completions'];

  // GET /v1/models — 返回配置组 ID 列表（OpenAI 兼容格式），供 AI 工具探测可用模型
  function handleModelsList(req, res) {
    const settings = configManager.getSettings();
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || token !== settings.proxy_key) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid proxy key' }));
    }
    const groups = configManager.getConfig().groups;
    res.json({
      object: 'list',
      data: groups.map((g) => ({ id: g.id, object: 'model', created: 0, owned_by: 'llm-hydra' }))
    });
  }
  const proxyMiddleware = createProxyMiddleware(configManager, circuitBreaker);

  app.use((req, res, next) => {
    const path = req.path.toLowerCase();
    // 检查是否是代理路径
    const isProxyPath = proxyPaths.some(p => path === p || path.startsWith(p + '/'));
    if (isProxyPath) {
      if (req.method === 'POST') {
        return proxyMiddleware(req, res, next);
      }
      // GET 模型列表：返回配置组 ID 列表（OpenAI 兼容），供工具探测可用模型
      if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
        return handleModelsList(req, res);
      }
    }
    next();
  });

  // ========== 静态文件托管 ==========
  const distDir = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(distDir));

  // SPA 回退：非 API、非代理路径返回 index.html
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(distDir, 'index.html'), (err) => {
      if (err) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  });

  // 统一错误处理：任何未捕获异常都返回 JSON，避免前端拿到 HTML 错误页
  app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    if (res.headersSent) return next(err);
    res.status(err.status || err.statusCode || 500).json({ error: err.message || 'Internal Server Error' });
  });

  return app;
}

module.exports = createApp;
