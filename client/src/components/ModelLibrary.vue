<template>
  <div class="model-library">
    <div class="lib-header">
      <h3>模型库</h3>
      <span class="lib-hint">拖到下方画布构建链路 · 库内拖动卡片可排序</span>
      <div class="lib-spacer"></div>
      <input
        v-model="filter"
        class="lib-search"
        type="text"
        placeholder="搜索模型..."
        title="按名称 / 模型 ID / 域名过滤"
      />
      <button class="btn-add" @click="$emit('add')">+ 新增模型</button>
    </div>

    <div
      ref="bodyRef"
      class="lib-body"
      @dragover="onBodyDragOver"
      @dragleave="onBodyDragLeave"
      @drop="onBodyDrop"
    >
      <div v-if="models.length === 0" class="empty">暂无模型，点击右上角新增</div>
      <div v-else-if="filteredModels.length === 0" class="empty">没有匹配「{{ filter.trim() }}」的模型</div>
      <div
        v-for="(m, idx) in filteredModels"
        :key="m.id"
        class="lib-item"
        :class="{
          inChain: isInChain(m.id),
          dragging: reorderDragId === m.id,
          dropHintLeft: canReorder && dropIndex === idx,
          dropHintRight: canReorder && dropIndex === filteredModels.length && idx === filteredModels.length - 1
        }"
        draggable="true"
        @dragstart="onDragStart($event, m.id)"
        @click="$emit('edit', m.id)"
        :title="isInChain(m.id) ? '已在当前配置组的链中 · 点击编辑' : '点击编辑 · 拖到画布加入链路 · 库内拖动排序'"
      >
        <div class="lib-item-name">{{ m.display_name || m.name || '未命名' }}</div>
        <div class="lib-item-meta">
          <span class="badge endpoint-host">{{ endpointHost(m.endpoint) }}</span>
          <span v-if="isInChain(m.id)" class="badge in-chain">当前组</span>
          <span v-if="getStats(m.id)" class="badge stats">{{ getStats(m.id) }}</span>
        </div>
        <button class="lib-del" @click.stop="pendingDelete = m.id" title="删除模型"><IconX :size="13" /></button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="pendingDelete" class="confirm-overlay" @click.self="pendingDelete = null">
        <div class="confirm-box">
          <div class="confirm-title">确认删除</div>
          <div class="confirm-body">
            确定要删除模型 <strong>{{ getModelName(pendingDelete) }}</strong> 吗？<br>
            <span style="color:#e6a23c;font-size:12px">该模型会从所有配置组的链路中移除。</span>
          </div>
          <div class="confirm-actions">
            <button class="btn-cancel" @click="pendingDelete = null">取消</button>
            <button class="btn-danger" @click="confirmDelete">确认删除</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { IconX } from '@tabler/icons-vue'

const props = defineProps({
  models: { type: Array, default: () => [] },
  currentChain: { type: Array, default: () => [] }, // 当前画布上的 model id 列表
  statsMap: { type: Object, default: () => ({}) }    // model_id -> { total_requests, total_tokens }
})

const emit = defineEmits(['add', 'edit', 'delete', 'reorder'])

const pendingDelete = ref(null)

// ---- 库内拖拽排序状态 ----
const bodyRef = ref(null)
const reorderDragId = ref(null) // 正在被拖动排序的模型 id（仅库内排序用，画布拖拽走全局事件）
const dropIndex = ref(null)     // 插入位置（filteredModels 坐标，0..length）

// 搜索过滤：按显示名 / 模型 ID / 端点域名匹配
const filter = ref('')
const filteredModels = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return props.models
  return props.models.filter((m) => {
    const hay = `${m.display_name || ''} ${m.model_id || ''} ${endpointHost(m.endpoint)}`.toLowerCase()
    return hay.includes(q)
  })
})

// 搜索过滤时 filteredModels 与 models 索引不一致，禁用排序避免错位
const canReorder = computed(() => !!reorderDragId.value && !filter.value.trim())

function onDragStart(e, modelId) {
  // 在 dataTransfer 里设一个标记，NodeCanvas 会读 dragstart 事件上的组件 ref
  // 简单做法：把 modelId 放进 dataTransfer，再在 NodeCanvas 端的 dragover 触发时由 App.vue 协调
  // copyMove：drop 在画布上是 copy（入链），drop 在库内是 move（排序）
  e.dataTransfer.effectAllowed = 'copyMove'
  e.dataTransfer.setData('application/x-model-id', modelId)
  // 触发一个全局事件，App.vue 监听后写入 NodeCanvas 的 dragSource
  const evt = new CustomEvent('library-drag-start', { detail: { modelId } })
  window.dispatchEvent(evt)
  // 库内排序：本地记一份拖动状态（未过滤时才允许排序）
  if (!filter.value.trim()) {
    reorderDragId.value = modelId
  }
}

// ---- 库内排序：dragover / drop ----

function resetReorder() {
  reorderDragId.value = null
  dropIndex.value = null
}

function onBodyDragOver(e) {
  if (!canReorder.value) {
    e.dataTransfer.dropEffect = 'none'
    return
  }
  e.preventDefault() // 允许 drop
  e.dataTransfer.dropEffect = 'move'
  const items = bodyRef.value ? bodyRef.value.querySelectorAll('.lib-item') : []
  // 按鼠标 X 与每张卡片中线比较，得到插入位置
  let idx = items.length
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect()
    if (e.clientX < r.left + r.width / 2) { idx = i; break }
  }
  dropIndex.value = idx
  // 接近左右边缘时自动横向滚动
  if (bodyRef.value) {
    const rect = bodyRef.value.getBoundingClientRect()
    const edge = 40
    if (e.clientX < rect.left + edge) bodyRef.value.scrollLeft -= 12
    else if (e.clientX > rect.right - edge) bodyRef.value.scrollLeft += 12
  }
}

function onBodyDragLeave(e) {
  // 只在真正离开容器（而不是在子卡片间移动）时清除指示线
  if (!bodyRef.value || !bodyRef.value.contains(e.relatedTarget)) {
    dropIndex.value = null
  }
}

function onBodyDrop(e) {
  e.preventDefault()
  const dragId = reorderDragId.value
  if (!canReorder.value || dropIndex.value === null) { resetReorder(); return }
  const ids = filteredModels.value.map((m) => m.id)
  const srcIdx = ids.indexOf(dragId)
  const target = dropIndex.value
  resetReorder()
  if (srcIdx < 0) return
  // 落在自己当前位置（左沿/右沿），顺序无变化
  if (target === srcIdx || target === srcIdx + 1) return
  ids.splice(srcIdx, 1)
  ids.splice(target > srcIdx ? target - 1 : target, 0, dragId)
  emit('reorder', ids)
}

function onGlobalDragEnd() {
  // drop 在画布等库外区域时，dragend 兜底清理排序状态
  resetReorder()
}

onMounted(() => window.addEventListener('dragend', onGlobalDragEnd))
onUnmounted(() => window.removeEventListener('dragend', onGlobalDragEnd))

function isInChain(id) {
  return props.currentChain.includes(id)
}

function getModelName(id) {
  const m = props.models.find((m) => m.id === id)
  return m ? (m.display_name || m.name || '未命名') : '未知'
}

function endpointHost(endpoint) {
  if (!endpoint || !endpoint.url) return '无端点';
  try {
    const u = new URL(endpoint.url);
    return u.host;
  } catch (e) {
    return endpoint.url;
  }
}

function getStats(modelId) {
  const s = props.statsMap[modelId]
  if (!s || !s.total_requests) return null
  const req = s.total_requests >= 1000 ? (s.total_requests / 1000).toFixed(1) + 'k' : s.total_requests
  const tok = s.total_tokens >= 1000000 ? (s.total_tokens / 1000000).toFixed(1) + 'M'
    : s.total_tokens >= 1000 ? (s.total_tokens / 1000).toFixed(1) + 'k'
    : s.total_tokens
  return `${req}次 ${tok}tok`
}

function confirmDelete() {
  if (!pendingDelete.value) return
  emit('delete', pendingDelete.value)
  pendingDelete.value = null
}
</script>

<style scoped>
.model-library {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fafbfc;
}
.lib-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #e4e7ed;
  background: #fff;
  flex-shrink: 0;
}
.lib-header h3 { font-size: 14px; font-weight: 600; color: #303133; }
.lib-hint { font-size: 11px; color: #909399; }
.lib-spacer { flex: 1; }
.lib-search {
  width: 170px;
  padding: 5px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}
.lib-search:focus {
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.12);
}
.btn-add {
  background: #409eff;
  color: #fff;
  border: none;
  padding: 5px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.btn-add:hover { background: #337ecc; }
.lib-body {
  display: flex;
  gap: 10px;
  padding: 10px 16px;
  overflow-x: auto;
  flex: 1;
  align-items: center;
}
.empty {
  color: #909399;
  font-size: 12px;
  padding: 16px;
  width: 100%;
  text-align: center;
}
.lib-item {
  flex: 0 0 180px;
  width: 180px;
  height: 72px;
  background: #fff;
  border: 1.5px solid #dcdfe6;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: grab;
  position: relative;
  transition: all 0.15s;
  user-select: none;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}
.lib-item:hover {
  border-color: #409eff;
  box-shadow: 0 2px 8px rgba(64,158,255,0.15);
  transform: translateY(-1px);
}
.lib-item:active { cursor: grabbing; }
.lib-item.inChain {
  border-color: #67c23a;
  background: #f0f9eb;
}
/* 库内排序视觉反馈：box-shadow 画线，不改变布局宽度 */
.lib-item.dragging { opacity: 0.45; }
.lib-item.dropHintLeft { box-shadow: -3px 0 0 0 #409eff; }
.lib-item.dropHintRight { box-shadow: 3px 0 0 0 #409eff; }
.lib-item-name {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
  padding-right: 16px;
}
.lib-item-meta {
  display: flex;
  gap: 4px;
  align-items: center;
  overflow: hidden;
}
.badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: #f4f4f5;
  color: #909399;
  white-space: nowrap;
  flex-shrink: 0;
}
.badge.endpoint-host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.badge.in-chain {
  background: #f0f9eb;
  color: #67c23a;
}
.badge.stats {
  background: #ecf5ff;
  color: #409eff;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 10px;
}
.lib-del {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: #c0c4cc;
  cursor: pointer;
  font-size: 11px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.15s;
}
.lib-item:hover .lib-del { opacity: 1; }
.lib-del:hover { color: #f56c6c; background: #fef0f0; }

.confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
}
.confirm-box {
  background: #fff; border-radius: 8px;
  padding: 24px; min-width: 340px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
.confirm-title { font-size: 16px; font-weight: 600; color: #303133; margin-bottom: 12px; }
.confirm-body { font-size: 14px; color: #606266; line-height: 1.6; margin-bottom: 20px; }
.confirm-body strong { color: #f56c6c; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
.btn-cancel, .btn-danger {
  padding: 7px 20px; border-radius: 4px; border: 1px solid #dcdfe6;
  cursor: pointer; font-size: 13px;
}
.btn-cancel { background: #fff; color: #606266; }
.btn-cancel:hover { color: #409eff; border-color: #c6e2ff; }
.btn-danger { background: #f56c6c; color: #fff; border-color: #f56c6c; }
.btn-danger:hover { background: #e04545; }
</style>
