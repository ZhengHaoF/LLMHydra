// circuit-breaker.js — 可配置的熔断器实现

const DEFAULT_THRESHOLD = 3;
const DEFAULT_DURATION_MS = 5 * 60 * 1000;

class CircuitBreaker {
  constructor(opts = {}) {
    this.states = new Map(); // modelId → { failureCount, circuitOpenUntil }
    this.threshold = opts.threshold || DEFAULT_THRESHOLD;
    this.durationMs = opts.durationMs || DEFAULT_DURATION_MS;
  }

  /** 更新配置（热更新） */
  updateConfig(opts = {}) {
    if (opts.threshold !== undefined && opts.threshold >= 1) {
      this.threshold = opts.threshold;
    }
    if (opts.durationMs !== undefined && opts.durationMs >= 60000) {
      this.durationMs = opts.durationMs;
    }
  }

  /** 判断模型是否可用（未熔断） */
  isAvailable(modelId) {
    const state = this.states.get(modelId);
    if (!state) return true;
    if (state.circuitOpenUntil && Date.now() < state.circuitOpenUntil) return false;
    // 熔断期已过，进入半开状态，允许一次试探
    return true;
  }

  /** 记录成功 → 重置状态 */
  recordSuccess(modelId) {
    this.states.delete(modelId);
  }

  /** 记录失败 → 计数，达到阈值则熔断 */
  recordFailure(modelId) {
    let state = this.states.get(modelId);
    if (!state) {
      state = { failureCount: 0, circuitOpenUntil: null };
      this.states.set(modelId, state);
    }
    state.failureCount++;
    if (state.failureCount >= this.threshold) {
      state.circuitOpenUntil = Date.now() + this.durationMs;
    }
  }

  /** 获取所有熔断状态（用于调试/日志） */
  getStatus() {
    const result = {};
    for (const [id, state] of this.states) {
      result[id] = {
        failureCount: state.failureCount,
        threshold: this.threshold,
        circuitOpen: state.circuitOpenUntil ? Date.now() < state.circuitOpenUntil : false,
        circuitOpenUntil: state.circuitOpenUntil ? new Date(state.circuitOpenUntil).toISOString() : null
      };
    }
    return result;
  }
}

module.exports = CircuitBreaker;
