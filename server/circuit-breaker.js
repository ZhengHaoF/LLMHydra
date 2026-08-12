// circuit-breaker.js — 简单的熔断器实现

const FAILURE_THRESHOLD = 3;        // 连续失败多少次后熔断
const CIRCUIT_OPEN_DURATION = 5 * 60 * 1000; // 熔断持续 5 分钟

class CircuitBreaker {
  constructor() {
    this.states = new Map(); // modelId → { failureCount, circuitOpenUntil }
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
    if (state.failureCount >= FAILURE_THRESHOLD) {
      state.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_DURATION;
    }
  }

  /** 获取所有熔断状态（用于调试/日志） */
  getStatus() {
    const result = {};
    for (const [id, state] of this.states) {
      result[id] = {
        failureCount: state.failureCount,
        circuitOpen: state.circuitOpenUntil ? Date.now() < state.circuitOpenUntil : false,
        circuitOpenUntil: state.circuitOpenUntil ? new Date(state.circuitOpenUntil).toISOString() : null
      };
    }
    return result;
  }
}

module.exports = CircuitBreaker;
