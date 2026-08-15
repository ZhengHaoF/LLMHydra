// openrouter.js — OpenRouter 模型库拉取与本地匹配
//
// 用途：拉取 OpenRouter 公开的 /api/v1/models，精简后写入 settings.openrouter_models，
//       编辑模型时根据 model_id 自动匹配上下文窗口和最大输入/输出 token（参考值）。
//
// 字段映射：
//   context_length                          -> context_length
//   top_provider.max_completion_tokens      -> max_output_tokens
//   context_length - max_completion_tokens  -> max_input_tokens（参考）
//
// 拉取接口是公开的，无需 API key。

const https = require('https');

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const FETCH_TIMEOUT_MS = 15000;

function httpsGetJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error(`响应不是合法 JSON: ${e.message}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('请求超时'));
    });
    req.on('error', (err) => reject(err));
  });
}

// 精简拉取到的模型数据，只保留匹配所需字段
function slimModel(m) {
  if (!m || typeof m.id !== 'string' || !m.id) return null;
  const contextLength = typeof m.context_length === 'number' ? m.context_length : null;
  const topProvider = m.top_provider || {};
  const maxCompletion = typeof topProvider.max_completion_tokens === 'number'
    ? topProvider.max_completion_tokens
    : null;
  return {
    id: m.id,
    name: typeof m.name === 'string' ? m.name : m.id,
    context_length: contextLength,
    max_output_tokens: maxCompletion
    // max_input_tokens 由 context_length - max_output_tokens 在匹配时实时算出
  };
}

// 拉取并写入 configManager
async function fetchAndCache(configManager) {
  const json = await httpsGetJson(OPENROUTER_MODELS_URL);
  if (!json || !Array.isArray(json.data)) {
    throw new Error('OpenRouter 返回数据格式异常：缺少 data 数组');
  }
  const slimmed = json.data
    .map(slimModel)
    .filter((x) => x && x.context_length !== null);
  const payload = {
    fetched_at: new Date().toISOString(),
    count: slimmed.length,
    models: slimmed
  };
  configManager.setOpenRouterModels(payload);
  return payload;
}

// 读取已缓存的模型库
function getCached(configManager) {
  return configManager.getOpenRouterModels();
}

// 根据 model_id 在已缓存列表中查找匹配项
// 匹配策略：先精确（lowercase），再模糊（去除可能的厂商前缀，如 "openai/"）
function matchById(configManager, modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  const cached = configManager.getOpenRouterModels();
  if (!cached || !Array.isArray(cached.models) || cached.models.length === 0) return null;
  const list = cached.models;
  const target = modelId.trim().toLowerCase();

  // 1) 精确匹配
  let hit = list.find((m) => m.id.toLowerCase() === target);
  if (hit) return toMatchResult(hit);

  // 2) 模糊匹配：忽略大小写，去掉厂商前缀再比
  //    例如 "gpt-4o" -> 找 "openai/gpt-4o" / "openai/gpt-4o-2024-..."
  //    这里取第一个 id 以 target 结尾的项
  const suffixes = list
    .map((m) => ({ m, idLower: m.id.toLowerCase() }))
    .filter((x) => x.idLower.endsWith('/' + target) || x.idLower === target);
  if (suffixes.length > 0) {
    // 如果有多条匹配（例如 "gpt-4o" 命中 "openai/gpt-4o" 和 "openai/gpt-4o-mini"），
    // 取 id 完全等于 "<vendor>/<target>" 的那条，否则取最短 id（更精确）
    suffixes.sort((a, b) => a.m.id.length - b.m.id.length);
    hit = suffixes[0].m;
    return toMatchResult(hit);
  }

  return null;
}

function toMatchResult(m) {
  const context = m.context_length;
  const output = m.max_output_tokens;
  let input = null;
  if (context !== null && context !== undefined && output !== null && output !== undefined) {
    const v = context - output;
    input = v > 0 ? v : null;
  }
  return {
    id: m.id,
    name: m.name,
    context_length: context,
    max_output_tokens: output,
    max_input_tokens: input
  };
}

module.exports = {
  fetchAndCache,
  getCached,
  matchById
};
