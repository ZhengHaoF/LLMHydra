<template>
  <div class="log-panel" :class="{ collapsed }">
    <div class="log-header">
      <div class="log-title">
        <span class="log-icon"><IconClipboardText :size="15" /></span>
        <span v-if="!collapsed" class="log-label">运行日志</span>
        <span v-if="!collapsed && currentLogs.length > 0" class="log-count">{{ currentLogs.length }}</span>
      </div>
      <div class="log-actions">
        <button v-if="!collapsed" class="log-btn log-btn-clear" @click="confirmClear" title="清空当前组日志">
          <IconTrash :size="14" />
        </button>
        <button class="log-btn log-btn-toggle" @click="$emit('toggle')" :title="collapsed ? '展开日志' : '折叠日志'">
          <IconChevronRight v-if="collapsed" :size="12" />
          <IconChevronLeft v-else :size="12" />
        </button>
      </div>
    </div>

    <!-- 配置组 Tab 栏：系统 + 每个配置组独立面板 -->
    <div v-if="!collapsed" class="log-tabs">
      <div
        class="log-tab"
        :class="{ active: activeLogGroup === SYSTEM_KEY }"
        @click="selectTab(SYSTEM_KEY)"
        title="系统日志"
      >
        <span class="tab-name">系统</span>
        <span v-if="unreadMap[SYSTEM_KEY]" class="tab-badge">{{ unreadMap[SYSTEM_KEY] }}</span>
      </div>
      <div
        v-for="g in groups"
        :key="g.id"
        class="log-tab"
        :class="{ active: activeLogGroup === g.id }"
        @click="selectTab(g.id)"
        :title="g.id"
      >
        <span class="tab-name">{{ g.name || g.id }}</span>
        <span v-if="unreadMap[g.id]" class="tab-badge">{{ unreadMap[g.id] }}</span>
      </div>
    </div>

    <div v-if="!collapsed" class="log-body">
      <div ref="logListRef" class="log-list">
        <div v-if="currentLogs.length === 0" class="log-empty">
          {{ activeLogGroup === SYSTEM_KEY ? '暂无系统日志' : '该配置组暂无日志' }}
        </div>
        <div v-for="(log, idx) in currentLogs" :key="log.ts + '-' + idx" class="log-item" :class="'log-' + log.level">
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
            确定要清空「{{ currentTabName }}」的日志吗?<br>
            <span style="color:#e6a23c;font-size:12px">仅清空当前面板，其他配置组不受影响。此操作不可恢复。</span>
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
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import api from '../api.js'
import { IconClipboardText, IconTrash, IconChevronRight, IconChevronLeft } from '@tabler/icons-vue'

const SYSTEM_KEY = '__system__'

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  groups: { type: Array, default: () => [] },
  activeGroupId: { type: String, default: null }
})

const emit = defineEmits(['toggle', 'clear'])

// 每个配置组（含系统）独立一份日志数组，互不影响
const logsMap = ref({ [SYSTEM_KEY]: [] })
const unreadMap = ref({})
const activeLogGroup = ref(SYSTEM_KEY)
const logListRef = ref(null)
const showConfirm = ref(false)
const MAX_LOGS = 500
let eventSource = null
let userScrolled = false

// 当前激活面板的日志列表
const currentLogs = computed(() => logsMap.value[activeLogGroup.value] || [])

// 当前激活面板的显示名称
const currentTabName = computed(() => {
  if (activeLogGroup.value === SYSTEM_KEY) return '系统'
  const g = props.groups.find((x) => x.id === activeLogGroup.value)
  return g ? (g.name || g.id) : activeLogGroup.value
})

// 初始化：并行拉取系统 + 所有配置组的历史日志
async function loadAllLogs() {
  const groupIds = [SYSTEM_KEY, ...props.groups.map((g) => g.id)]
  try {
    const results = await Promise.all(groupIds.map((gid) => api.getLogs(gid)))
    const map = {}
    groupIds.forEach((gid, i) => {
      map[gid] = (results[i] && results[i].logs) || []
    })
    logsMap.value = map
    await nextTick()
    scrollToBottom()
  } catch (e) {
    console.error('加载日志失败:', e)
  }
}

// 建立 SSE 连接（单连接广播，按 entry.group 分发到对应组）
function connectSSE() {
  if (eventSource) eventSource.close()

  const token = api.getToken()
  const url = token ? `/api/logs/stream?token=${encodeURIComponent(token)}` : '/api/logs/stream'
  eventSource = new EventSource(url)

  eventSource.onmessage = (e) => {
    try {
      const entry = JSON.parse(e.data)
      if (entry.type !== 'log') return
      const group = entry.group || SYSTEM_KEY
      const map = { ...logsMap.value }
      if (!Array.isArray(map[group])) map[group] = []
      map[group] = [...map[group], entry]
      if (map[group].length > MAX_LOGS) map[group].shift()
      logsMap.value = map

      if (group !== activeLogGroup.value) {
        // 非当前面板：累计未读数
        unreadMap.value = { ...unreadMap.value, [group]: (unreadMap.value[group] || 0) + 1 }
      } else if (!userScrolled) {
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

// 切换 Tab
function selectTab(gid) {
  activeLogGroup.value = gid
  unreadMap.value = { ...unreadMap.value, [gid]: 0 }
  nextTick(() => scrollToBottom())
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

// 执行清空（只清当前激活面板）
async function doClear() {
  try {
    await api.clearLogs(activeLogGroup.value === SYSTEM_KEY ? undefined : activeLogGroup.value)
    const map = { ...logsMap.value }
    map[activeLogGroup.value] = []
    logsMap.value = map
    showConfirm.value = false
    emit('clear')
  } catch (e) {
    console.error('清空日志失败:', e)
  }
}

// 联动：左侧选中配置组变化时，日志面板自动切到该组
watch(() => props.activeGroupId, (newId) => {
  if (newId) {
    activeLogGroup.value = newId
    unreadMap.value = { ...unreadMap.value, [newId]: 0 }
    nextTick(() => scrollToBottom())
  }
})

// 组列表变化：新增组拉取历史，删除组清理本地缓存
watch(() => props.groups, async (newGroups, oldGroups) => {
  const oldIds = new Set((oldGroups || []).map((g) => g.id))
  const newIds = new Set(newGroups.map((g) => g.id))
  const map = { ...logsMap.value }

  // 新增的组：拉取历史日志
  for (const g of newGroups) {
    if (!oldIds.has(g.id)) {
      try {
        const data = await api.getLogs(g.id)
        map[g.id] = (data && data.logs) || []
      } catch {
        map[g.id] = []
      }
    }
  }

  // 删除的组：清理本地缓存和未读数（系统保留）
  for (const key of Object.keys(map)) {
    if (key !== SYSTEM_KEY && !newIds.has(key)) {
      delete map[key]
      const um = { ...unreadMap.value }
      delete um[key]
      unreadMap.value = um
    }
  }

  logsMap.value = map

  // 当前激活的组被删了，回退到系统面板
  if (activeLogGroup.value !== SYSTEM_KEY && !newIds.has(activeLogGroup.value)) {
    activeLogGroup.value = SYSTEM_KEY
  }
})

onMounted(() => {
  // 如果左侧已有选中组，默认跟随；否则显示系统日志
  if (props.activeGroupId) {
    activeLogGroup.value = props.activeGroupId
  }
  loadAllLogs()
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

/* 配置组 Tab 栏 */
.log-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  background: #fafbfc;
  border-bottom: 1px solid #e4e7ed;
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: thin;
}

.log-tabs::-webkit-scrollbar {
  height: 3px;
}

.log-tabs::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 2px;
}

.log-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: #606266;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  flex-shrink: 0;
  border: 1px solid transparent;
}

.log-tab:hover {
  background: #ecf5ff;
  color: #409eff;
}

.log-tab.active {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
  font-weight: 500;
}

.tab-name {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-badge {
  background: #f56c6c;
  color: #fff;
  font-size: 10px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}

.log-tab.active .tab-badge {
  background: #fff;
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
