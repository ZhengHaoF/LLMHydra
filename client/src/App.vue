<template>
  <div class="app">
    <!-- 登录页 -->
    <div v-if="!authenticated" class="login-page">
      <div class="login-box">
        <h1>LLMHydra</h1>
        <p class="login-subtitle">管理面板登录</p>
        <form @submit.prevent="doLogin">
          <input
            type="password"
            v-model="loginPassword"
            placeholder="请输入管理密码"
            class="login-input"
            autofocus
          />
          <button type="submit" class="login-btn" :disabled="loginLoading">
            {{ loginLoading ? '登录中...' : '登录' }}
          </button>
        </form>
        <p v-if="loginError" class="login-error">{{ loginError }}</p>
        <p class="login-hint">管理密码在启动时打印在控制台</p>
      </div>
    </div>

    <!-- 主界面 -->
    <template v-else>
    <header class="header">
      <h1>LLMHydra</h1>
      <span class="subtitle">多端点自动故障转移 · 节点画布编排</span>
      <div class="header-spacer"></div>
      <button class="btn-logout" @click="doLogout">退出</button>
      <button class="btn-api" @click="showApiRef = true">接口</button>
      <button class="btn-stats" @click="showStats = true">统计</button>
      <button class="btn-settings" @click="showSettings = true">设置</button>
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
            :stats-map="statsMap"
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
            <template v-if="tokenSuggestion && tokenSuggestion.anyFilled">
              <span class="canvas-hint">· 链内建议（最小值）</span>
              <span class="canvas-tokens">
                <span
                  v-if="tokenSuggestion.context_length !== null"
                  class="canvas-token-item"
                  :title="tokenTooltip.context_length"
                >上下文 {{ tokenSuggestion.context_length }}</span>
                <span
                  v-if="tokenSuggestion.max_input_tokens !== null"
                  class="canvas-token-item"
                  :title="tokenTooltip.max_input_tokens"
                >最大输入 {{ tokenSuggestion.max_input_tokens }}</span>
                <span
                  v-if="tokenSuggestion.max_output_tokens !== null"
                  class="canvas-token-item"
                  :title="tokenTooltip.max_output_tokens"
                >最大输出 {{ tokenSuggestion.max_output_tokens }}</span>
              </span>
            </template>
            <span v-else-if="activeGroup.chain.length > 0" class="canvas-hint canvas-hint-warn">· 未配置 token 参考值，可在模型编辑中拉取 OpenRouter 或手动填写</span>
          </div>
          <div class="canvas-title canvas-title-empty" v-else>
            <span class="canvas-hint">请在左侧选择或新建一个配置组</span>
          </div>
          <div class="canvas-workspace">
            <NodeCanvas
              ref="canvasRef"
              :chain="currentChainModels"
              :models="models"
              @reorder="onReorder"
              @add-to-chain="onAddToChain"
              @remove-from-chain="onRemoveFromChain"
              @edit-model="openEditModel"
            />
            <LogPanel
              :collapsed="logCollapsed"
              @toggle="logCollapsed = !logCollapsed"
            />
          </div>
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

    <!-- API 弹窗 -->
    <Teleport to="body">
      <div v-if="showApiRef" class="api-overlay" @click.self="showApiRef = false">
        <div class="api-modal">
          <div class="api-modal-header">
            <h2>对外接口参考</h2>
            <button class="api-close" @click="showApiRef = false"><IconX :size="16" /></button>
          </div>
          <div class="api-modal-body">
            <ApiReference />
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 统计弹窗 -->
    <StatsModal :visible="showStats" @close="showStats = false" />

    <!-- 设置弹窗 -->
    <SettingsModal :visible="showSettings" @close="showSettings = false" @saved="onSettingsSaved" @logout="onSettingsLogout" />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import GroupList from './components/GroupList.vue'
import ModelLibrary from './components/ModelLibrary.vue'
import NodeCanvas from './components/NodeCanvas.vue'
import LogPanel from './components/LogPanel.vue'
import ModelEditorModal from './components/ModelEditorModal.vue'
import ApiReference from './components/ApiReference.vue'
import StatsModal from './components/StatsModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import api from './api.js'
import { IconX } from '@tabler/icons-vue'

// ---- 认证状态 ----
const authenticated = ref(false)
const loginPassword = ref('')
const loginError = ref('')
const loginLoading = ref(false)

// ---- 状态 ----
const groups = ref([])
const models = ref([])
const activeGroupId = ref(null)   // 画布当前显示哪个 group
const port = ref(8093)
const editingId = ref(null)
const editingIsNew = ref(false)
const showApiRef = ref(false)
const showStats = ref(false)
const showSettings = ref(false)
const canvasRef = ref(null)
const modelStats = ref([])
const logCollapsed = ref(false)

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

// 链内 token 建议：取所有模型（排除空值/0）后的最小值
const tokenSuggestion = computed(() => {
  const list = currentChainModels.value
  if (list.length === 0) return null
  const pick = (key) => {
    const vals = list
      .map((m) => m?.[key])
      .filter((v) => Number.isFinite(v) && v > 0)
    return vals.length ? Math.min(...vals) : null
  }
  const ctx = pick('context_length')
  const mi = pick('max_input_tokens')
  const mo = pick('max_output_tokens')
  return {
    context_length: ctx,
    max_input_tokens: mi,
    max_output_tokens: mo,
    anyFilled: ctx !== null || mi !== null || mo !== null
  }
})

// 给每个 token 字段生成 tooltip：列出所有有效模型的值
const tokenTooltip = computed(() => {
  const list = currentChainModels.value
  const build = (key) => {
    const rows = list
      .map((m) => ({ name: m.name || m.id, val: m?.[key] }))
      .filter((r) => Number.isFinite(r.val) && r.val > 0)
    if (rows.length === 0) return ''
    rows.sort((a, b) => a.val - b.val)
    return rows.map((r) => `${r.name}: ${r.val}`).join('\n') + '\n（取最小值作为链内建议）'
  }
  return {
    context_length: build('context_length'),
    max_input_tokens: build('max_input_tokens'),
    max_output_tokens: build('max_output_tokens')
  }
})

const currentChainIds = computed(() => activeGroup.value ? activeGroup.value.chain : [])

const otherChainIdsList = computed(() => {
  const curId = activeGroup.value ? activeGroup.value.id : null
  return groups.value
    .filter((g) => g.id !== curId)
    .map((g) => g.chain)
})

const statsMap = computed(() => {
  const map = {}
  for (const m of modelStats.value) {
    map[m.model_id] = {
      total_requests: m.total_requests,
      total_tokens: m.total_tokens
    }
  }
  return map
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

async function loadStats() {
  try {
    const res = await api.getStatsModels()
    modelStats.value = res.models || []
  } catch (e) {
    console.error('加载统计失败:', e)
  }
}

let statsTimer = null

onMounted(() => {
  // 检查是否已有 token
  const token = api.getToken()
  if (token) {
    authenticated.value = true
    loadData()
    loadStats()
    statsTimer = setInterval(loadStats, 30000)
  }

  // 监听认证过期事件
  window.addEventListener('auth-expired', handleAuthExpired)
  window.addEventListener('library-drag-start', onLibraryDragStart)
})

onUnmounted(() => {
  if (statsTimer) clearInterval(statsTimer)
  window.removeEventListener('auth-expired', handleAuthExpired)
  window.removeEventListener('library-drag-start', onLibraryDragStart)
})

// ---- 登录/登出 ----
async function doLogin() {
  if (!loginPassword.value.trim()) {
    loginError.value = '请输入密码'
    return
  }

  loginLoading.value = true
  loginError.value = ''

  try {
    const res = await api.login(loginPassword.value)
    if (res.success) {
      api.setToken(res.token)
      authenticated.value = true
      loginPassword.value = ''
      loadData()
      loadStats()
      statsTimer = setInterval(loadStats, 30000)
    } else {
      loginError.value = res.error || '登录失败'
    }
  } catch (e) {
    loginError.value = '登录失败，请重试'
  } finally {
    loginLoading.value = false
  }
}

function doLogout() {
  api.clearToken()
  authenticated.value = false
  if (statsTimer) {
    clearInterval(statsTimer)
    statsTimer = null
  }
}

function handleAuthExpired() {
  authenticated.value = false
  loginError.value = '会话已过期，请重新登录'
}

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
  // toIdx 是"移除前"链中的目标位置：向前移动时，移除元素后目标下标要 -1
  newChain.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved)
  try {
    await api.updateGroup(g.id, { chain: newChain })
    await loadData()
  } catch (e) {
    console.error('重排失败:', e)
  }
}

async function onAddToChain(modelId, targetIdx) {
  const g = activeGroup.value
  if (!g) return
  if (g.chain.includes(modelId)) return
  const newChain = [...g.chain]
  if (typeof targetIdx === 'number' && targetIdx >= 0 && targetIdx <= newChain.length) {
    newChain.splice(targetIdx, 0, modelId)
  } else {
    newChain.push(modelId)
  }
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

function onSettingsSaved() {
  // 设置保存成功，不需要额外操作
  console.log('设置已保存')
}

function onSettingsLogout() {
  showSettings.value = false
  doLogout()
}
</script>

<style>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

/* 登录页面样式 */
.login-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-box {
  background: white;
  padding: 40px;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  width: 400px;
  text-align: center;
}

.login-box h1 {
  font-size: 32px;
  color: #303133;
  margin-bottom: 8px;
  font-weight: 700;
}

.login-subtitle {
  font-size: 14px;
  color: #909399;
  margin-bottom: 32px;
}

.login-input {
  width: 100%;
  padding: 12px 16px;
  border: 2px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
  margin-bottom: 16px;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.login-input:focus {
  outline: none;
  border-color: #409eff;
}

.login-btn {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.login-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login-error {
  color: #f56c6c;
  font-size: 14px;
  margin-top: 12px;
  text-align: left;
}

.login-hint {
  color: #909399;
  font-size: 12px;
  margin-top: 16px;
  text-align: left;
}

.btn-logout {
  background: rgba(245, 108, 108, 0.15);
  color: #fff;
  border: 1px solid rgba(245, 108, 108, 0.25);
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
  margin-right: 8px;
}

.btn-logout:hover {
  background: rgba(245, 108, 108, 0.25);
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

.btn-stats {
  background: rgba(103,194,58,0.15);
  color: #fff;
  border: 1px solid rgba(103,194,58,0.25);
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.btn-stats:hover { background: rgba(103,194,58,0.25); }

.btn-settings {
  background: rgba(255,255,255,0.1);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.2);
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.btn-settings:hover { background: rgba(255,255,255,0.2); }

.main {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
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
  min-height: 0;
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
.canvas-hint-warn {
  color: #e6a23c;
}
.canvas-tokens {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.canvas-token-item {
  font-size: 12px;
  color: #303133;
  background: #f0f9eb;
  border: 1px solid #e1f3d8;
  padding: 2px 8px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  cursor: help;
}
.canvas-token-item:hover {
  background: #e1f3d8;
}
.canvas-title-empty {
  color: #909399;
}
.canvas-workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
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
