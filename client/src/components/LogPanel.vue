<template>
  <div class="log-panel" :class="{ collapsed }">
    <div class="log-header">
      <div class="log-title">
        <span class="log-icon"><IconClipboardText :size="15" /></span>
        <span v-if="!collapsed" class="log-label">运行日志</span>
        <span v-if="!collapsed && logs.length > 0" class="log-count">{{ logs.length }}</span>
      </div>
      <div class="log-actions">
        <button v-if="!collapsed" class="log-btn log-btn-clear" @click="confirmClear" title="清空日志">
          <IconTrash :size="14" />
        </button>
        <button class="log-btn log-btn-toggle" @click="$emit('toggle')" :title="collapsed ? '展开日志' : '折叠日志'">
          <IconChevronRight v-if="collapsed" :size="12" />
          <IconChevronLeft v-else :size="12" />
        </button>
      </div>
    </div>

    <div v-if="!collapsed" class="log-body">
      <div ref="logListRef" class="log-list">
        <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
        <div v-for="(log, idx) in logs" :key="log.ts + '-' + idx" class="log-item" :class="'log-' + log.level">
          <span class="log-time">{{ log.time }}</span>
          <span class="log-msg">{{ log.message }}</span>
        </div>
      </div>
    </div>

    <!-- 确认清空弹窗 -->
    <Teleport to="body">
      <div v-if="showConfirm" class="confirm-overlay" @click.self="showConfirm = false">
        <div class="confirm-box">
          <div class="confirm-title">确认清空</div>
          <div class="confirm-body">
            确定要清空所有日志吗?<br>
            <span style="color:#e6a23c;font-size:12px">此操作不可恢复。</span>
          </div>
          <div class="confirm-actions">
            <button class="btn-cancel" @click="showConfirm = false">取消</button>
            <button class="btn-danger" @click="doClear">确认清空</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import api from '../api.js'
import { IconClipboardText, IconTrash, IconChevronRight, IconChevronLeft } from '@tabler/icons-vue'

const props = defineProps({
  collapsed: { type: Boolean, default: false }
})

const emit = defineEmits(['toggle', 'clear'])

const logs = ref([])
const logListRef = ref(null)
const showConfirm = ref(false)
const MAX_LOGS = 500
let eventSource = null
let userScrolled = false

// 加载历史日志
async function loadLogs() {
  try {
    const data = await api.getLogs()
    logs.value = data.logs || []
    await nextTick()
    scrollToBottom()
  } catch (e) {
    console.error('加载日志失败:', e)
  }
}

// 建立 SSE 连接
function connectSSE() {
  if (eventSource) eventSource.close()

  eventSource = new EventSource('/api/logs/stream')

  eventSource.onmessage = (e) => {
    try {
      const entry = JSON.parse(e.data)
      if (entry.type !== 'log') return
      logs.value.push(entry)
      if (logs.value.length > MAX_LOGS) logs.value.shift()
      if (!userScrolled) {
        nextTick(() => scrollToBottom())
      }
    } catch (err) {
      console.error('解析日志失败:', err)
    }
  }

  eventSource.onerror = () => {
    console.warn('SSE 连接断开，将自动重连')
  }
}

// 滚动到底部
function scrollToBottom() {
  if (logListRef.value) {
    logListRef.value.scrollTop = logListRef.value.scrollHeight
  }
}

// 监听滚动，判断用户是否手动上滚
function onScroll() {
  if (!logListRef.value) return
  const el = logListRef.value
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  userScrolled = !atBottom
}

// 确认清空
function confirmClear() {
  showConfirm.value = true
}

// 执行清空
async function doClear() {
  try {
    await api.clearLogs()
    logs.value = []
    showConfirm.value = false
    emit('clear')
  } catch (e) {
    console.error('清空日志失败:', e)
  }
}

onMounted(() => {
  loadLogs()
  connectSSE()
  if (logListRef.value) {
    logListRef.value.addEventListener('scroll', onScroll)
  }
})

onUnmounted(() => {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  if (logListRef.value) {
    logListRef.value.removeEventListener('scroll', onScroll)
  }
})
</script>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  background: #fff;
  border-left: 1px solid #e4e7ed;
  transition: width 0.25s ease;
  overflow: hidden;
  min-height: 0;
}

.log-panel.collapsed {
  width: 36px;
}

.log-panel:not(.collapsed) {
  width: 340px;
}

.log-panel.collapsed .log-header {
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  padding: 8px 0;
  border-bottom: none;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}

.log-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.log-icon {
  font-size: 14px;
}

.log-label {
  white-space: nowrap;
}

.log-count {
  background: #409eff;
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 500;
}

.log-actions {
  display: flex;
  gap: 4px;
}

.log-btn {
  background: none;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.log-btn:hover {
  background: #e4e7ed;
}

.log-btn-clear:hover {
  background: #fef0f0;
  color: #f56c6c;
}

.log-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.log-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.6;
}

.log-empty {
  text-align: center;
  color: #909399;
  padding: 32px 0;
  font-size: 13px;
}

.log-item {
  padding: 4px 8px;
  border-radius: 3px;
  margin-bottom: 2px;
  display: flex;
  gap: 8px;
  word-break: break-all;
}

.log-time {
  color: #909399;
  flex-shrink: 0;
  font-size: 11px;
}

.log-msg {
  flex: 1;
}

.log-info {
  background: transparent;
  color: #606266;
}

.log-success {
  background: #f0f9ff;
  color: #67c23a;
}

.log-warn {
  background: #fff7e6;
  color: #e6a23c;
}

.log-error {
  background: #fef0f0;
  color: #f56c6c;
}

/* 确认弹窗 */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.confirm-box {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  min-width: 340px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.confirm-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
}

.confirm-body {
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
  margin-bottom: 20px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-cancel {
  padding: 7px 20px;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
  background: #fff;
  color: #606266;
  cursor: pointer;
  font-size: 13px;
}

.btn-cancel:hover {
  color: #409eff;
  border-color: #c6e2ff;
}

.btn-danger {
  padding: 8px 20px;
  border-radius: 6px;
  border: none;
  background: #f56c6c;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
}

.btn-danger:hover {
  background: #f78989;
}

/* 滚动条样式 */
.log-list::-webkit-scrollbar {
  width: 6px;
}

.log-list::-webkit-scrollbar-track {
  background: #f5f7fa;
}

.log-list::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 3px;
}

.log-list::-webkit-scrollbar-thumb:hover {
  background: #909399;
}
</style>
