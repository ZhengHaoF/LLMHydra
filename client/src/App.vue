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
      <button class="btn-logout" @click="doLogout" :disabled="loggingOut">{{ loggingOut ? '退出中…' : '退出' }}</button>
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
          @restart="doRestart"
          :submit-add="addGroup"
          :submit-rename="submitRenameGroup"
          :submit-delete="deleteGroup"
          :restarting="restarting"
          :busy="groupPending"
        />
      </div>

      <!-- 右侧：上方模型库 + 下方画布 -->
      <div class="right-panel">
        <div class="library-bar">
          <ModelLibrary
            :models="models"
            :current-chain="currentChainIds"
            :stats-map="statsMap"
            :submit-delete="deleteModel"
            @add="openAddModel"
            @edit="openEditModel"
            @reorder="onLibraryReorder"
          />
        </div>
        <div class="canvas-bar">
          <!-- 链路写操作进行中的细进度条：避免拖拽后长时间无反馈 -->
          <div v-if="chainPending" class="chain-progress" aria-hidden="true"><span></span></div>
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
            <span v-else-if="activeGroup.chain.length > 0" class="canvas-hint canvas-hint-warn">· 未配置 token 参考值，可在模型编辑中拉取 LiteLLM 模型库或手动填写</span>
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
              :groups="groups"
              :active-group-id="activeGroupId"
              @toggle="logCollapsed = !logCollapsed"
            />
          </div>
        </div>
      </div>
      <!-- 首次配置加载遮罩：数据到达前盖住主区域，避免链路图空态闪烁 -->
      <div v-if="!initialLoaded" class="main-loading">
        <template v-if="initialError">
          <p class="main-loading-error">{{ initialError }}</p>
          <button class="main-loading-retry" @click="loadData">重试</button>
        </template>
        <template v-else>
          <div class="main-loading-spinner" aria-hidden="true"></div>
          <p class="main-loading-text">链路配置加载中…</p>
        </template>
      </div>
    </main>

    <!-- 模型编辑模态框 -->
    <ModelEditorModal
      :model="editingModel"
      :is-new="editingIsNew"
      :saving="savingModel"
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

    <!-- 全局轻提示（成功 / 失败反馈统一出口） -->
    <ToastHost />
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
import { notify, errMsg, usePending } from './ui.js'
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
// 首次配置加载状态：initialLoaded 为 false 时主区域显示加载遮罩（后台静默刷新不触发）
const initialLoaded = ref(false)
const initialError = ref('')

// ---- 各操作的进行中状态 ----
const { pending: savingModel, run: runSaveModel } = usePending()
const { pending: restarting, run: runRestart } = usePending()
const { pending: chainPending, run: runChain } = usePending()
const { pending: groupPending, run: runGroup } = usePending()
const loggingOut = ref(false)

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
    initialLoaded.value = true
    initialError.value = ''
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
    // 仅首次加载失败时占据主区域并提供重试；已加载过后的后台刷新失败保留旧数据
    if (!initialLoaded.value) {
      initialError.value = '配置加载失败，请确认服务正常后重试'
    }
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

async function doLogout() {
  if (loggingOut.value) return
  loggingOut.value = true
  // 通知服务端作废当前会话 token；仅清 localStorage 的话 token 在服务端依然有效。
  // 服务不可用时也要保证本地状态能清干净，所以超时由 api 层兜底，这里不做额外处理。
  try {
    await api.logout()
  } catch (e) {
    // 服务端已不可用（如正在重启）时忽略
  } finally {
    loggingOut.value = false
  }
  api.clearToken()
  authenticated.value = false
  // 重置首次加载状态与残留数据，重新登录时重新走加载遮罩
  initialLoaded.value = false
  initialError.value = ''
  groups.value = []
  models.value = []
  activeGroupId.value = null
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

// 以下三个配置组写操作都返回 { ok, error }：由弹窗自己决定关闭还是显示错误
async function addGroup({ id, name }) {
  const r = await runGroup(async () => {
    try {
      await api.addGroup(id, name)
      activeGroupId.value = id
      await loadData()
      notify(`配置组 ${id} 已创建`, 'success')
      return { ok: true }
    } catch (e) {
      const error = errMsg(e, '新增配置组失败')
      notify(error)
      return { ok: false, error }
    }
  })
  return r || { ok: false, error: '正在处理中，请稍候' }
}

// 改 ID 等价于：新建 → 迁移 chain → 删除旧的；只改名字则只发一个请求
async function submitRenameGroup({ oldId, newId, name }) {
  if (newId === oldId) {
    const r = await runGroup(async () => {
      try {
        await api.updateGroup(oldId, { name })
        await loadData()
        notify('名称已更新', 'success')
        return { ok: true }
      } catch (e) {
        const error = errMsg(e, '重命名失败')
        notify(error)
        return { ok: false, error }
      }
    })
    return r || { ok: false, error: '正在处理中，请稍候' }
  }

  const oldGroup = groups.value.find((g) => g.id === oldId)
  if (!oldGroup) return { ok: false, error: '配置组已不存在，请刷新后重试' }
  const chainSnapshot = [...oldGroup.chain]

  // 三步串行，中途失败会留下半成品，所以任何一步失败都要尽量回滚
  const r = await runGroup(async () => {
    let created = false
    try {
      await api.addGroup(newId, name)
      created = true
      await api.updateGroup(newId, { chain: chainSnapshot })
      await api.deleteGroup(oldId)
      if (activeGroupId.value === oldId) activeGroupId.value = newId
      await loadData()
      notify(`配置组已更名为 ${newId}`, 'success')
      return { ok: true }
    } catch (e) {
      // 新组已建出但后续步骤失败：删掉新组，保证不留下两个同名组
      if (created) {
        try { await api.deleteGroup(newId) } catch { /* 回滚失败时靠刷新让用户看到真实状态 */ }
      }
      await loadData()
      const error = errMsg(e, '重命名失败，已恢复原状')
      notify(error, 'error', 4000)
      return { ok: false, error }
    }
  })
  return r || { ok: false, error: '正在处理中，请稍候' }
}

async function deleteGroup({ oldId }) {
  const r = await runGroup(async () => {
    try {
      await api.deleteGroup(oldId)
      if (activeGroupId.value === oldId) activeGroupId.value = null
      await loadData()
      notify('配置组已删除', 'success')
      return { ok: true }
    } catch (e) {
      const error = errMsg(e, '删除失败')
      notify(error)
      return { ok: false, error }
    }
  })
  return r || { ok: false, error: '正在处理中，请稍候' }
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
  await runSaveModel(async () => {
    try {
      if (editingIsNew.value) {
        await api.addModel(data)
      } else {
        await api.updateModel(editingId.value, data)
      }
      closeEditor()
      await loadData()
      notify(editingIsNew.value ? '模型已新增' : '模型已保存', 'success')
    } catch (e) {
      // 不关弹窗：用户已填的内容不能丢，改正后直接重试即可
      notify(errMsg(e, '保存模型失败'))
    }
  })
}

async function deleteModel(id) {
  const r = await runGroup(async () => {
    try {
      await api.deleteModel(id)
      await loadData()
      notify('模型已删除', 'success')
      return { ok: true }
    } catch (e) {
      const error = errMsg(e, '删除模型失败')
      notify(error)
      return { ok: false, error }
    }
  })
  return r || { ok: false, error: '正在处理中，请稍候' }
}

// ---- 画布操作 ----
function onLibraryDragStart(e) {
  if (canvasRef.value && canvasRef.value.setLibraryDrag) {
    canvasRef.value.setLibraryDrag(e.detail.modelId)
  }
}

// 模型库内拖拽排序：乐观更新本地顺序，保存失败时回滚
async function onLibraryReorder(orderedIds) {
  const map = new Map(models.value.map((m) => [m.id, m]))
  const next = orderedIds.map((id) => map.get(id)).filter(Boolean)
  if (next.length !== models.value.length) return // 序列不完整，忽略
  const prev = models.value
  models.value = next
  try {
    await api.reorderModels(orderedIds)
  } catch (e) {
    models.value = prev
    await loadData()
    notify(errMsg(e, '排序保存失败，已恢复原顺序'))
  }
}

// 画布三个写操作都是「先存后刷新」，共用一份 pending，避免互相覆盖
async function saveChain(group, newChain, failText) {
  await runChain(async () => {
    try {
      await api.updateGroup(group.id, { chain: newChain })
      await loadData()
    } catch (e) {
      notify(errMsg(e, failText))
    }
  })
}

async function onReorder(fromIdx, toIdx) {
  const g = activeGroup.value
  if (!g) return
  const newChain = [...g.chain]
  const [moved] = newChain.splice(fromIdx, 1)
  // toIdx 是"移除前"链中的目标位置：向前移动时，移除元素后目标下标要 -1
  newChain.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved)
  await saveChain(g, newChain, '节点排序保存失败')
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
  await saveChain(g, newChain, '加入链路失败')
}

async function onRemoveFromChain(modelId) {
  const g = activeGroup.value
  if (!g) return
  const newChain = g.chain.filter((id) => id !== modelId)
  await saveChain(g, newChain, '移除节点失败')
}

// ---- 其他 ----
async function doRestart() {
  if (!window.confirm('确定要重启服务吗？重启期间请求会中断，且需要重新登录。')) return
  await runRestart(async () => {
    try {
      await api.restart()
    } catch (e) {
      // 服务立刻断开连接，这里是预期内的失败；真正的判断交给下面的探测
    }
    notify('正在重启服务，等待恢复…', 'info', 4000)
    const ok = await waitForServer(30000)
    if (ok) {
      // 重启会清空服务端内存里的会话，重新登录才能继续操作
      notify('服务已重启，请重新登录', 'warn', 3000)
      setTimeout(() => window.location.reload(), 800)
    } else {
      notify('服务未在预期时间内恢复，请手动检查', 'error', 5000)
    }
  })
}

// 轮询静态首页探测服务是否已恢复（不能用 /api/*，它需要已失效的 token）
async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch('/', { cache: 'no-store' })
      if (r.ok) return true
    } catch { /* 服务还没启起来 */ }
    await new Promise((res) => setTimeout(res, 1000))
  }
  return false
}

function onSettingsSaved() {
  notify('设置已保存', 'success')
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
.btn-logout:disabled {
  opacity: 0.55;
  cursor: not-allowed;
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
  position: relative;
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
/* 链路写操作进度条：细条贴在画布顶部，不挤压布局 */
.chain-progress {
  height: 2px;
  background: #e4e7ed;
  overflow: hidden;
  flex-shrink: 0;
}
.chain-progress span {
  display: block;
  width: 30%;
  height: 100%;
  background: #409eff;
  animation: chain-progress-slide 1.1s ease-in-out infinite;
}
@keyframes chain-progress-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(360%); }
}
@media (prefers-reduced-motion: reduce) {
  .chain-progress span { animation: none; width: 100%; opacity: 0.6; }
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
/* ---- 首次配置加载遮罩 ---- */
.main-loading {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: #f5f7fa;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}
.main-loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #dcdfe6;
  border-top-color: #409eff;
  border-radius: 50%;
  /* 旋转持续进行；淡入延迟 200ms，请求快于 200ms 返回时用户看不到 spinner 闪烁 */
  animation: loading-spin 0.8s linear infinite, loading-fade 0.2s ease 0.2s forwards;
  opacity: 0;
}
.main-loading-text {
  font-size: 13px;
  color: #909399;
  margin: 0;
  animation: loading-fade 0.2s ease 0.2s forwards;
  opacity: 0;
}
.main-loading-error {
  font-size: 14px;
  color: #f56c6c;
  margin: 0;
}
.main-loading-retry {
  padding: 8px 24px;
  background: #409eff;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.main-loading-retry:hover {
  opacity: 0.85;
}
@keyframes loading-spin {
  to { transform: rotate(360deg); }
}
@keyframes loading-fade {
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .main-loading-spinner,
  .main-loading-text {
    animation: none;
    opacity: 1;
  }
}
</style>
