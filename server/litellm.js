// litellm.js — LiteLLM 模型库拉取与缓存
//
// 用途：拉取 LiteLLM 公开的 model_prices_and_context_window.json，原样写入
//       settings.litellm_models。编辑模型时，前端基于这份缓存按 model_id 自动
//       匹配上下文窗口和最大输入/输出 token（仅作为参考值，不影响实际转发）。
//
// 数据源是 JSON 对象：key 为模型名（可能带 provider 前缀，如 openai/gpt-4o、
// deepseek/deepseek-chat），value 含 max_input_tokens（模型的最大输入窗口）、
// max_output_tokens（输出上限）、max_tokens（默认输出上限）等字段。文件较大
// （约 1.5MB），拉取后整体落盘，匹配时由前端本地完成，不过这张表字段只是
// 展示型参考，无任何转发副作用。
//
// 接口是公开的，无需 API key。

const https = require('https');

// GitHub raw 为主，jsDelivr CDN 兜底（部分网络环境下 GitHub 直连不稳定）
const LITELLM_MODELS_URLS = [
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
  'https://cdn.jsdelivr.net/gh/BerriAI/litellm@main/model_prices_and_context_window.json'
];
const FETCH_TIMEOUT_MS = 30000;

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

// 依次尝试多个数据源 URL，全部失败才抛错
async function fetchJsonWithFallback() {
  let lastErr = null;
  for (const url of LITELLM_MODELS_URLS) {
    try {
      return await httpsGetJson(url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(lastErr ? lastErr.message : '拉取失败');
}

// 拉取并写入 configManager（原样落盘）
async function fetchAndCache(configManager) {
  const json = await fetchJsonWithFallback();
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('LiteLLM 返回数据格式异常：应为 JSON 对象');
  }
  const count = Object.keys(json).length;
  const payload = {
    fetched_at: new Date().toISOString(),
    count,
    models: json
  };
  configManager.setLitellmModels(payload);
  return payload;
}

// 读取已缓存的模型库
function getCached(configManager) {
  return configManager.getLitellmModels();
}

module.exports = {
  fetchAndCache,
  getCached
};