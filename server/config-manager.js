// config-manager.js — 配置文件读写
// 数据结构：
// {
//   port: 8093,
//   groups: [
//     { id: "deepseek-v4", name: "DeepSeek-V4 主用组", chain: ["m_xxx", "m_yyy"] }
//   ],
//   models: [
//     {
//       id: "m_xxx",
//       display_name: "DeepSeek 官方",
//       endpoint: { url: "https://...", api_key: "sk-..." },
//       thinking_enabled: true,
//       effort: "max",
//       ssl_verify: true,
//       endpoint_timeout: 30
//     }
//   ]
// }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, '..', 'proxy_config.json');

const DEFAULT_SETTINGS = {
  circuit_breaker_threshold: 3,
  circuit_breaker_duration_min: 5
};

function generateProxyKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

const DEFAULT_CONFIG = {
  port: 8093,
  settings: { ...DEFAULT_SETTINGS },
  groups: [],
  models: []
};

// group id 校验：仅允许中英文、数字、-
const GROUP_ID_REGEX = /^[a-zA-Z0-9\u4e00-\u9fa5-]+$/;

function isValidGroupId(id) {
  return typeof id === 'string' && id.length > 0 && GROUP_ID_REGEX.test(id);
}

function genId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function normalizeModel(m) {
  const out = { ...m };
  if (!out.id) out.id = genId('m');
  out.display_name = out.display_name || out.name || 'New Model';
  out.model_id = out.model_id || '';
  if (!out.endpoint || !out.endpoint.url) {
    if (out.upstream) {
      out.endpoint = { url: out.upstream, api_key: out.api_key || '' };
    } else if (Array.isArray(out.endpoints) && out.endpoints.length > 0) {
      out.endpoint = { url: out.endpoints[0].url, api_key: out.endpoints[0].api_key || '' };
    } else {
      out.endpoint = { url: '', api_key: '' };
    }
  } else {
    out.endpoint = {
      url: out.endpoint.url || '',
      api_key: out.endpoint.api_key !== undefined ? out.endpoint.api_key : ''
    };
  }
  // 删除不再使用的字段
  delete out.endpoints;
  delete out.upstream;
  delete out.api_key;
  delete out.name;
  if (out.thinking_enabled === undefined) out.thinking_enabled = true;
  if (!out.effort) out.effort = 'medium';
  if (out.ssl_verify === undefined) out.ssl_verify = true;
  if (out.endpoint_timeout === undefined) out.endpoint_timeout = 30;
  return out;
}

function normalizeGroup(g) {
  const out = { ...g };
  // group 必填 id（用户可自定义，也作为对外调用名）
  if (!out.id) out.id = genId('g');
  out.name = out.name || out.id;
  if (!Array.isArray(out.chain)) out.chain = [];
  return out;
}

function normalizeSettings(s) {
  return {
    circuit_breaker_threshold: (s && typeof s.circuit_breaker_threshold === 'number' && s.circuit_breaker_threshold >= 1)
      ? s.circuit_breaker_threshold : DEFAULT_SETTINGS.circuit_breaker_threshold,
    circuit_breaker_duration_min: (s && typeof s.circuit_breaker_duration_min === 'number' && s.circuit_breaker_duration_min >= 1)
      ? s.circuit_breaker_duration_min : DEFAULT_SETTINGS.circuit_breaker_duration_min,
    proxy_key: (s && typeof s.proxy_key === 'string') ? s.proxy_key : ''
  };
}

class ConfigManager {
  constructor() {
    this._config = null;
  }

  _ensureConfig() {
    if (this._config) return;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this._config = {
          port: parsed.port || 8093,
          settings: normalizeSettings(parsed.settings),
          groups: Array.isArray(parsed.groups) ? parsed.groups.map(normalizeGroup) : [],
          models: Array.isArray(parsed.models) ? parsed.models.map(normalizeModel) : []
        };
        // 如果没有 proxy_key，自动生成
        if (!this._config.settings.proxy_key) {
          this._config.settings.proxy_key = generateProxyKey();
          this.save();
        }
        this.save();
      } else {
        this._config = { ...DEFAULT_CONFIG };
        this._config.settings.proxy_key = generateProxyKey();
        this.save();
      }
    } catch (e) {
      this._config = { ...DEFAULT_CONFIG };
      this._config.settings.proxy_key = generateProxyKey();
    }
    return this._config;
  }

  save() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this._config, null, 2), 'utf-8');
  }

  getConfig() {
    this._ensureConfig();
    return this._config;
  }

  // ---- group 查找 ----

  // 根据 group id 找到 group 对象（不传则返回 null）
  getGroupById(id) {
    this._ensureConfig();
    if (!id) return null;
    return this._config.groups.find((g) => g.id === id) || null;
  }

  // 根据 group 取 chain 中所有模型对象（按顺序，过滤不存在的）
  getGroupModels(group) {
    this._ensureConfig();
    if (!group) return [];
    const modelMap = new Map(this._config.models.map((m) => [m.id, m]));
    return group.chain
      .map((id) => modelMap.get(id))
      .filter((m) => m && m.endpoint && m.endpoint.url);
  }

  isGroupIdTaken(id, excludeIndex = -1) {
    this._ensureConfig();
    return this._config.groups.some((g, idx) => g.id === id && idx !== excludeIndex);
  }

  // ---- 配置组 CRUD ----

  addGroup(id, name) {
    this._ensureConfig();
    if (!isValidGroupId(id)) {
      throw new Error('配置组 ID 仅允许中英文、数字和 -');
    }
    if (this.isGroupIdTaken(id)) {
      throw new Error(`配置组 ID "${id}" 已存在`);
    }
    const g = normalizeGroup({ id, name: name || id, chain: [] });
    this._config.groups.push(g);
    this.save();
    return g;
  }

  updateGroup(id, patch) {
    this._ensureConfig();
    const idx = this._config.groups.findIndex((g) => g.id === id);
    if (idx < 0) return false;
    if (patch.name !== undefined) this._config.groups[idx].name = patch.name;
    if (patch.chain !== undefined && Array.isArray(patch.chain)) {
      const validIds = new Set(this._config.models.map((m) => m.id));
      this._config.groups[idx].chain = patch.chain.filter((mid) => validIds.has(mid));
    }
    this.save();
    return true;
  }

  deleteGroup(id) {
    this._ensureConfig();
    const idx = this._config.groups.findIndex((g) => g.id === id);
    if (idx < 0) return false;
    this._config.groups.splice(idx, 1);
    this.save();
    return true;
  }

  // ---- 模型 CRUD ----

  getModels() {
    this._ensureConfig();
    return this._config.models;
  }

  addModel(model) {
    this._ensureConfig();
    const m = normalizeModel({
      display_name: model.display_name || model.name,
      model_id: model.model_id,
      endpoint: model.endpoint,
      thinking_enabled: model.thinking_enabled,
      effort: model.effort,
      ssl_verify: model.ssl_verify,
      endpoint_timeout: model.endpoint_timeout
    });
    this._config.models.push(m);
    this.save();
    return m;
  }

  updateModel(id, model) {
    this._ensureConfig();
    const idx = this._config.models.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    const existing = this._config.models[idx];
    if (model.display_name !== undefined) existing.display_name = model.display_name;
    if (model.model_id !== undefined) existing.model_id = model.model_id;
    if (model.thinking_enabled !== undefined) existing.thinking_enabled = model.thinking_enabled;
    if (model.effort !== undefined) existing.effort = model.effort;
    if (model.ssl_verify !== undefined) existing.ssl_verify = model.ssl_verify;
    if (model.endpoint_timeout !== undefined) existing.endpoint_timeout = model.endpoint_timeout;
    if (model.endpoint !== undefined && model.endpoint) {
      existing.endpoint = {
        url: model.endpoint.url || '',
        api_key: model.endpoint.api_key !== undefined ? model.endpoint.api_key : ''
      };
    }
    this.save();
    return true;
  }

  deleteModel(id) {
    this._ensureConfig();
    const idx = this._config.models.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    this._config.models.splice(idx, 1);
    // 从所有 group 的 chain 中移除
    for (const g of this._config.groups) {
      g.chain = g.chain.filter((mid) => mid !== id);
    }
    this.save();
    return true;
  }

  // ---- 端口 ----

  setPort(port) {
    this._ensureConfig();
    this._config.port = port;
    this.save();
  }

  // ---- 设置 ----

  getSettings() {
    this._ensureConfig();
    return this._config.settings;
  }

  updateSettings(patch) {
    this._ensureConfig();
    const s = this._config.settings;
    if (patch.circuit_breaker_threshold !== undefined) {
      const v = parseInt(patch.circuit_breaker_threshold);
      if (v >= 1 && v <= 100) s.circuit_breaker_threshold = v;
    }
    if (patch.circuit_breaker_duration_min !== undefined) {
      const v = parseInt(patch.circuit_breaker_duration_min);
      if (v >= 1 && v <= 1440) s.circuit_breaker_duration_min = v;
    }
    this.save();
    return s;
  }

  getProxyKey() {
    this._ensureConfig();
    return this._config.settings.proxy_key;
  }

  regenerateProxyKey() {
    this._ensureConfig();
    this._config.settings.proxy_key = generateProxyKey();
    this.save();
    return this._config.settings.proxy_key;
  }
}

module.exports = ConfigManager;
module.exports.isValidGroupId = isValidGroupId;
