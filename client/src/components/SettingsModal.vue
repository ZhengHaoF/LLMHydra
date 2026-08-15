<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div class="modal-container">
        <div class="modal-header">
          <h2>设置</h2>
          <button class="close-btn" @click="close">×</button>
        </div>

        <div class="modal-body">
          <div class="section">
            <h3>熔断器配置</h3>
            <p class="section-desc">当某个端点连续失败达到阈值后，自动跳过该端点一段时间。</p>

            <div class="form-group">
              <label>失败阈值</label>
              <div class="form-row">
                <input
                  type="number"
                  v-model.number="form.circuit_breaker_threshold"
                  :min="1"
                  :max="100"
                  class="form-input"
                />
                <span class="form-suffix">次</span>
                <span class="form-hint">连续失败多少次后触发熔断 (1-100)</span>
              </div>
            </div>

            <div class="form-group">
              <label>熔断时长</label>
              <div class="form-row">
                <input
                  type="number"
                  v-model.number="form.circuit_breaker_duration_min"
                  :min="1"
                  :max="1440"
                  class="form-input"
                />
                <span class="form-suffix">分钟</span>
                <span class="form-hint">熔断后跳过多久再试探 (1-1440)</span>
              </div>
            </div>
          </div>

          <div class="section">
            <h3>OpenRouter 模型库</h3>
            <p class="section-desc">
              拉取 OpenRouter 公开的模型列表，编辑模型时可根据 model_id 自动匹配上下文窗口和最大输入/输出 token（参考值，可手动修改）。
            </p>

            <div class="or-status">
              <span v-if="orCached.count > 0">
                已缓存 <strong>{{ orCached.count }}</strong> 个模型
                <span class="or-time">· 上次更新: {{ formatTime(orCached.fetched_at) }}</span>
              </span>
              <span v-else class="or-empty">尚未拉取</span>
            </div>

            <div class="or-actions">
              <button class="btn-primary" @click="refreshOpenRouter" :disabled="refreshing">
                {{ refreshing ? '拉取中...' : '拉取模型列表' }}
              </button>
              <span v-if="orError" class="or-error">{{ orError }}</span>
              <span v-else-if="orSuccess" class="or-success">{{ orSuccess }}</span>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-danger" @click="confirmLogout">退出登录</button>
          <button class="btn-cancel" @click="resetDefaults">恢复默认</button>
          <div class="spacer"></div>
          <button class="btn-cancel" @click="close">取消</button>
          <button class="btn-primary" @click="save" :disabled="saving">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'
import api from '../api.js'

const DEFAULTS = {
  circuit_breaker_threshold: 3,
  circuit_breaker_duration_min: 5
}

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'saved', 'logout'])

const form = ref({ ...DEFAULTS })
const saving = ref(false)

// OpenRouter 模型库状态
const orCached = ref({ fetched_at: null, count: 0, models: [] })
const refreshing = ref(false)
const orError = ref('')
const orSuccess = ref('')

async function loadSettings() {
  try {
    const s = await api.getSettings()
    form.value = {
      circuit_breaker_threshold: s.circuit_breaker_threshold ?? DEFAULTS.circuit_breaker_threshold,
      circuit_breaker_duration_min: s.circuit_breaker_duration_min ?? DEFAULTS.circuit_breaker_duration_min
    }
  } catch (e) {
    console.error('加载设置失败:', e)
  }
}

async function loadOpenRouterStatus() {
  try {
    const data = await api.getOpenRouterModels()
    orCached.value = {
      fetched_at: data?.fetched_at || null,
      count: data?.count || 0,
      models: data?.models || []
    }
  } catch (e) {
    console.error('加载 OpenRouter 模型库状态失败:', e)
  }
}

function formatTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch {
    return iso
  }
}

async function refreshOpenRouter() {
  refreshing.value = true
  orError.value = ''
  orSuccess.value = ''
  try {
    const data = await api.refreshOpenRouterModels()
    orSuccess.value = `成功拉取 ${data.count} 个模型`
    await loadOpenRouterStatus()
  } catch (e) {
    orError.value = e.message || '拉取失败'
  } finally {
    refreshing.value = false
  }
}

watch(() => props.visible, (val) => {
  if (val) {
    loadSettings()
    loadOpenRouterStatus()
  }
})

function close() {
  emit('close')
}

function confirmLogout() {
  if (window.confirm('确定要退出登录吗？')) {
    emit('logout')
  }
}

function resetDefaults() {
  form.value = { ...DEFAULTS }
}

async function save() {
  saving.value = true
  try {
    await api.updateSettings(form.value)
    emit('saved')
    close()
  } catch (e) {
    console.error('保存设置失败:', e)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-container {
  background: #fff;
  border-radius: 12px;
  width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #e4e7ed;
}

.modal-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.close-btn {
  background: none;
  border: none;
  font-size: 28px;
  color: #909399;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  background: #f5f7fa;
  color: #303133;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.section h3 {
  margin: 0 0 4px 0;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.section-desc {
  margin: 0 0 20px 0;
  font-size: 13px;
  color: #909399;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 8px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-input {
  width: 100px;
  padding: 8px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 14px;
  color: #303133;
  outline: none;
  transition: border-color 0.15s;
}

.form-input:focus {
  border-color: #409eff;
}

.form-suffix {
  font-size: 13px;
  color: #606266;
}

.form-hint {
  font-size: 12px;
  color: #909399;
}

.modal-footer {
  display: flex;
  align-items: center;
  padding: 16px 24px;
  border-top: 1px solid #e4e7ed;
  gap: 12px;
}

.spacer {
  flex: 1;
}

.btn-primary,
.btn-cancel,
.btn-danger {
  padding: 8px 20px;
  border-radius: 6px;
  border: none;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-danger {
  background: #f56c6c;
  color: #fff;
}

.btn-danger:hover {
  background: #f78989;
}

.btn-primary {
  background: #409eff;
  color: #fff;
}

.btn-primary:hover {
  background: #66b1ff;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-cancel {
  background: #f5f7fa;
  color: #606266;
  border: 1px solid #dcdfe6;
}

.btn-cancel:hover {
  color: #409eff;
  border-color: #c6e2ff;
}

.or-status {
  font-size: 13px;
  color: #606266;
  margin-bottom: 12px;
}
.or-status strong {
  color: #303133;
  font-weight: 600;
}
.or-time {
  color: #909399;
  margin-left: 4px;
}
.or-empty {
  color: #909399;
  font-style: italic;
}
.or-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.or-error {
  font-size: 12px;
  color: #f56c6c;
}
.or-success {
  font-size: 12px;
  color: #67c23a;
}
</style>
