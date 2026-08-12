// api.js — 前端 API 客户端
const BASE = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  return res.json();
}

function encodeId(id) {
  return encodeURIComponent(id)
}

export default {
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

  // 统计
  getStatsOverview: () => request('/stats/overview'),
  getStatsModels: () => request('/stats/models'),
  getStatsGroups: () => request('/stats/groups'),
  getStatsRecent: (limit = 100) => request(`/stats/recent?limit=${limit}`),
  getStatsDaily: (days = 30) => request(`/stats/daily?days=${days}`),
  clearStats: () => request('/stats', { method: 'DELETE' }),

  // 设置
  getSettings: () => request('/settings'),
  updateSettings: (settings) => request('/settings', { method: 'PUT', body: JSON.stringify(settings) }),
}
