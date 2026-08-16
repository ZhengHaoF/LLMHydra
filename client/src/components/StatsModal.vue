<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div class="modal-container">
        <div class="modal-header">
          <h2>使用统计</h2>
          <button class="close-btn" @click="close">×</button>
        </div>

        <div class="modal-body">
          <!-- 总览 -->
          <div class="overview-section">
            <h3>总览</h3>
            <div class="overview-grid">
              <div class="stat-card">
                <div class="stat-label">总请求数</div>
                <div class="stat-value">{{ overview.total_requests }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">成功</div>
                <div class="stat-value success">{{ overview.success_count }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">失败</div>
                <div class="stat-value failure">{{ overview.failure_count }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">总 Token</div>
                <div class="stat-value">{{ formatNumber(overview.total_tokens) }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">成功率</div>
                <div class="stat-value" :class="getRateClass(overview.success_rate)">{{ overview.success_rate != null ? overview.success_rate + '%' : '-' }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">平均延迟</div>
                <div class="stat-value">{{ overview.avg_latency_ms != null ? overview.avg_latency_ms + 'ms' : '-' }}</div>
              </div>
            </div>
          </div>

          <!-- 成功率 -->
          <div class="trend-section">
            <div class="trend-header">
              <h3>成功率</h3>
              <div class="trend-tabs">
                <button :class="['trend-tab', { active: chartMode === 'hourly' }]" @click="chartMode = 'hourly'">分时</button>
                <button :class="['trend-tab', { active: chartMode === 'daily' }]" @click="chartMode = 'daily'">分日</button>
              </div>
            </div>
            <div class="trend-chart">
              <Line v-if="successRateData && successRateData.labels.length" :data="successRateData" :options="successRateOptions" />
              <div v-else class="empty">暂无数据</div>
            </div>
          </div>

          <!-- 模型筛选 -->
          <div class="model-selector" v-if="availableModels.length > 1">
            <button class="model-select-all" @click="toggleAllModels">
              {{ selectedModels.length === availableModels.length ? '取消全选' : '全选' }}
            </button>
            <label v-for="m in availableModels" :key="m.model_id" class="model-checkbox">
              <input type="checkbox" :value="m.model_id" v-model="selectedModels" />
              <span class="model-checkbox-label">{{ m.model_display || m.model_id }}</span>
            </label>
          </div>

          <!-- 调用次数 -->
          <div class="trend-section">
            <div class="trend-header">
              <h3>调用次数</h3>
            </div>
            <div class="trend-chart">
              <Bar v-if="volumeData && volumeData.labels.length" :data="volumeData" :options="volumeOptions" />
              <div v-else class="empty">暂无数据</div>
            </div>
          </div>

          <!-- 调用量 -->
          <div class="trend-section">
            <div class="trend-header">
              <h3>调用量</h3>
            </div>
            <div class="trend-chart">
              <Bar v-if="tokenVolumeData && tokenVolumeData.labels.length" :data="tokenVolumeData" :options="tokenVolumeOptions" />
              <div v-else class="empty">暂无数据</div>
            </div>
          </div>

          <!-- 按模型统计 -->
          <div class="models-section">
            <h3>按模型统计</h3>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>请求数</th>
                    <th>成功</th>
                    <th>失败</th>
                    <th>跳过</th>
                    <th>成功率</th>
                    <th>平均延迟</th>
                    <th>Token</th>
                    <th>最后使用</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in modelStats" :key="m.model_id">
                    <td>{{ m.model_display || m.model_id }}</td>
                    <td>{{ m.total_requests }}</td>
                    <td class="success">{{ m.success_count }}</td>
                    <td class="failure">{{ m.failure_count }}</td>
                    <td>{{ m.skipped_count }}</td>
                    <td :class="getRateClass(m.success_rate)">{{ m.success_rate != null ? m.success_rate + '%' : '-' }}</td>
                    <td>{{ m.avg_latency_ms != null ? m.avg_latency_ms + 'ms' : '-' }}</td>
                    <td>{{ formatNumber(m.total_tokens) }}</td>
                    <td>{{ formatTime(m.last_used) }}</td>
                  </tr>
                  <tr v-if="modelStats.length === 0">
                    <td colspan="9" class="empty">暂无数据</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 按配置组统计 -->
          <div class="groups-section">
            <h3>按配置组统计</h3>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>配置组</th>
                    <th>请求数</th>
                    <th>成功</th>
                    <th>失败</th>
                    <th>跳过</th>
                    <th>成功率</th>
                    <th>平均延迟</th>
                    <th>Token</th>
                    <th>最后使用</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="g in groupStats" :key="g.group_id">
                    <td>{{ g.group_id }}</td>
                    <td>{{ g.total_requests }}</td>
                    <td class="success">{{ g.success_count }}</td>
                    <td class="failure">{{ g.failure_count }}</td>
                    <td>{{ g.skipped_count }}</td>
                    <td :class="getRateClass(g.success_rate)">{{ g.success_rate != null ? g.success_rate + '%' : '-' }}</td>
                    <td>{{ g.avg_latency_ms != null ? g.avg_latency_ms + 'ms' : '-' }}</td>
                    <td>{{ formatNumber(g.total_tokens) }}</td>
                    <td>{{ formatTime(g.last_used) }}</td>
                  </tr>
                  <tr v-if="groupStats.length === 0">
                    <td colspan="9" class="empty">暂无数据</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 最近请求 -->
          <div class="recent-section">
            <h3>最近请求</h3>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>配置组</th>
                    <th>模型</th>
                    <th>状态</th>
                    <th>Token</th>
                    <th>耗时</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in recentRequests" :key="r.id">
                    <td>{{ formatTime(r.ts) }}</td>
                    <td>{{ r.group_id }}</td>
                    <td>{{ r.model_display || r.model_id }}</td>
                    <td :class="r.status">{{ statusText(r.status) }}</td>
                    <td>{{ formatNumber(r.total_tokens) }}</td>
                    <td>{{ r.latency_ms ? r.latency_ms + 'ms' : '-' }}</td>
                  </tr>
                  <tr v-if="recentRequests.length === 0">
                    <td colspan="6" class="empty">暂无数据</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-danger" @click="confirmClear">清空统计</button>
          <button class="btn-primary" @click="close">关闭</button>
        </div>
      </div>
    </div>

    <!-- 确认清空弹窗 -->
    <Teleport to="body">
      <div v-if="showConfirm" class="confirm-overlay" @click.self="showConfirm = false">
        <div class="confirm-box">
          <div class="confirm-title">确认清空</div>
          <div class="confirm-body">
            确定要清空所有统计数据吗?<br>
            <span style="color:#e6a23c;font-size:12px">此操作不可恢复。</span>
          </div>
          <div class="confirm-actions">
            <button class="btn-cancel" @click="showConfirm = false">取消</button>
            <button class="btn-danger" @click="doClear">确认清空</button>
          </div>
        </div>
      </div>
    </Teleport>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import api from '../api.js'
import { Bar, Line } from 'vue-chartjs'
import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, LineElement, PointElement } from 'chart.js'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, LineElement, PointElement)

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['close'])

const overview = ref({
  total_requests: 0,
  success_count: 0,
  failure_count: 0,
  total_tokens: 0
})
const modelStats = ref([])
const groupStats = ref([])
const recentRequests = ref([])
const showConfirm = ref(false)
const chartMode = ref('hourly')
const hourlyStats = ref([])
const dailyStats = ref([])
const selectedModels = ref([])
let eventSource = null

const COLOR_PALETTE = [
  '#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399',
  '#b37feb', '#36cfc9', '#ff85c0', '#ffc53d', '#73d13d'
]

function pad2(n) {
  return String(n).padStart(2, '0')
}

function buildHourLabels(n) {
  const labels = []
  const now = new Date()
  now.setMinutes(0, 0, 0)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600 * 1000)
    labels.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00`)
  }
  return labels
}

function buildDayLabels(n) {
  const labels = []
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400 * 1000)
    labels.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)
  }
  return labels
}

const availableModels = computed(() => {
  const rows = chartMode.value === 'hourly' ? hourlyStats.value : dailyStats.value
  const seen = new Map()
  for (const r of rows) {
    if (!seen.has(r.model_id)) {
      seen.set(r.model_id, { model_id: r.model_id, model_display: r.model_display || '' })
    }
  }
  return [...seen.values()]
})

watch(availableModels, (models) => {
  const ids = models.map((m) => m.model_id)
  // 保留已选中且仍存在的，新出现的自动选中
  const valid = selectedModels.value.filter((id) => ids.includes(id))
  const newcomers = ids.filter((id) => !selectedModels.value.includes(id))
  selectedModels.value = [...valid, ...newcomers]
}, { immediate: true })

function toggleAllModels() {
  const ids = availableModels.value.map((m) => m.model_id)
  selectedModels.value = selectedModels.value.length === ids.length ? [] : ids
}

// ---- 成功率 ----
const successRateData = computed(() => {
  const rows = chartMode.value === 'hourly' ? hourlyStats.value : dailyStats.value
  if (!rows.length) return null
  const key = chartMode.value === 'hourly' ? 'hour' : 'day'
  const labels = chartMode.value === 'hourly' ? buildHourLabels(24) : buildDayLabels(30)
  const map = {}
  for (const r of rows) {
    if (!map[r[key]]) map[r[key]] = { sumRate: 0, sumReq: 0 }
    const req = r.requests || 0
    map[r[key]].sumRate += (r.success_rate || 0) * req
    map[r[key]].sumReq += req
  }
  return {
    labels,
    datasets: [{
      label: '成功率',
      data: labels.map((l) => {
        const b = map[l]
        return b && b.sumReq ? +(b.sumRate / b.sumReq).toFixed(2) : 0
      }),
      borderColor: '#409eff',
      backgroundColor: 'rgba(64,158,255,0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5
    }]
  }
})

const successRateOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      mode: 'index',
      intersect: false,
      callbacks: {
        label: (ctx) => `成功率: ${ctx.parsed.y}%`
      }
    }
  },
  scales: {
    x: {
      ticks: {
        maxTicksLimit: 12,
        callback: function (val) {
          const label = this.getLabelForValue(val)
          return chartMode.value === 'hourly' ? label.slice(11) : label.slice(5)
        }
      }
    },
    y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }
  }
}

// ---- 调用量 ----
const volumeData = computed(() => {
  const rows = chartMode.value === 'hourly' ? hourlyStats.value : dailyStats.value
  if (!rows.length || !selectedModels.value.length) return null
  const key = chartMode.value === 'hourly' ? 'hour' : 'day'
  const labels = chartMode.value === 'hourly' ? buildHourLabels(24) : buildDayLabels(30)
  // model_id → { timeKey → requests }
  const modelTimeMap = {}
  for (const r of rows) {
    if (!selectedModels.value.includes(r.model_id)) continue
    if (!modelTimeMap[r.model_id]) modelTimeMap[r.model_id] = {}
    modelTimeMap[r.model_id][r[key]] = (modelTimeMap[r.model_id][r[key]] || 0) + (r.requests || 0)
  }
  const selected = availableModels.value.filter((m) => selectedModels.value.includes(m.model_id))
  return {
    labels,
    datasets: selected.map((m, i) => ({
      label: m.model_display || m.model_id,
      data: labels.map((l) => (modelTimeMap[m.model_id] || {})[l] || 0),
      backgroundColor: COLOR_PALETTE[i % COLOR_PALETTE.length],
      stack: 'volume'
    }))
  }
})

const volumeOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}`
      }
    }
  },
  scales: {
    x: {
      stacked: true,
      ticks: {
        maxTicksLimit: 12,
        callback: function (val) {
          const label = this.getLabelForValue(val)
          return chartMode.value === 'hourly' ? label.slice(11) : label.slice(5)
        }
      }
    },
    y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
  }
}

// ---- 调用量 (Token) ----
const tokenVolumeData = computed(() => {
  const rows = chartMode.value === 'hourly' ? hourlyStats.value : dailyStats.value
  if (!rows.length || !selectedModels.value.length) return null
  const key = chartMode.value === 'hourly' ? 'hour' : 'day'
  const labels = chartMode.value === 'hourly' ? buildHourLabels(24) : buildDayLabels(30)
  const modelTimeMap = {}
  for (const r of rows) {
    if (!selectedModels.value.includes(r.model_id)) continue
    if (!modelTimeMap[r.model_id]) modelTimeMap[r.model_id] = {}
    modelTimeMap[r.model_id][r[key]] = (modelTimeMap[r.model_id][r[key]] || 0) + (r.total_tokens || 0)
  }
  const selected = availableModels.value.filter((m) => selectedModels.value.includes(m.model_id))
  return {
    labels,
    datasets: selected.map((m, i) => ({
      label: m.model_display || m.model_id,
      data: labels.map((l) => (modelTimeMap[m.model_id] || {})[l] || 0),
      backgroundColor: COLOR_PALETTE[i % COLOR_PALETTE.length],
      stack: 'volume'
    }))
  }
})

const tokenVolumeOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${(ctx.parsed.y / 1e6).toFixed(2)}M`
      }
    }
  },
  scales: {
    x: {
      stacked: true,
      ticks: {
        maxTicksLimit: 12,
        callback: function (val) {
          const label = this.getLabelForValue(val)
          return chartMode.value === 'hourly' ? label.slice(11) : label.slice(5)
        }
      }
    },
    y: {
      stacked: true,
      beginAtZero: true,
      ticks: {
        callback: (v) => v === 0 ? '0' : (v / 1e6).toFixed(1) + 'M'
      }
    }
  }
}

async function loadStats() {
  try {
    const [ov, ms, gs, rr, hourlyRes, dailyRes] = await Promise.all([
      api.getStatsOverview(),
      api.getStatsModels(),
      api.getStatsGroups(),
      api.getStatsRecent(50),
      api.getStatsHourly(24),
      api.getStatsDaily(30)
    ])
    overview.value = ov
    modelStats.value = ms.models || []
    groupStats.value = gs.groups || []
    recentRequests.value = rr.requests || []
    hourlyStats.value = hourlyRes.hourly || []
    dailyStats.value = dailyRes.daily || []
  } catch (e) {
    console.error('加载统计失败:', e)
  }
}

// 建立 SSE 连接，收到统计更新事件后自动刷新
function connectSSE() {
  if (eventSource) return
  eventSource = new EventSource('/api/logs/stream')

  eventSource.onmessage = (e) => {
    try {
      const entry = JSON.parse(e.data)
      if (entry.type === 'stats') loadStats()
    } catch (err) {
      console.error('解析统计事件失败:', err)
    }
  }

  eventSource.onerror = () => {
    // SSE 断开自动重连，无需额外处理
  }
}

function disconnectSSE() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

watch(() => props.visible, (val) => {
  if (val) {
    loadStats()
    connectSSE()
  } else {
    disconnectSSE()
  }
})

onUnmounted(() => {
  disconnectSSE()
})

function close() {
  emit('close')
}

function confirmClear() {
  showConfirm.value = true
}

async function doClear() {
  try {
    await api.clearStats()
    showConfirm.value = false
    await loadStats()
  } catch (e) {
    console.error('清空统计失败:', e)
  }
}

function formatNumber(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

function formatTime(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前'
  return d.toLocaleDateString('zh-CN')
}

function statusText(status) {
  const map = { success: '成功', failure: '失败', skipped: '跳过' }
  return map[status] || status
}

function getRateClass(rate) {
  if (rate == null) return ''
  if (rate >= 95) return 'success'
  if (rate >= 80) return 'warning'
  return 'failure'
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
  width: 90%;
  max-width: 1000px;
  max-height: 90vh;
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
  font-size: 20px;
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

.overview-section,
.trend-section,
.models-section,
.groups-section,
.recent-section {
  margin-bottom: 32px;
}

.overview-section h3,
.trend-section h3,
.models-section h3,
.groups-section h3,
.recent-section h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.trend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.trend-header h3 {
  margin: 0;
}

.trend-tabs {
  display: flex;
  gap: 8px;
}

.trend-tab {
  padding: 4px 16px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.trend-tab:hover {
  color: #409eff;
  border-color: #c6e2ff;
}

.trend-tab.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}

.trend-chart {
  height: 300px;
  width: 100%;
}

.model-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: #f5f7fa;
  border-radius: 6px;
}

.model-select-all {
  padding: 2px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.model-select-all:hover {
  color: #409eff;
  border-color: #c6e2ff;
}

.model-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
}

.model-checkbox input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: #409eff;
}

.model-checkbox-label {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.stat-card {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 20px;
  text-align: center;
}

.stat-label {
  font-size: 13px;
  color: #909399;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
}

.stat-value.success {
  color: #67c23a;
}

.stat-value.failure {
  color: #f56c6c;
}

.stat-value.warning {
  color: #e6a23c;
}

.table-container {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

thead {
  background: #f5f7fa;
}

th {
  padding: 12px;
  text-align: left;
  font-weight: 600;
  color: #606266;
  border-bottom: 2px solid #e4e7ed;
}

td {
  padding: 12px;
  border-bottom: 1px solid #e4e7ed;
  color: #303133;
}

td.success {
  color: #67c23a;
}

td.failure {
  color: #f56c6c;
}

td.warning {
  color: #e6a23c;
}

td.empty {
  text-align: center;
  color: #909399;
  padding: 32px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 24px;
  border-top: 1px solid #e4e7ed;
}

.btn-primary,
.btn-danger {
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

.btn-danger {
  background: #f56c6c;
  color: #fff;
}

.btn-danger:hover {
  background: #f78989;
}

.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.confirm-box {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  min-width: 340px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.confirm-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
}

.confirm-body {
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
  margin-bottom: 20px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-cancel {
  padding: 7px 20px;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
  background: #fff;
  color: #606266;
  cursor: pointer;
  font-size: 13px;
}

.btn-cancel:hover {
  color: #409eff;
  border-color: #c6e2ff;
}
</style>
