<template>
  <div class="app">
    <header class="header">
      <h1>LLMHydra</h1>
      <span class="subtitle">多端点自动故障转移 · 节点画布编排</span>
      <div class="header-spacer"></div>
      <button class="btn-api" @click="showApiRef = true">接口</button>
    </header>

    <main class="main">
      <!-- 左侧：配置组列表 -->
      <div class="left-panel">
        <GroupList
          :groups="groups"
          :active-id="activeGroupId"
          :port="port"
          @select="setActiveGroup"
          @add="addGroup"
          @rename="renameGroupId"
          @rename-name="renameGroupName"
          @delete="deleteGroup"
          @restart="doRestart"
        />
      </div>

      <!-- 右侧：上方模型库 + 下方画布 -->
      <div class="right-panel">
        <div class="library-bar">
          <ModelLibrary
            :models="models"
            :current-chain="currentChainIds"
            :other-chains="otherChainIdsList"
            @add="openAddModel"
            @edit="openEditModel"
            @delete="deleteModel"
          />
        </div>
        <div class="canvas-bar">
          <div class="canvas-title" v-if="activeGroup">
            <span class="canvas-group-id">{{ activeGroup.id }}</span>
            <span class="canvas-group-name">{{ activeGroup.name }}</span>
            <span class="canvas-hint">· {{ activeGroup.chain.length }} 个节点 · 按顺序重试 · 调用名 "<code>{{ activeGroup.id }}</code>"</span>
          </div>
          <div class="canvas-title canvas-title-empty" v-else>
            <span class="canvas-hint">请在左侧选择或新建一个配置组</span>
          </div>
          <NodeCanvas
            ref="canvasRef"
            :chain="currentChainModels"
            @reorder="onReorder"
            @add-to-chain="onAddToChain"
            @remove-from-chain="onRemoveFromChain"
            @edit-model="openEditModel"
          />
        </div>
      </div>
    </main>

    <!-- 模型编辑模态框 -->
    <ModelEditorModal
      :model="editingModel"
      :is-new="editingIsNew"
      @save="saveModel"
      @cancel="closeEditor"
    />

    <Teleport to="body">
      <div v-if="showApiRef" class="api-overlay" @click.self="showApiRef = false">
        <div class="api-modal">
          <div class="api-modal-header">
            <h2>对外接口参考</h2>
            <button class="api-close" @click="showApiRef = false">✕</button>
          </div>
          <div class="api-modal-body">
            <ApiReference :proxy-port="port" />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import GroupList from './components/GroupList.vue'
import ModelLibrary from './components/ModelLibrary.vue'
import NodeCanvas from './components/NodeCanvas.vue'
import ModelEditorModal from './components/ModelEditorModal.vue'
import ApiReference from './components/ApiReference.vue'
import api from './api.js'

// ---- 状态 ----
const groups = ref([])
const models = ref([])
const activeGroupId = ref(null)   // 画布当前显示哪个 group
const port = ref(8093)
const editingId = ref(null)
const editingIsNew = ref(false)
const showApiRef = ref(false)
const canvasRef = ref(null)

const editingModel = computed(() => {
  if (editingId.value === null) return null
  return models.value.find((m) => m.id === editingId.value) || null
})

const activeGroup = computed(() => {
  if (!activeGroupId.value) return null
  return groups.value.find((g) => g.id === activeGroupId.value) || null
})

const currentChainModels = computed(() => {
  const g = activeGroup.value
  if (!g) return []
  const map = new Map(models.value.map((m) => [m.id, m]))
  return g.chain.map((id) => map.get(id)).filter((m) => m)
})

const currentChainIds = computed(() => activeGroup.value ? activeGroup.value.chain : [])

const otherChainIdsList = computed(() => {
  const curId = activeGroup.value ? activeGroup.value.id : null
  return groups.value
    .filter((g) => g.id !== curId)
    .map((g) => g.chain)
})

// ---- 加载 ----
async function loadData() {
  try {
    const data = await api.getConfig()
    models.value = data.models || []
    groups.value = (data.groups || []).map((g) => ({
      id: g.id,
      name: g.name,
      chain: Array.isArray(g.chain) ? g.chain : []
    }))
    port.value = data.port || 8093
    // 第一次加载时默认选第一个 group
    if (!activeGroupId.value && groups.value.length > 0) {
      activeGroupId.value = groups.value[0].id
    }
    // 如果当前 activeId 不存在了（被删），回退到第一个
    if (activeGroupId.value && !groups.value.find((g) => g.id === activeGroupId.value)) {
      activeGroupId.value = groups.value.length > 0 ? groups.value[0].id : null
    }
  } catch (e) {
    console.error('加载失败:', e)
  }
}

onMounted(() => {
  loadData()
  window.addEventListener('library-drag-start', onLibraryDragStart)
})

onUnmounted(() => {
  window.removeEventListener('library-drag-start', onLibraryDragStart)
})

// ---- 配置组操作 ----
function setActiveGroup(id) {
  activeGroupId.value = id
}

async function addGroup({ id, name }) {
  try {
    const res = await api.addGroup(id, name)
    if (res && res.success) {
      await loadData()
      activeGroupId.value = id
    } else {
      alert(res.error || '新增失败')
    }
  } catch (e) {
    console.error('新增配置组失败:', e)
  }
}

async function renameGroupId({ oldId, newId, name }) {
  // 修改 id 等价于：删除旧的 + 新建一个并迁移 chain
  // 通过后端 API 实现
  const oldGroup = groups.value.find((g) => g.id === oldId)
  if (!oldGroup) return
  const chainSnapshot = [...oldGroup.chain]
  try {
    // 1. 新建
    await api.addGroup(newId, name)
    // 2. 更新 chain
    await api.updateGroup(newId, { chain: chainSnapshot })
    // 3. 删除旧的
    await api.deleteGroup(oldId)
    await loadData()
    if (activeGroupId.value === oldId) activeGroupId.value = newId
  } catch (e) {
    console.error('重命名 id 失败:', e)
    alert('重命名失败')
  }
}

async function renameGroupName({ id, name }) {
  try {
    await api.updateGroup(id, { name })
    await loadData()
  } catch (e) {
    console.error('重命名失败:', e)
  }
}

async function deleteGroup({ oldId }) {
  try {
    await api.deleteGroup(oldId)
    if (activeGroupId.value === oldId) activeGroupId.value = null
    await loadData()
  } catch (e) {
    console.error('删除失败:', e)
  }
}

// ---- 模型操作 ----
function openAddModel() {
  editingId.value = null
  editingIsNew.value = true
}

function openEditModel(id) {
  editingId.value = id
  editingIsNew.value = false
}

function closeEditor() {
  editingId.value = null
  editingIsNew.value = false
}

async function saveModel(data) {
  try {
    if (editingIsNew.value) {
      await api.addModel(data)
    } else {
      await api.updateModel(editingId.value, data)
    }
    closeEditor()
    await loadData()
  } catch (e) {
    console.error('保存模型失败:', e)
  }
}

async function deleteModel(id) {
  try {
    await api.deleteModel(id)
    await loadData()
  } catch (e) {
    console.error('删除模型失败:', e)
  }
}

// ---- 画布操作 ----
function onLibraryDragStart(e) {
  if (canvasRef.value && canvasRef.value.setLibraryDrag) {
    canvasRef.value.setLibraryDrag(e.detail.modelId)
  }
}

async function onReorder(fromIdx, toIdx) {
  const g = activeGroup.value
  if (!g) return
  const newChain = [...g.chain]
  const [moved] = newChain.splice(fromIdx, 1)
  newChain.splice(toIdx, 0, moved)
  try {
    await api.updateGroup(g.id, { chain: newChain })
    await loadData()
  } catch (e) {
    console.error('重排失败:', e)
  }
}

async function onAddToChain(modelId) {
  const g = activeGroup.value
  if (!g) return
  if (g.chain.includes(modelId)) return
  const newChain = [...g.chain, modelId]
  try {
    await api.updateGroup(g.id, { chain: newChain })
    await loadData()
  } catch (e) {
    console.error('加入链路失败:', e)
  }
}

async function onRemoveFromChain(modelId) {
  const g = activeGroup.value
  if (!g) return
  const newChain = g.chain.filter((id) => id !== modelId)
  try {
    await api.updateGroup(g.id, { chain: newChain })
    await loadData()
  } catch (e) {
    console.error('移除失败:', e)
  }
}

// ---- 其他 ----
async function doRestart() {
  try {
    await api.restart()
  } catch (e) {
    // 重启会断开连接，错误是预期的
  }
}
</script>

<style>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}
.header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff;
  padding: 14px 24px;
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-shrink: 0;
}
.header h1 { font-size: 18px; font-weight: 600; }
.header .subtitle { font-size: 12px; opacity: 0.65; }
.header-spacer { flex: 1; }
.btn-api {
  background: rgba(255,255,255,0.15);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.25);
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.btn-api:hover { background: rgba(255,255,255,0.25); }

.main {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.left-panel {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid #e4e7ed;
  background: #fff;
  display: flex;
  flex-direction: column;
}
.right-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.library-bar {
  flex: 0 0 auto;
  border-bottom: 1px solid #e4e7ed;
  background: #fafbfc;
}
.canvas-bar {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.canvas-title {
  padding: 10px 24px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.canvas-group-id {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  font-family: 'Consolas', 'Monaco', monospace;
  background: #f0f5ff;
  padding: 2px 8px;
  border-radius: 3px;
}
.canvas-group-name {
  font-size: 13px;
  color: #606266;
}
.canvas-hint {
  font-size: 12px;
  color: #909399;
}
.canvas-hint code {
  background: #f0f5ff;
  padding: 1px 6px;
  border-radius: 3px;
  color: #409eff;
  font-family: 'Consolas', 'Monaco', monospace;
}
.canvas-title-empty {
  color: #909399;
}

.api-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.api-modal {
  background: #fff;
  border-radius: 10px;
  width: 680px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 48px rgba(0,0,0,0.18);
}
.api-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}
.api-modal-header h2 { font-size: 16px; font-weight: 600; color: #303133; }
.api-close {
  background: none;
  border: none;
  font-size: 18px;
  color: #909399;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.api-close:hover { color: #303133; background: #f5f7fa; }
.api-modal-body {
  flex: 1;
  overflow-y: auto;
}
</style>
