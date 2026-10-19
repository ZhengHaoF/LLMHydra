// ui.js — 全局轻提示 + 统一的「进行中」状态
import { ref } from 'vue'

// 全局轻提示：任意组件调用 notify() 即可，由 ToastHost.vue 统一渲染。
// 通过 window 事件解耦，避免各组件各自维护一份 toast 状态。
export function notify(message, type = 'error', duration = 2600) {
  if (!message) return
  window.dispatchEvent(new CustomEvent('app-toast', {
    detail: { message, type, duration }
  }))
}

// 从异常里取出可读文案。api.js 已经会把服务端的 error 字段塞进 message，
// 这里只兜掉浏览器原生的网络错误，避免把 "Failed to fetch" 直接抛给用户。
export function errMsg(e, fallback = '操作失败') {
  const m = e && e.message
  if (!m || m === 'Failed to fetch' || m === 'Load failed') return fallback
  return m
}

// 统一的「进行中」包装：
//   pending 用于禁用按钮 / 显示转圈，run 包住异步逻辑并保证 finally 收敛。
//   重复进入时直接忽略，作为防连点的最后一道保险（按钮 disabled 依赖渲染时机）。
export function usePending() {
  const pending = ref(false)
  async function run(fn) {
    if (pending.value) return undefined
    pending.value = true
    try {
      return await fn()
    } finally {
      pending.value = false
    }
  }
  return { pending, run }
}
