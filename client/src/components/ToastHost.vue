<template>
  <Teleport to="body">
    <div class="toast-host" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="t in items" :key="t.id" class="toast-item" :class="'toast-' + t.type">
          <span class="toast-dot" aria-hidden="true"></span>
          <span class="toast-msg">{{ t.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const MAX_ITEMS = 4
const items = ref([])
let seq = 0

function push(detail) {
  const id = ++seq
  const duration = detail.duration || 2600
  items.value = [...items.value, { id, message: detail.message, type: detail.type || 'error' }]
  // 堆太多时丢掉最老的，避免把界面糊住
  if (items.value.length > MAX_ITEMS) items.value = items.value.slice(-MAX_ITEMS)
  setTimeout(() => remove(id), duration)
}

function remove(id) {
  items.value = items.value.filter((t) => t.id !== id)
}

function onToast(e) {
  if (e.detail && e.detail.message) push(e.detail)
}

onMounted(() => window.addEventListener('app-toast', onToast))
onUnmounted(() => window.removeEventListener('app-toast', onToast))
</script>

<style scoped>
.toast-host {
  position: fixed;
  top: 68px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast-item {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 520px;
  padding: 9px 16px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  color: #fff;
  background: #f56c6c;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  pointer-events: auto;
}
.toast-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  flex-shrink: 0;
}
.toast-msg {
  word-break: break-word;
}
.toast-success { background: #67c23a; }
.toast-info { background: #409eff; }
.toast-warn { background: #e6a23c; }

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
