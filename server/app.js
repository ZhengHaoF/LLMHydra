// app.js — 单端口 Express：管理 API (/api/*) + HTTP 代理 (/*)

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { spawn } = require('child_process');
const { isValidGroupId } = require('./config-manager');
const CircuitBreaker = require('./circuit-breaker');
const statsManager = require('./stats-manager');

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ---- 工具 ----

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function transformDeltaContent(delta) {
  let count = 0;
  if (delta.content && Array.isArray(delta.content)) {
    const nc = [];
    for (const block of delta.content) {
      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        nc.push({ type: 'text', text: block.thinking || block.data || '' });
        count++;
      } else {
        nc.push(block);
      }
    }
    delta.content = nc;
    return { count, delta };
  }
  if (delta.reasoning_content) {
    const r = delta.reasoning_content;
    delete delta.reasoning_content;
    delta.content = (delta.content || '') + r;
    count++;
    return { count, delta };
  }
  return null;
}

function transformMessageContent(message) {
  let count = 0;
  if (message.content && Array.isArray(message.content)) {
    const nc = [];
    for (const block of message.content) {
      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        nc.push({ type: 'text', text: block.thinking || block.data || '' });
        count++;
      } else {
        nc.push(block);
      }
    }
    message.content = nc;
    return { count, message };
  }
  return null;
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
            retryable: status === 401 || status === 403,
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

    // 读 body 取 model 字段
    let rawBody;
    try {
      rawBody = await readBody(req);
    } catch (err) {
      log(`[ERROR] 读取请求体失败: ${err.message}`);
      res.writeHead(500);
      return res.end('Failed to read request body');
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
        statsManager.recordRequest({
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
      const upstreamUrl = new URL(model.endpoint.url);
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
        statsManager.recordRequest({
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
      if (!result.retryable) {
        log(`[FAIL]  model #${i + 1} (${model.display_name}) ${result.statusCode || ''} ${result.reason || ''} — not retryable, abort.`);
        const headers = { 'Content-Type': 'application/json' };
        res.writeHead(result.statusCode || 502, headers);
        let payload;
        try {
          payload = result.body ? JSON.parse(result.body) : { error: result.reason || 'upstream 4xx' };
        } catch {
          payload = { error: result.body || result.reason || 'upstream 4xx' };
        }
        res.end(JSON.stringify(payload));
        statsManager.recordRequest({
          group_id: groupId,
          model_id: model.id,
          model_display: model.display_name,
          path: pathNoQuery,
          status: 'failure',
          status_code: result.statusCode,
          latency_ms: latency,
          error: result.reason || `HTTP ${result.statusCode}`
        });
        return;
      }

      circuitBreaker.recordFailure(model.id);
      log(`[FAIL]  model #${i + 1} (${model.display_name}) ${result.statusCode || ''} ${result.reason || ''} — try next.`);
      statsManager.recordRequest({
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
      upstreamRes.pipe(clientRes);
      upstreamRes.on('end', () => resolve({ usage: null }));
      upstreamRes.on('error', () => {
        if (!clientRes.writableEnded) clientRes.end();
        resolve({ usage: null, error: true });
      });
    });
  }
}

function handleSSE(upstreamRes, clientRes) {
  return new Promise((resolve) => {
    let buffer = '';
    let lastUsage = null;

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
              for (const choice of data.choices) {
                if (choice.delta) {
                  const r = transformDeltaContent(choice.delta);
                  if (r) choice.delta = r.delta;
                }
              }
              output = 'data: ' + JSON.stringify(data);
            }
          } catch (e) { /* pass through */ }
        }
        clientRes.write(output + '\n');
      }
    });

    upstreamRes.on('end', () => {
      if (buffer) {
        const line = buffer.trim();
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.usage) lastUsage = data.usage;
            if (data.choices && Array.isArray(data.choices)) {
              for (const choice of data.choices) {
                if (choice.delta) {
                  const r = transformDeltaContent(choice.delta);
                  if (r) choice.delta = r.delta;
                }
              }
            }
            clientRes.write('data: ' + JSON.stringify(data) + '\n');
          } catch (e) { clientRes.write(line + '\n'); }
        } else if (line) {
          clientRes.write(line + '\n');
        }
      }
      clientRes.end();
      resolve({ usage: lastUsage });
    });

    upstreamRes.on('error', () => {
      if (!clientRes.writableEnded) clientRes.end();
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
          for (const choice of data.choices) {
            if (choice.message) {
              const r = transformMessageContent(choice.message);
              if (r) choice.message = r.message;
            }
          }
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
  app.use(cors());

  const circuitBreaker = new CircuitBreaker({
    threshold: configManager.getSettings().circuit_breaker_threshold,
    durationMs: configManager.getSettings().circuit_breaker_duration_min * 60 * 1000
  });

  const api = express.Router();
  api.use(express.json());

  // 整体配置
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

  // ---- 测试模型端点 ----
  api.post('/models/test', async (req, res) => {
    const { endpoint, model_id, thinking_enabled, effort, ssl_verify, endpoint_timeout } = req.body;

    if (!endpoint || !endpoint.url) {
      return res.status(400).json({ error: '缺少端点 URL' });
    }
    if (!model_id) {
      return res.status(400).json({ error: '缺少模型 ID' });
    }

    const upstreamUrl = new URL(endpoint.url);
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

  app.use('/api', api);

  // ========== 代理中间件 ==========
  app.use(createProxyMiddleware(configManager, circuitBreaker));

  return app;
}

module.exports = createApp;
