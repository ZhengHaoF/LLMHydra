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
        </div>

        <div class="modal-footer">
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

const emit = defineEmits(['close', 'saved'])

const form = ref({ ...DEFAULTS })
const saving = ref(false)

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

watch(() => props.visible, (val) => {
  if (val) loadSettings()
})

function close() {
  emit('close')
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
.btn-cancel {
  padding: 8px 20px;
  border-radius: 6px;
  border: none;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
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
</style>
