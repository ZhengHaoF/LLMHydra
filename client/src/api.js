// api.js — 前端 API 客户端
const BASE = '/api';
const TOKEN_KEY = 'llmhydra_admin_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers
  });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth-expired'));
    throw new Error('Authentication required');
  }

  return res.json();
}

function encodeId(id) {
  return encodeURIComponent(id)
}

export default {
  // 登录
  login: (password) => fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  }).then(res => res.json()),

  // Token 管理
  setToken,
  clearToken,
  getToken,

  // 整体配置
  getConfig: () => request('/config'),

  // 配置组
  addGroup: (id, name) => request('/groups', { method: 'POST', body: JSON.stringify({ id, name }) }),
  updateGroup: (id, patch) => request(`/groups/${encodeId(id)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteGroup: (id) => request(`/groups/${encodeId(id)}`, { method: 'DELETE' }),

  // 模型
  addModel: (model) => request('/models', { method: 'POST', body: JSON.stringify(model) }),
  updateModel: (id, model) => request(`/models/${encodeId(id)}`, { method: 'PUT', body: JSON.stringify(model) }),
  deleteModel: (id) => request(`/models/${encodeId(id)}`, { method: 'DELETE' }),

  // 配置
  setPort: (port) => request('/config/port', { method: 'PUT', body: JSON.stringify({ port }) }),

  // 重启
  restart: () => request('/restart', { method: 'POST' }),

  // 日志
  getLogs: () => request('/logs'),
  clearLogs: () => request('/logs', { method: 'DELETE' }),

  // 统计
  getStatsOverview: () => request('/stats/overview'),
  getStatsModels: () => request('/stats/models'),
  getStatsGroups: () => request('/stats/groups'),
  getStatsRecent: (limit = 100) => request(`/stats/recent?limit=${limit}`),
  getStatsDaily: (days = 30) => request(`/stats/daily?days=${days}`),
  getStatsHourly: (hours = 24) => request(`/stats/hourly?hours=${hours}`),
  clearStats: () => request('/stats', { method: 'DELETE' }),

  // 设置
  getSettings: () => request('/settings'),
  updateSettings: (settings) => request('/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  // 代理密钥
  getProxyKey: () => request('/proxy-key'),
  regenerateProxyKey: () => request('/proxy-key/regenerate', { method: 'POST' }),

  // 测试模型端点
  testModel: (data) => request('/models/test', { method: 'POST', body: JSON.stringify(data) }),

  // OpenRouter 模型库
  getOpenRouterModels: () => request('/openrouter/models'),
  refreshOpenRouterModels: () => request('/openrouter/refresh', { method: 'POST' }),
  matchOpenRouterModel: (modelId) => request(`/openrouter/match?model_id=${encodeURIComponent(modelId)}`),
}
