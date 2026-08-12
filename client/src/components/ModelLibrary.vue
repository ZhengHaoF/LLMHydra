<template>
  <div class="model-library">
    <div class="lib-header">
      <h3>模型库</h3>
      <span class="lib-hint">拖到下方画布构建链路</span>
      <div class="lib-spacer"></div>
      <button class="btn-add" @click="$emit('add')">+ 新增模型</button>
    </div>

    <div class="lib-body">
      <div v-if="models.length === 0" class="empty">暂无模型，点击右上角新增</div>
      <div
        v-for="m in models"
        :key="m.id"
        class="lib-item"
        :class="{ inChain: isInAnyChain(m.id) }"
        draggable="true"
        @dragstart="onDragStart($event, m.id)"
        @click="$emit('edit', m.id)"
        :title="isInAnyChain(m.id) ? '已在此或其他配置组的链中 · 点击编辑' : '点击编辑 · 拖到画布加入链路'"
      >
        <div class="lib-item-name">{{ m.display_name || m.name || '未命名' }}</div>
        <div class="lib-item-meta">
          <span class="badge endpoint-host">{{ endpointHost(m.endpoint) }}</span>
          <span v-if="isInChain(m.id)" class="badge in-chain">当前组</span>
          <span v-else-if="isInOtherChain(m.id)" class="badge other-chain">其他组</span>
        </div>
        <button class="lib-del" @click.stop="pendingDelete = m.id" title="删除模型">✕</button>
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
import { ref } from 'vue'

const props = defineProps({
  models: { type: Array, default: () => [] },
  currentChain: { type: Array, default: () => [] }, // 当前画布上的 model id 列表
  otherChains: { type: Array, default: () => [] }    // 其他配置组的 chain（model id 列表）
})

const emit = defineEmits(['add', 'edit', 'delete'])

const pendingDelete = ref(null)

function onDragStart(e, modelId) {
  // 在 dataTransfer 里设一个标记，NodeCanvas 会读 dragstart 事件上的组件 ref
  // 简单做法：把 modelId 放进 dataTransfer，再在 NodeCanvas 端的 dragover 触发时由 App.vue 协调
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData('application/x-model-id', modelId)
  // 触发一个全局事件，App.vue 监听后写入 NodeCanvas 的 dragSource
  const evt = new CustomEvent('library-drag-start', { detail: { modelId } })
  window.dispatchEvent(evt)
}

function isInChain(id) {
  return props.currentChain.includes(id)
}

function isInOtherChain(id) {
  return !isInChain(id) && props.otherChains.some((arr) => arr.includes(id))
}

function isInAnyChain(id) {
  return isInChain(id) || isInOtherChain(id)
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
.badge.other-chain {
  background: #fdf6ec;
  color: #e6a23c;
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
