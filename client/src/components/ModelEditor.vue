<template>
  <div class="model-editor">
    <div class="form-group">
      <label>显示名称</label>
      <input v-model="form.display_name" placeholder="例如: DeepSeek 官方 / 阿里云" />
    </div>

    <div class="form-group">
      <label>模型 ID <span class="required">*</span></label>
      <input v-model="form.model_id" placeholder="例如: deepseek-chat / deepseek-v3" />
      <div class="field-hint">转发给上游 API 的实际模型名称</div>
    </div>

    <div class="form-group">
      <label>上游接口</label>
      <input v-model="form.endpoint.url" placeholder="https://api.example.com/v1" />
    </div>

    <div class="form-group">
      <label>API Key</label>
      <input v-model="form.endpoint.api_key" type="password" placeholder="API Key（可为空）" />
    </div>

    <div class="form-row-inline">
      <label class="checkbox">
        <input type="checkbox" v-model="form.thinking_enabled" />
        <span>强制启用 Thinking</span>
      </label>

      <select v-if="form.thinking_enabled" v-model="form.effort" class="effort-select">
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
        <option value="max">max</option>
      </select>

      <label class="checkbox">
        <input type="checkbox" v-model="form.ssl_verify" />
        <span>SSL 验证</span>
      </label>

      <label class="timeout-field">
        <span>超时(秒)</span>
        <input
          v-model.number="form.endpoint_timeout"
          type="number"
          min="1"
          max="600"
          class="timeout-input"
        />
      </label>
    </div>

    <!-- 测试结果弹窗 -->
    <Teleport to="body">
      <div v-if="showTestResult" class="test-result-overlay" @click.self="showTestResult = false">
        <div class="test-result-box">
          <div class="test-result-header">
            <h3>测试结果</h3>
            <button class="modal-close" @click="showTestResult = false">✕</button>
          </div>
          <div class="test-result-body">
            <div class="test-status" :class="testResult.success ? 'success' : 'fail'">
              <span class="status-dot"></span>
              <span>{{ testResult.success ? '测试成功' : '测试失败' }}</span>
              <span v-if="testResult.status" class="status-code">HTTP {{ testResult.status }}</span>
            </div>
            <div v-if="testResult.error" class="test-error">{{ testResult.error }}</div>
            <div v-if="testResult.response" class="test-response">
              <div class="response-label">响应内容</div>
              <pre class="response-body">{{ formatResponse(testResult.response) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <div class="form-actions">
      <button class="btn-cancel" @click="$emit('cancel')">取消</button>
      <button class="btn-test" @click="handleTest" :disabled="testing">
        {{ testing ? '测试中...' : '测试' }}
      </button>
      <button class="btn-save" @click="handleSave">保存</button>
    </div>
  </div>
</template>

<script setup>
import { reactive, watch, ref } from 'vue'

const props = defineProps({
  model: { type: Object, default: () => ({}) },
  isNew: { type: Boolean, default: true }
})

const emit = defineEmits(['save', 'cancel'])

const testing = ref(false)
const showTestResult = ref(false)
const testResult = ref({ success: false, status: 0, response: null, error: '' })

const form = reactive({
  display_name: '',
  model_id: '',
  endpoint: { url: '', api_key: '' },
  thinking_enabled: true,
  effort: 'medium',
  ssl_verify: true,
  endpoint_timeout: 30
})

watch(() => props.model, (val) => {
  if (!val) return;
  let endpoint = { url: '', api_key: '' };
  if (val.endpoint && val.endpoint.url) {
    endpoint = {
      url: val.endpoint.url || '',
      api_key: val.endpoint.api_key !== undefined ? val.endpoint.api_key : ''
    };
  } else if (val.upstream) {
    endpoint = { url: val.upstream, api_key: val.api_key || '' };
  } else if (Array.isArray(val.endpoints) && val.endpoints.length > 0) {
    endpoint = {
      url: val.endpoints[0].url || '',
      api_key: val.endpoints[0].api_key || ''
    };
  }
  Object.assign(form, {
    display_name: val.display_name || val.name || '',
    model_id: val.model_id || '',
    endpoint,
    thinking_enabled: val.thinking_enabled !== false,
    effort: val.effort || 'medium',
    ssl_verify: val.ssl_verify !== false,
    endpoint_timeout: val.endpoint_timeout !== undefined ? val.endpoint_timeout : 30
  });
}, { immediate: true })

function handleSave() {
  if (!form.display_name.trim()) return alert('请输入显示名称');
  if (!form.model_id.trim()) return alert('请输入模型 ID');
  const url = (form.endpoint.url || '').trim();
  if (!url) return alert('请输入端点 URL');
  emit('save', {
    display_name: form.display_name.trim(),
    model_id: form.model_id.trim(),
    endpoint: {
      url,
      api_key: (form.endpoint.api_key || '').trim()
    },
    thinking_enabled: form.thinking_enabled,
    effort: form.effort,
    ssl_verify: form.ssl_verify,
    endpoint_timeout: form.endpoint_timeout
  });
}

async function handleTest() {
  const url = (form.endpoint.url || '').trim();
  if (!form.model_id.trim()) return alert('请输入模型 ID');
  if (!url) return alert('请输入端点 URL');

  testing.value = true;
  showTestResult.value = false;

  try {
    const res = await fetch('/api/models/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: { url, api_key: (form.endpoint.api_key || '').trim() },
        model_id: form.model_id.trim(),
        thinking_enabled: form.thinking_enabled,
        effort: form.effort,
        ssl_verify: form.ssl_verify,
        endpoint_timeout: form.endpoint_timeout
      })
    });
    const data = await res.json();
    testResult.value = data;
  } catch (err) {
    testResult.value = { success: false, status: 0, response: null, error: err.message };
  } finally {
    testing.value = false;
    showTestResult.value = true;
  }
}

function formatResponse(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}
</script>

<style scoped>
.model-editor {
  padding: 16px;
}
.form-group {
  margin-bottom: 14px;
}
.form-group label {
  display: block;
  font-size: 12px;
  color: #606266;
  margin-bottom: 6px;
  font-weight: 500;
}
.form-group input,
.form-group select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
  background: #fff;
  box-sizing: border-box;
}
.form-group input:focus,
.form-group select:focus {
  border-color: #409eff;
}
.required {
  color: #f56c6c;
}
.field-hint {
  font-size: 11px;
  color: #909399;
  margin-top: 4px;
}
.form-row-inline {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
  flex-wrap: wrap;
  padding: 10px 0;
  border-top: 1px solid #f2f3f5;
  border-bottom: 1px solid #f2f3f5;
}
.form-row-inline .effort-select {
  width: auto;
  min-width: 200px;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}
.timeout-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
}
.timeout-input {
  width: 70px;
  padding: 5px 6px;
  border: 1px solid #dcdfe6;
  border-radius: 3px;
  font-size: 12px;
  outline: none;
}
.timeout-input:focus {
  border-color: #409eff;
}
.checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
  margin-bottom: 0;
}
.checkbox input { cursor: pointer; }
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
.btn-cancel, .btn-save {
  padding: 7px 18px;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
  cursor: pointer;
  font-size: 13px;
}
.btn-cancel {
  background: #fff;
  color: #606266;
}
.btn-cancel:hover { color: #409eff; border-color: #c6e2ff; }
.btn-save {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}
.btn-save:hover { background: #337ecc; }
.btn-test {
  padding: 7px 18px;
  border-radius: 4px;
  border: 1px solid #e6a23c;
  background: #fdf6ec;
  color: #e6a23c;
  cursor: pointer;
  font-size: 13px;
}
.btn-test:hover:not(:disabled) { background: #faecd8; }
.btn-test:disabled { opacity: 0.6; cursor: not-allowed; }

/* 测试结果弹窗 */
.test-result-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.test-result-box {
  background: #fff;
  border-radius: 10px;
  width: 520px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0,0,0,0.2);
  overflow: hidden;
}
.test-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #e4e7ed;
  background: #fafafa;
}
.test-result-header h3 { font-size: 15px; font-weight: 600; color: #303133; }
.test-result-body { padding: 20px; overflow-y: auto; }
.test-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}
.test-status.success { color: #67c23a; }
.test-status.fail { color: #f56c6c; }
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.test-status.success .status-dot { background: #67c23a; }
.test-status.fail .status-dot { background: #f56c6c; }
.status-code {
  font-size: 12px;
  font-weight: 400;
  color: #909399;
  margin-left: 4px;
}
.test-error {
  font-size: 13px;
  color: #f56c6c;
  background: #fef0f0;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
  word-break: break-all;
}
.test-response { margin-top: 4px; }
.response-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}
.response-body {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 12px;
  font-size: 12px;
  font-family: 'Menlo', 'Consolas', monospace;
  color: #303133;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
}
</style>
