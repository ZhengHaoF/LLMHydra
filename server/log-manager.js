// log-manager.js — 内存日志缓冲 + SSE 订阅广播
// 不落库：日志量大且重启可清空，内存环形缓冲最合适，避免拖慢代理主流程

const MAX_BUFFER = 1000;

class LogManager {
  constructor() {
    this.buffer = [];                 // 环形缓冲
    this.subscribers = new Set();     // SSE 客户端响应对象
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

  // 追加一条日志并广播给所有订阅者
  append(message) {
    const entry = {
      type: 'log',
      ts: Date.now(),
      time: new Date().toISOString().slice(11, 19),
      level: this.parseLevel(message),
      message
    };
    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();

    this.broadcast(entry);
  }

  // 广播任意类型事件给所有订阅者（如统计更新）
  broadcast(entry) {
    const line = `data: ${JSON.stringify(entry)}\n\n`;
    for (const res of this.subscribers) {
      try { res.write(line); } catch (_) { /* 单个客户端写失败忽略 */ }
    }
  }

  // 获取历史缓冲（副本）
  getRecent() {
    return [...this.buffer];
  }

  // 清空缓冲
  clear() {
    this.buffer = [];
  }

  // 订阅实时日志；返回取消订阅函数
  subscribe(res) {
    this.subscribers.add(res);
    return () => this.subscribers.delete(res);
  }
}

module.exports = new LogManager();
