<template>
  <div class="node-canvas" @dragover.prevent @drop="onDropToCanvas">
    <!-- 全局 SVG defs：箭头标记 -->
    <svg style="position:absolute;width:0;height:0" aria-hidden="true">
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
          <path d="M0,0 L0,6 L9,3 z" fill="#409eff" />
        </marker>
      </defs>
    </svg>

    <div class="canvas-inner">
      <!-- 入口节点（固定） -->
      <div class="port-node port-in">
        <div class="port-dot"></div>
        <div class="port-label">入口</div>
        <div class="port-hint">请求进入</div>
      </div>

      <!-- 链上的模型节点（可拖拽排序 / 点击编辑 / 拖出删除） -->
      <template v-for="(model, idx) in chain" :key="model.id">
        <svg
          v-if="idx === 0"
          class="wire-between"
          width="60" height="120"
        >
          <line x1="0" y1="60" x2="60" y2="60" stroke="#409eff" stroke-width="2.5" marker-end="url(#arrowhead)" />
        </svg>
        <div
          class="model-node"
          :class="{ 'drop-before': dragOverIdx === idx && dragSource?.type === 'library' }"
          draggable="true"
          @dragstart="onNodeDragStart($event, idx)"
          @dragover.prevent="onNodeDragOver($event, idx)"
          @dragleave="onNodeDragLeave(idx)"
          @drop.stop="onNodeDrop($event, idx)"
          @click="$emit('edit-model', model.id)"
          :title="`点击编辑 · ${model.display_name || model.name}`"
        >
          <div class="node-handle">⋮⋮</div>
          <div class="node-order">{{ idx + 1 }}</div>
          <div class="node-body">
            <div class="node-name">{{ model.display_name || model.name || '未命名' }}</div>
            <div class="node-meta">{{ endpointHost(model.endpoint) }}</div>
          </div>
          <button
            class="node-remove"
            @click.stop="$emit('remove-from-chain', model.id)"
            title="从链中移除"
          >✕</button>
        </div>

        <!-- 节点之间的连线（仅在节点之间插入） -->
        <svg
          v-if="idx < chain.length - 1"
          class="wire-between"
          width="60" height="120"
        >
          <line x1="0" y1="60" x2="60" y2="60" stroke="#409eff" stroke-width="2.5" marker-end="url(#arrowhead)" />
        </svg>
      </template>

      <!-- 链为空时，入口 → 空槽位的虚线连线 -->
      <svg
        v-if="chain.length === 0"
        class="wire-between empty-wire"
        width="60" height="120"
      >
        <line x1="0" y1="60" x2="60" y2="60" stroke="#c0c4cc" stroke-width="2.5" stroke-dasharray="6,4" />
      </svg>

      <!-- 空槽位提示 -->
      <div
        v-if="chain.length === 0"
        class="empty-slot"
        @dragover.prevent
        @drop="onDropToCanvas"
      >
        从上方拖拽模型到此处构建链路
      </div>

      <!-- 链为空时，空槽位 → 出口的虚线连线 -->
      <svg
        v-if="chain.length === 0"
        class="wire-between empty-wire"
        width="60" height="120"
      >
        <line x1="0" y1="60" x2="60" y2="60" stroke="#c0c4cc" stroke-width="2.5" stroke-dasharray="6,4" />
      </svg>

      <!-- 最后一个模型节点 → 出口节点的连线 -->
      <svg
        v-if="chain.length > 0"
        class="wire-between"
        width="60" height="120"
      >
        <line x1="0" y1="60" x2="60" y2="60" stroke="#409eff" stroke-width="2.5" marker-end="url(#arrowhead)" />
      </svg>

      <!-- 出口节点（固定） -->
      <div class="port-node port-out">
        <div class="port-dot"></div>
        <div class="port-label">出口</div>
        <div class="port-hint">返回响应</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  chain: { type: Array, default: () => [] } // [{ id, name, endpoints: [...] }]
})

const emit = defineEmits([
  'reorder',         // (fromIdx, toIdx) — 在画布内交换顺序
  'add-to-chain',    // (modelId, targetIdx?) — 从模型库拖入，可指定插入位置
  'remove-from-chain', // (modelId) — 移除节点
  'edit-model'       // (modelId)
])

const dragSource = ref(null) // { type: 'canvas', idx } | { type: 'library', modelId } | null
const dragOverIdx = ref(null) // 拖拽悬停的节点索引（用于视觉反馈）

function endpointHost(endpoint) {
  if (!endpoint || !endpoint.url) return '无端点';
  try {
    return new URL(endpoint.url).host;
  } catch (e) {
    return endpoint.url;
  }
}

function onNodeDragStart(e, idx) {
  dragSource.value = { type: 'canvas', idx }
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', `canvas:${idx}`)
}

function onNodeDragOver(e, idx) {
  if (!dragSource.value) return
  e.dataTransfer.dropEffect = dragSource.value.type === 'library' ? 'copy' : 'move'
  dragOverIdx.value = idx
}

function onNodeDragLeave(idx) {
  if (dragOverIdx.value === idx) {
    dragOverIdx.value = null
  }
}

function onNodeDrop(e, targetIdx) {
  const src = dragSource.value
  if (!src) return
  if (src.type === 'canvas' && src.idx !== targetIdx) {
    emit('reorder', src.idx, targetIdx)
  } else if (src.type === 'library') {
    emit('add-to-chain', src.modelId, targetIdx)
  }
  dragSource.value = null
  dragOverIdx.value = null
}

function onDropToCanvas(e) {
  const src = dragSource.value
  if (src && src.type === 'library') {
    emit('add-to-chain', src.modelId)
  }
  dragSource.value = null
  dragOverIdx.value = null
}

// 暴露给 ModelLibrary 用：开始拖模型库中的模型
defineExpose({
  setLibraryDrag(modelId) {
    dragSource.value = { type: 'library', modelId }
  }
})
</script>

<style scoped>
.node-canvas {
  flex: 1;
  background: #f5f7fa;
  background-image:
    radial-gradient(circle at 1px 1px, rgba(0,0,0,0.06) 1px, transparent 0);
  background-size: 20px 20px;
  overflow: auto;
  padding: 40px 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 360px;
}
.canvas-inner {
  display: flex;
  align-items: center;
  gap: 0;
  flex-wrap: nowrap;
}

/* ---- 端口节点（入口 / 出口） ---- */
.port-node {
  flex: 0 0 auto;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  background: linear-gradient(135deg, #67c23a 0%, #409eff 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(64,158,255,0.3);
  position: relative;
  z-index: 2;
}
.port-node.port-out {
  background: linear-gradient(135deg, #409eff 0%, #67c23a 100%);
}
.port-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  margin-bottom: 4px;
  box-shadow: 0 0 8px rgba(255,255,255,0.6);
}
.port-label {
  font-size: 13px;
  font-weight: 600;
}
.port-hint {
  font-size: 10px;
  opacity: 0.85;
  margin-top: 1px;
}

/* ---- 模型节点 ---- */
.model-node {
  flex: 0 0 auto;
  width: 160px;
  height: 84px;
  background: #fff;
  border: 2px solid #409eff;
  border-radius: 10px;
  padding: 8px 10px;
  cursor: grab;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 2px 8px rgba(64,158,255,0.15);
  transition: transform 0.15s, box-shadow 0.15s;
  user-select: none;
  z-index: 2;
}
.model-node:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(64,158,255,0.25);
}
.model-node:active { cursor: grabbing; }

/* 拖拽插入指示器：左侧高亮条 */
.model-node.drop-before {
  border-color: #67c23a;
  box-shadow: 0 6px 16px rgba(103,194,58,0.3);
}
.model-node.drop-before::before {
  content: '';
  position: absolute;
  left: -6px;
  top: -4px;
  bottom: -4px;
  width: 4px;
  background: #67c23a;
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(103,194,58,0.6);
  z-index: 3;
}
.node-handle {
  position: absolute;
  top: 4px;
  left: 4px;
  color: #c0c4cc;
  font-size: 10px;
  letter-spacing: -2px;
}
.node-order {
  position: absolute;
  top: -10px;
  right: -10px;
  width: 22px;
  height: 22px;
  background: #409eff;
  color: #fff;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(64,158,255,0.4);
}
.node-body {
  text-align: center;
  margin-top: 8px;
}
.node-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-meta {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}
.node-remove {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: #c0c4cc;
  cursor: pointer;
  font-size: 12px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.15s;
}
.model-node:hover .node-remove {
  opacity: 1;
}
.node-remove:hover {
  color: #f56c6c;
  background: #fef0f0;
}

/* ---- 节点之间的连线 ---- */
.wires, .wire-between {
  flex: 0 0 auto;
  display: block;
  pointer-events: none;
}

/* ---- 空槽位 ---- */
.empty-slot {
  width: 240px;
  height: 84px;
  border: 2px dashed #c0c4cc;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 12px;
  text-align: center;
  padding: 0 12px;
  background: rgba(255,255,255,0.5);
}
</style>
