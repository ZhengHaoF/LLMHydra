// log-manager.js — 按配置组分组的内存日志缓冲 + SSE 订阅广播
// 不落库：日志量大且重启可清空，内存环形缓冲最合适，避免拖慢代理主流程
// 每个配置组（含系统日志）独立缓冲、独立容量，互不挤占

const MAX_BUFFER = 1000;
const SYSTEM_KEY = '__system__';

class LogManager {
  constructor() {
    this.buffers = new Map();            // groupId -> entry[]，每组独立环形缓冲
    this.buffers.set(SYSTEM_KEY, []);    // 系统日志（非请求上下文）单独一组
    this.subscribers = new Set();         // SSE 客户端响应对象
  }

  // 从日志消息前缀解析级别
  // [OK] success / [FAIL] [ALL-FAIL] [ERROR] error / [SKIP] warn / 其余 info
  parseLevel(msg) {
    if (typeof msg !== 'string') return 'info';
    if (/\[OK\]/.test(msg)) return 'success';
    if (/\[FAIL\]|\[ALL-FAIL\]|\[ERROR\]/.test(msg)) return 'error';
    if (/\[SKIP\]/.test(msg)) return 'warn';
    return 'info';
  }

  // 追加一条日志到指定配置组的缓冲，并广播给所有订阅者
  // groupId 不传或为空时归系统日志；组缓冲不存在时兜底进系统（处理在途请求撞上删组）
  append(message, groupId) {
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date());

    let group = groupId || SYSTEM_KEY;
    let buf = this.buffers.get(group);
    if (!buf) {
      // 目标组缓冲不存在（如组已被删除但在途请求仍在写日志），兜底进系统
      group = SYSTEM_KEY;
      buf = this.buffers.get(SYSTEM_KEY);
    }

    const entry = {
      type: 'log',
      ts: Date.now(),
      time,
      level: this.parseLevel(message),
      message,
      group
    };
    buf.push(entry);
    if (buf.length > MAX_BUFFER) buf.shift();

    this.broadcast(entry);
  }

  // 广播任意类型事件给所有订阅者（如统计更新）
  broadcast(entry) {
    const line = `data: ${JSON.stringify(entry)}\n\n`;
    for (const res of this.subscribers) {
      try { res.write(line); } catch (_) { /* 单个客户端写失败忽略 */ }
    }
  }

  // 获取指定组的历史缓冲（副本）；不传 groupId 返回系统日志
  getRecent(groupId) {
    const group = groupId || SYSTEM_KEY;
    const buf = this.buffers.get(group);
    return buf ? [...buf] : [];
  }

  // 清空指定组的缓冲；不传 groupId 清空系统日志
  clear(groupId) {
    const group = groupId || SYSTEM_KEY;
    if (this.buffers.has(group)) {
      this.buffers.set(group, []);
    }
  }

  // 配置组生命周期：新增组时创建空缓冲
  ensureGroup(id) {
    if (id && !this.buffers.has(id)) {
      this.buffers.set(id, []);
    }
  }

  // 配置组生命周期：删除组时连同缓冲一起删除（完全隔离、无残留）
  removeGroup(id) {
    if (id) this.buffers.delete(id);
  }

  // 订阅实时日志；返回取消订阅函数
  subscribe(res) {
    this.subscribers.add(res);
    return () => this.subscribers.delete(res);
  }
}

const instance = new LogManager();
module.exports = instance;
module.exports.SYSTEM_KEY = SYSTEM_KEY;
