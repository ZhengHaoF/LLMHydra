<template>
  <div
    class="node-canvas"
    :class="{ panning: isPanning }"
    ref="canvasEl"
    @dragover.prevent="onCanvasDragOver($event)"
    @drop="onDropToCanvas"
    @wheel.prevent="onWheel"
    @mousedown="onCanvasMouseDown"
  >
    <!-- 缩放指示器 -->
    <div class="zoom-indicator">{{ Math.round(scale * 100) }}%</div>
    <!-- 全局 SVG defs：箭头标记 -->
    <svg style="position:absolute;width:0;height:0" aria-hidden="true">
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
          <path d="M0,0 L0,6 L9,3 z" fill="#409eff" />
        </marker>
      </defs>
    </svg>

    <div
      class="canvas-inner"
      :class="{ panning: isPanning }"
      ref="canvasInnerRef"
      :style="{ transform: `translate(${panX}px, ${panY}px) scale(${scale})` }"
    >
      <!-- 入口节点（固定） -->
      <div class="port-node port-in">
        <div class="port-dot"></div>
        <div class="port-label">入口</div>
        <div class="port-hint">请求进入</div>
      </div>

      <!-- 链上的模型节点（可拖拽排序 / 点击编辑 / 拖出删除），TransitionGroup 提供 FLIP 位移动画 -->
      <TransitionGroup tag="div" name="chain-node" class="chain-list" @before-leave="pinLeavePosition">
        <div v-for="(model, idx) in chain" :key="model.id" class="chain-item">
          <!-- 入口 → 首节点的连线（随首个节点一起进出） -->
          <svg
            v-if="idx === 0"
            class="wire-between"
            width="60" height="120"
            @dragover.prevent="onWireDragOver($event, 0)"
            @dragleave="onWireDragLeave(0)"
            @drop.stop="onWireDrop($event, 0)"
          >
            <line x1="0" y1="60" x2="60" y2="60" stroke="#409eff" stroke-width="2.5" marker-end="url(#arrowhead)" />
          </svg>

          <div
            class="model-node"
            :class="{ 'just-added': model.id === flashId }"
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
            ><IconX :size="14" /></button>
          </div>

          <!-- 节点之间的连线（仅在节点之间插入） -->
          <svg
            v-if="idx < chain.length - 1"
            class="wire-between"
            width="60" height="120"
            @dragover.prevent="onWireDragOver($event, idx + 1)"
            @dragleave="onWireDragLeave(idx + 1)"
            @drop.stop="onWireDrop($event, idx + 1)"
          >
            <line x1="0" y1="60" x2="60" y2="60" stroke="#409eff" stroke-width="2.5" marker-end="url(#arrowhead)" />
          </svg>
        </div>
      </TransitionGroup>

      <!-- 链为空时，入口 → 空槽位的虚线连线 -->
      <svg
        v-if="chain.length === 0"
        class="wire-between empty-wire"
        width="60" height="120"
        @dragover.prevent="onWireDragOver($event, 0)"
        @dragleave="onWireDragLeave(0)"
        @drop.stop="onWireDrop($event, 0)"
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
        @dragover.prevent="onWireDragOver($event, 0)"
        @dragleave="onWireDragLeave(0)"
        @drop.stop="onWireDrop($event, 0)"
      >
        <line x1="0" y1="60" x2="60" y2="60" stroke="#c0c4cc" stroke-width="2.5" stroke-dasharray="6,4" />
      </svg>

      <!-- 最后一个模型节点 → 出口节点的连线 -->
      <svg
        v-if="chain.length > 0"
        class="wire-between"
        width="60" height="120"
        @dragover.prevent="onWireDragOver($event, chain.length)"
        @dragleave="onWireDragLeave(chain.length)"
        @drop.stop="onWireDrop($event, chain.length)"
      >
        <line x1="0" y1="60" x2="60" y2="60" stroke="#409eff" stroke-width="2.5" marker-end="url(#arrowhead)" />
      </svg>

      <!-- 出口节点（固定） -->
      <div class="port-node port-out">
        <div class="port-dot"></div>
        <div class="port-label">出口</div>
        <div class="port-hint">返回响应</div>
      </div>

      <!-- 拖放占位幽灵：拖拽悬停时指示将要插入的位置 -->
      <Transition name="ghost">
        <div
          v-if="showGhost"
          class="drop-ghost"
          :style="{ transform: `translateX(${ghostX}px)` }"
        >
          <IconPlus :size="28" />
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { IconX, IconPlus } from '@tabler/icons-vue'

const props = defineProps({
  chain: { type: Array, default: () => [] } // [{ id, name, endpoints: [...] }]
})

const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)

const canvasEl = ref(null)
const canvasInnerRef = ref(null)

// 视口居中：把画布内容放到容器中间
function centerCanvas() {
  nextTick(() => {
    const el = canvasInnerRef.value
    const parent = canvasEl.value
    if (!el || !parent) return
    panX.value = (parent.clientWidth - el.offsetWidth) / 2
    panY.value = (parent.clientHeight - el.offsetHeight) / 2
  })
}

onMounted(() => {
  centerCanvas()
  window.addEventListener('dragend', onGlobalDragEnd)
})

onUnmounted(() => {
  if (flashTimer) clearTimeout(flashTimer)
  window.removeEventListener('dragend', onGlobalDragEnd)
  window.removeEventListener('mousemove', onCanvasMouseMove)
  window.removeEventListener('mouseup', onCanvasMouseUp)
})

// 链长度变化（增删节点）时重新居中，保证新内容可见
watch(() => props.chain.length, () => {
  centerCanvas()
})

// 滚轮缩放：以鼠标所在位置为缩放中心
function onWheel(e) {
  const rect = canvasEl.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  const oldScale = scale.value
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  const newScale = Math.max(0.5, Math.min(2, oldScale + delta))
  if (newScale === oldScale) return
  // 保持鼠标指向的内容点不动
  panX.value = mouseX - ((mouseX - panX.value) * newScale) / oldScale
  panY.value = mouseY - ((mouseY - panY.value) * newScale) / oldScale
  scale.value = newScale
}

let panStartX = 0
let panStartY = 0
let panOriginX = 0
let panOriginY = 0

// 空白处按下启动平移（节点上交给 HTML5 DnD 处理排序）
function onCanvasMouseDown(e) {
  if (e.button !== 0) return
  if (e.target.closest('.model-node') || e.target.closest('.port-node')) return
  e.preventDefault()
  isPanning.value = true
  panStartX = e.clientX
  panStartY = e.clientY
  panOriginX = panX.value
  panOriginY = panY.value
  window.addEventListener('mousemove', onCanvasMouseMove)
  window.addEventListener('mouseup', onCanvasMouseUp)
}

function onCanvasMouseMove(e) {
  if (!isPanning.value) return
  panX.value = panOriginX + (e.clientX - panStartX)
  panY.value = panOriginY + (e.clientY - panStartY)
}

function onCanvasMouseUp() {
  isPanning.value = false
  window.removeEventListener('mousemove', onCanvasMouseMove)
  window.removeEventListener('mouseup', onCanvasMouseUp)
}

const emit = defineEmits([
  'reorder',         // (fromIdx, toIdx) — 在画布内交换顺序
  'add-to-chain',    // (modelId, targetIdx?) — 从模型库拖入，可指定插入位置
  'remove-from-chain', // (modelId) — 移除节点
  'edit-model'       // (modelId)
])

const dragSource = ref(null) // { type: 'canvas', idx } | { type: 'library', modelId } | null
const dragOverIdx = ref(null) // 拖拽悬停的节点索引（用于视觉反馈）

const flashId = ref(null)          // 刚插入节点的 id（触发落点光晕）
const pendingFlashId = ref(null)   // 本次拖放期望插入的模型 id（区分"拖入"与"切换配置组"）
let flashTimer = null

// 链成员变化时：若是刚拖入的模型，给节点加一次落点光晕（重排 / 切换配置组不触发）
watch(
  () => props.chain.map((m) => m.id).join('\u0001'),
  (newIds, oldIds) => {
    const pending = pendingFlashId.value
    pendingFlashId.value = null
    if (!oldIds || !pending) return
    const newSet = new Set(newIds.split('\u0001'))
    const oldSet = new Set(oldIds.split('\u0001'))
    if (!oldSet.has(pending) && newSet.has(pending)) {
      flashId.value = pending
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => { flashId.value = null }, 1400)
    }
  }
)

// flex 容器中 abspos 的静态位置会跑到行首，离开前先把在流中的坐标钉住
function pinLeavePosition(el) {
  el.style.left = el.offsetLeft + 'px'
  el.style.top = el.offsetTop + 'px'
}

// ---- 拖放占位幽灵 ----

const GHOST_WIDTH = 150

// 幽灵 x 坐标（canvas-inner 局部坐标）：插入间隙中心 = 对应位置连线(60px)的中点
const ghostX = computed(() => {
  const idx = dragOverIdx.value
  if (idx === null || idx === undefined) return null
  const nodeEls = canvasInnerRef.value ? canvasInnerRef.value.querySelectorAll('.model-node') : []
  if (nodeEls.length === 0) return null
  let center
  if (idx === 0) {
    center = nodeEls[0].offsetLeft - 30               // 入口 → 首节点之间的空隙
  } else {
    center = nodeEls[Math.min(idx, nodeEls.length) - 1].offsetLeft + 190  // 节点间 / 链尾空隙
  }
  return center - GHOST_WIDTH / 2
})

// 拖拽中且悬停在某个间隙上时显示幽灵（链为空时交给空槽位提示，不显示）
const showGhost = computed(() => {
  return !!dragSource.value && dragOverIdx.value !== null && props.chain.length > 0 && ghostX.value !== null
})

// 画布空白处 dragover：按坐标算出最近的插入间隙。
// 节点 / 连线上的悬停由各自的 handler 设置精确下标，这里只处理空白区。
function onCanvasDragOver(e) {
  if (!dragSource.value) return
  if (e.target.closest('.model-node') || e.target.closest('.wire-between')) return
  e.dataTransfer.dropEffect = dragSource.value.type === 'library' ? 'copy' : 'move'
  dragOverIdx.value = computeInsertIndex(e.clientX)
}

// 拖拽被取消（Esc / 拖出窗口）时清理拖放状态，避免幽灵残留
function onGlobalDragEnd() {
  dragSource.value = null
  dragOverIdx.value = null
}

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
    pendingFlashId.value = src.modelId
    emit('add-to-chain', src.modelId, targetIdx)
  }
  dragSource.value = null
  dragOverIdx.value = null
}

function onDropToCanvas(e) {
  const src = dragSource.value
  if (src && src.type === 'library') {
    pendingFlashId.value = src.modelId
    emit('add-to-chain', src.modelId, computeInsertIndex(e.clientX))
  }
  dragSource.value = null
  dragOverIdx.value = null
}

// ---- 连线间隙落点：节点之间的空隙也可以精确插入 / 重排 ----

function onWireDragOver(e, insertIdx) {
  if (!dragSource.value) return
  e.dataTransfer.dropEffect = dragSource.value.type === 'library' ? 'copy' : 'move'
  dragOverIdx.value = insertIdx
}

function onWireDragLeave(insertIdx) {
  if (dragOverIdx.value === insertIdx) {
    dragOverIdx.value = null
  }
}

function onWireDrop(e, insertIdx) {
  const src = dragSource.value
  if (!src) return
  if (src.type === 'canvas') {
    if (src.idx !== insertIdx) emit('reorder', src.idx, insertIdx)
  } else if (src.type === 'library') {
    pendingFlashId.value = src.modelId
    emit('add-to-chain', src.modelId, insertIdx)
  }
  dragSource.value = null
  dragOverIdx.value = null
}

// 空白处落点：按鼠标 X 坐标与各节点中点比对，换算成真实插入下标。
// 节点之间 60px 的连线空隙对鼠标事件透明，落点会穿透到画布空白处，
// 必须用坐标算出插到哪个间隙，而不是一律追加到链尾。
function computeInsertIndex(clientX) {
  const canvasRect = canvasEl.value.getBoundingClientRect()
  const localX = (clientX - canvasRect.left - panX.value) / scale.value
  const nodeEls = canvasInnerRef.value.querySelectorAll('.model-node')
  for (let i = 0; i < nodeEls.length; i++) {
    const el = nodeEls[i]
    if (localX < el.offsetLeft + el.offsetWidth / 2) return i
  }
  return nodeEls.length
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
  overflow: hidden;
  position: relative;
  cursor: grab;
  user-select: none;
  min-height: 360px;
}
.node-canvas.panning {
  cursor: grabbing;
}
.canvas-inner {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 0;
  flex-wrap: nowrap;
  transform-origin: 0 0;
  transition: transform 0.15s ease-out;
  will-change: transform;
}
.canvas-inner.panning {
  transition: none;
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
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  user-select: none;
  z-index: 2;
}
.model-node:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(64,158,255,0.25);
}
.model-node:active { cursor: grabbing; }

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
  transition: opacity 0.15s, color 0.15s, background-color 0.15s;
}
.model-node:hover .node-remove {
  opacity: 1;
}
.node-remove:hover {
  color: #f56c6c;
  background: #fef0f0;
}

/* ---- 节点之间的连线 ---- */
.wire-between {
  flex: 0 0 auto;
  display: block;
  pointer-events: auto;   /* 连线间隙要接收拖放事件，支持在两节点之间插入 */
}

/* ---- 拖放占位幽灵：虚线卡片指示将要插入的位置 ---- */
.drop-ghost {
  position: absolute;
  top: 21px;
  left: 0;
  width: 150px;
  height: 78px;
  border: 2px dashed #67c23a;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.75);
  color: #67c23a;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;                 /* 不能挡住 dragover / drop 事件 */
  z-index: 5;
  box-sizing: border-box;
  box-shadow: 0 2px 10px rgba(103, 194, 58, 0.12);
  transition: transform 0.15s ease-out; /* 随鼠标在间隙之间平滑滑动 */
}

.ghost-enter-active,
.ghost-leave-active {
  transition: opacity 0.15s ease;
}
.ghost-enter-from,
.ghost-leave-to {
  opacity: 0;
}

/* ---- 链列表（TransitionGroup 容器） ---- */
.chain-list {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}
.chain-item {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}

/* ---- 链节点过渡动画（进入 / 离开 / FLIP 位移） ---- */
.chain-node-enter-active {
  transition: opacity 0.24s cubic-bezier(0.23, 1, 0.32, 1), transform 0.24s cubic-bezier(0.23, 1, 0.32, 1);
}
.chain-node-enter-from {
  opacity: 0;
  transform: scale(0.9) translateY(-10px);   /* 从上方"落下"，绝不从 scale(0) 起步 */
}
.chain-node-leave-active {
  transition: opacity 0.15s ease-out;         /* 离开比进入快，移除不拖沓 */
  position: absolute;                         /* 移出布局流让位给 FLIP；坐标在 before-leave 中已钉住 */
  z-index: 1;
}
.chain-node-leave-to {
  opacity: 0;
}
.chain-node-move {
  transition: transform 0.28s cubic-bezier(0.23, 1, 0.32, 1);  /* FLIP 位移 */
}

/* 新插入节点：进入动画结束后亮一下绿环，指示落点 */
.model-node.just-added {
  border-color: #67c23a;
  animation: node-pulse 0.7s ease-out 0.24s;
}
@keyframes node-pulse {
  0%   { box-shadow: 0 2px 8px rgba(64, 158, 255, 0.15), 0 0 0 0 rgba(103, 194, 58, 0.45); }
  100% { box-shadow: 0 2px 8px rgba(64, 158, 255, 0.15), 0 0 0 18px rgba(103, 194, 58, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .chain-node-enter-active,
  .chain-node-leave-active {
    transition: opacity 0.15s ease;   /* 保留淡入淡出，去掉位移 */
  }
  .chain-node-move {
    transition: none;
  }
  .chain-node-enter-from {
    transform: none;
  }
  .model-node.just-added {
    animation: none;
    border-color: #67c23a;
  }
  .drop-ghost {
    transition: none;                 /* 幽灵不滑动，只保留淡入淡出 */
  }
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

/* ---- 缩放指示器 ---- */
.zoom-indicator {
  position: absolute;
  bottom: 12px;
  right: 16px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  pointer-events: none;
  z-index: 10;
  backdrop-filter: blur(8px);
}
</style>
