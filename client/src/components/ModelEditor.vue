<template>
  <div class="model-editor">
    <div class="form-group">
      <label>显示名称</label>
      <input v-model="form.display_name" placeholder="例如: DeepSeek 官方 / 阿里云" />
    </div>

    <div class="form-group">
      <label>模型 ID <span class="required">*</span></label>
      <div class="model-id-row">
        <input
          v-model="form.model_id"
          placeholder="例如: deepseek-chat / openai/gpt-4o"
          class="model-id-input"
        />
        <button
          type="button"
          class="btn-match"
          @click="handleMatch(true)"
          :disabled="matching"
          :title="orLoaded ? '根据本地 OpenRouter 模型库匹配' : '本地未缓存，请先在设置中拉取模型列表'"
        >
          {{ matching ? '匹配中...' : '尝试匹配' }}
        </button>
      </div>
      <div class="field-hint">
        转发给上游 API 的实际模型名称。输入后会自动尝试从本地 OpenRouter 模型库匹配（仅在字段为空时填入）。
        <span v-if="matchHint" class="match-hint" :class="matchHintType">{{ matchHint }}</span>
      </div>
    </div>

    <div class="form-group or-ref-group">
      <label class="or-ref-label">
        OpenRouter 参考值
        <span class="or-ref-tip">（仅展示参考，可手动修改）</span>
      </label>
      <div class="or-ref-row">
        <label class="or-ref-field">
          <span class="or-ref-name">上下文窗口总长</span>
          <input
            v-model.number="form.context_length"
            type="number"
            min="0"
            class="or-ref-input"
            placeholder="如 128000"
          />
        </label>
        <label class="or-ref-field">
          <span class="or-ref-name">最大输入（参考）</span>
          <input
            v-model.number="form.max_input_tokens"
            type="number"
            min="0"
            class="or-ref-input"
            placeholder="context - max_output"
          />
        </label>
        <label class="or-ref-field">
          <span class="or-ref-name">最大输出（参考）</span>
          <input
            v-model.number="form.max_output_tokens"
            type="number"
            min="0"
            class="or-ref-input"
            placeholder="如 4096"
          />
        </label>
      </div>
    </div>

    <div class="form-group">
      <label>上游接口</label>
      <div class="endpoint-row">
        <input v-model="form.endpoint.url" placeholder="https://api.example.com/v1" class="endpoint-input" />
        <select v-model="form.api_type" class="protocol-select">
          <option value="openai">OpenAI协议（/v1/chat/completions）</option>
          <option value="anthropic">Anthropic协议（/v1/messages）</option>
        </select>
      </div>
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
            <button class="modal-close" @click="showTestResult = false"><IconX :size="16" /></button>
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
import { reactive, watch, ref, onMounted } from 'vue'
import { IconX } from '@tabler/icons-vue'
import api from '../api.js'

// 简单模块级缓存：避免每次打开编辑弹窗都拉一次
// 注意：请求失败时不要写 _orCache，让下次 handleMatch 重新尝试，
//       并把真实错误暴露到 console，方便排查
let _orCache = null
let _orCachePromise = null
async function getOrCache() {
  if (_orCache) return _orCache
  if (_orCachePromise) return _orCachePromise
  _orCachePromise = api.getOpenRouterModels()
    .then((data) => {
      _orCache = data || { fetched_at: null, count: 0, models: [] }
      return _orCache
    })
    .catch((e) => {
      console.error('[ModelEditor] 加载 OpenRouter 模型库失败:', e?.message || e)
      // 不写 _orCache：保持 null，下次 handleMatch 会重新请求
      // 给本次调用返回一个空对象，让外层判断逻辑走「请先在设置中拉取」分支
      return { fetched_at: null, count: 0, models: [] }
    })
    .finally(() => { _orCachePromise = null })
  return _orCachePromise
}

const props = defineProps({
  model: { type: Object, default: () => ({}) },
  isNew: { type: Boolean, default: true }
})

const emit = defineEmits(['save', 'cancel'])

const testing = ref(false)
const showTestResult = ref(false)
const testResult = ref({ success: false, status: 0, response: null, error: '' })

// 匹配相关
const orLoaded = ref(false)         // 本地是否已缓存模型库
const matching = ref(false)
const matchHint = ref('')
const matchHintType = ref('info')   // info | success | warn
let matchDebounceTimer = null

const form = reactive({
  display_name: '',
  model_id: '',
  endpoint: { url: '', api_key: '' },
  thinking_enabled: true,
  effort: 'medium',
  ssl_verify: true,
  endpoint_timeout: 30,
  api_type: 'openai',
  // OpenRouter 参考值
  context_length: null,
  max_input_tokens: null,
  max_output_tokens: null
})

onMounted(async () => {
  const cached = await getOrCache()
  orLoaded.value = (cached && cached.count > 0)
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
    endpoint_timeout: val.endpoint_timeout !== undefined ? val.endpoint_timeout : 30,
    api_type: ['openai', 'anthropic'].includes(val.api_type) ? val.api_type : 'openai',
    context_length: val.context_length ?? null,
    max_input_tokens: val.max_input_tokens ?? null,
    max_output_tokens: val.max_output_tokens ?? null
  });
}, { immediate: true })

// model_id 变化时防抖自动匹配
watch(() => form.model_id, (val) => {
  if (matchDebounceTimer) clearTimeout(matchDebounceTimer)
  if (!val || !val.trim()) {
    matchHint.value = ''
    return
  }
  matchDebounceTimer = setTimeout(() => {
    handleMatch(false)
  }, 500)
})

// 本地缓存匹配（不需要走服务端）
function localMatch(modelId) {
  if (!_orCache || !Array.isArray(_orCache.models) || _orCache.models.length === 0) return null
  const target = modelId.trim().toLowerCase()
  const list = _orCache.models
  // 精确
  let hit = list.find((m) => m.id.toLowerCase() === target)
  if (hit) return toMatchResult(hit)
  // 模糊：忽略厂商前缀
  const suffixes = list
    .map((m) => ({ m, idLower: m.id.toLowerCase() }))
    .filter((x) => x.idLower.endsWith('/' + target) || x.idLower === target)
  if (suffixes.length > 0) {
    suffixes.sort((a, b) => a.m.id.length - b.m.id.length)
    return toMatchResult(suffixes[0].m)
  }
  return null
}

function toMatchResult(m) {
  const context = m.context_length
  const output = m.max_output_tokens
  let input = null
  if (typeof context === 'number' && typeof output === 'number') {
    const v = context - output
    input = v > 0 ? v : null
  }
  return {
    id: m.id,
    name: m.name,
    context_length: context,
    max_output_tokens: output,
    max_input_tokens: input
  }
}

function showMatchHint(text, type = 'info') {
  matchHint.value = text
  matchHintType.value = type
}

// manual=true：立即触发（按钮点击）
// manual=false：自动触发（防抖后的），不显示 "未匹配" 提示避免打扰
async function handleMatch(manual) {
  const modelId = (form.model_id || '').trim()
  if (!modelId) {
    if (manual) showMatchHint('请先输入模型 ID', 'warn')
    return
  }
  if (!_orCache || !_orCache.count) {
    // 懒加载一次
    await getOrCache()
    orLoaded.value = (_orCache && _orCache.count > 0)
  }
  if (!_orCache || !_orCache.count) {
    if (manual) showMatchHint('本地模型库为空，请先在设置中拉取', 'warn')
    return
  }
  matching.value = true
  try {
    const hit = localMatch(modelId)
    if (!hit) {
      if (manual) showMatchHint(`本地未匹配到「${modelId}」`, 'warn')
      else showMatchHint('', 'info')
      return
    }
    // 匹配成功：仅在字段为空时填入，避免覆盖用户已填值
    const filled = []
    const skipped = []
    if (form.context_length === null || form.context_length === undefined || form.context_length === '') {
      if (hit.context_length !== null) { form.context_length = hit.context_length; filled.push('上下文窗口') }
    } else if (hit.context_length !== null) {
      skipped.push('上下文窗口')
    }
    if (form.max_input_tokens === null || form.max_input_tokens === undefined || form.max_input_tokens === '') {
      if (hit.max_input_tokens !== null) { form.max_input_tokens = hit.max_input_tokens; filled.push('最大输入') }
    } else if (hit.max_input_tokens !== null) {
      skipped.push('最大输入')
    }
    if (form.max_output_tokens === null || form.max_output_tokens === undefined || form.max_output_tokens === '') {
      if (hit.max_output_tokens !== null) { form.max_output_tokens = hit.max_output_tokens; filled.push('最大输出') }
    } else if (hit.max_output_tokens !== null) {
      skipped.push('最大输出')
    }
    let hint = `已匹配到 ${hit.id}`
    if (filled.length) hint += `，填入：${filled.join('、')}`
    if (skipped.length) hint += `（已填值未覆盖：${skipped.join('、')}）`
    if (!filled.length && skipped.length) hint = `已匹配到 ${hit.id}，但所有字段已有值，未覆盖`
    showMatchHint(hint, 'success')
  } finally {
    matching.value = false
  }
}

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
    endpoint_timeout: form.endpoint_timeout,
    api_type: form.api_type,
    context_length: form.context_length,
    max_input_tokens: form.max_input_tokens,
    max_output_tokens: form.max_output_tokens
  });
}

async function handleTest() {
  const url = (form.endpoint.url || '').trim();
  if (!form.model_id.trim()) return alert('请输入模型 ID');
  if (!url) return alert('请输入端点 URL');

  testing.value = true;
  showTestResult.value = false;

  try {
    const data = await api.testModel({
      endpoint: { url, api_key: (form.endpoint.api_key || '').trim() },
      model_id: form.model_id.trim(),
      thinking_enabled: form.thinking_enabled,
      effort: form.effort,
      ssl_verify: form.ssl_verify,
      endpoint_timeout: form.endpoint_timeout,
      api_type: form.api_type
    });
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
.match-hint {
  display: inline-block;
  margin-left: 6px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
}
.match-hint.success { color: #67c23a; background: #f0f9eb; }
.match-hint.warn    { color: #e6a23c; background: #fdf6ec; }
.match-hint.info    { color: #909399; }

/* 模型 ID 行：输入框 + 尝试匹配按钮 */
.model-id-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.model-id-row .model-id-input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
  background: #fff;
  box-sizing: border-box;
}
.model-id-row .model-id-input:focus {
  border-color: #409eff;
}
.btn-match {
  flex-shrink: 0;
  padding: 0 14px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #f5f7fa;
  color: #606266;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.btn-match:hover:not(:disabled) {
  color: #409eff;
  border-color: #c6e2ff;
  background: #ecf5ff;
}
.btn-match:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* OpenRouter 参考值分组 */
.or-ref-group {
  background: #fafbfc;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.or-ref-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 10px !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  color: #303133 !important;
}
.or-ref-tip {
  font-size: 11px;
  color: #909399;
  font-weight: 400;
}
.or-ref-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.or-ref-field {
  flex: 1;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 0 !important;
}
.or-ref-name {
  font-size: 11px;
  color: #909399;
}
.or-ref-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #dcdfe6;
  border-radius: 3px;
  font-size: 12px;
  outline: none;
  background: #fff;
  box-sizing: border-box;
  color: #606266;
}
.or-ref-input:focus {
  border-color: #409eff;
}
.or-ref-input::placeholder {
  color: #c0c4cc;
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

/* 上游接口行：URL 输入框 + 协议类型选择 */
.endpoint-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.endpoint-row .endpoint-input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
  background: #fff;
  box-sizing: border-box;
}
.endpoint-row .endpoint-input:focus {
  border-color: #409eff;
}
.endpoint-row .protocol-select {
  flex-shrink: 0;
  width: auto;
  padding: 8px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 13px;
  color: #606266;
  outline: none;
  cursor: pointer;
  background: #fff;
}
.endpoint-row .protocol-select:focus {
  border-color: #409eff;
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
.test-result-header .modal-close {
  background: none;
  border: none;
  font-size: 18px;
  color: #909399;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.test-result-header .modal-close:hover { color: #303133; background: #f0f0f0; }
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
