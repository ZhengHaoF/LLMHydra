<template>
  <div class="api-reference">
    <!-- 用户接入地址 -->
    <div class="hero-box">
      <div class="hero-label">AI 工具接入地址（复制下面地址填入工具的 Base URL）</div>
      <div class="hero-url-row">
        <code class="hero-url">http://localhost:{{ proxyPort }}</code>
        <button class="btn-copy" @click="copyUrl">复制</button>
      </div>
      <div class="hero-steps">
        <div class="step">① 在 AI 工具（Trae / Cursor / Cherry Studio 等）中找到 API Base URL 设置</div>
        <div class="step">② 填入 <code>http://localhost:{{ proxyPort }}</code>，不要加任何后缀路径</div>
        <div class="step">③ 管理 API 和代理运行在同一端口上，/api/* 为管理接口，其他路径自动代理</div>
      </div>
    </div>

    <!-- 管理 API -->
    <div class="api-section">
      <div class="section-title">
        <span class="badge badge-api">管理 API</span>
        <span class="section-port">localhost:{{ proxyPort }}/api</span>
      </div>

      <div class="table-wrap">
        <table class="api-table">
          <thead>
            <tr>
              <th class="col-method">方法</th>
              <th class="col-path">路径</th>
              <th class="col-desc">说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ep in apiEndpoints" :key="ep.id">
              <td><span class="ep-method" :class="ep.method">{{ ep.method }}</span></td>
              <td class="ep-path">{{ ep.path }}</td>
              <td class="ep-desc">{{ ep.desc }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- curl 示例 -->
    <div class="api-section">
      <div class="section-title">
        <span class="badge badge-proxy">AI 调用示例</span>
        <span class="section-port">/v1/chat/completions</span>
      </div>
      <div class="code-block">
        <code>curl http://localhost:{{ proxyPort }}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4","messages":[{"role":"user","content":"你好"}],"stream":true}'</code>
      </div>
      <p class="proxy-note">所有非 /api/* 的请求自动代理到上游模型。支持 <code>/v1/chat/completions</code> 和 <code>/chat/completions</code> 两种路径写法。</p>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  proxyPort: { type: Number, default: 8093 }
})

function copyUrl() {
  const url = `http://localhost:${props.proxyPort}`
  navigator.clipboard.writeText(url).catch(() => {})
}

const apiEndpoints = [
  { id: 1,  method: 'GET',    path: '/api/models',                 desc: '获取所有模型配置' },
  { id: 2,  method: 'POST',   path: '/api/models',                 desc: '添加新模型' },
  { id: 3,  method: 'PUT',    path: '/api/models/:index',          desc: '更新指定索引的模型配置' },
  { id: 4,  method: 'DELETE', path: '/api/models/:index',          desc: '删除指定索引的模型' },
  { id: 5,  method: 'POST',   path: '/api/models/:index/select',   desc: '切换当前使用的模型' },
  { id: 6,  method: 'PUT',    path: '/api/config/port',            desc: '修改监听端口' },
  { id: 7,  method: 'POST',   path: '/api/restart',                desc: '重启服务' },
]
</script>

<style scoped>
.api-reference {
  padding: 24px 24px 20px;
}

/* ---- 接入地址 ---- */
.hero-box {
  background: linear-gradient(135deg, #ecf5ff 0%, #f0f7ff 100%);
  border: 1px solid #b3d8ff;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 24px;
}
.hero-label {
  font-size: 13px;
  font-weight: 600;
  color: #409eff;
  margin-bottom: 10px;
}
.hero-url-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.hero-url {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
  background: #fff;
  padding: 8px 14px;
  border-radius: 5px;
  border: 1px solid #dcdfe6;
}
.btn-copy {
  padding: 6px 14px;
  background: #409eff;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}
.btn-copy:hover { background: #337ecc; }
.hero-steps {
  font-size: 12px;
  color: #606266;
  line-height: 2;
}
.hero-steps code {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  background: #fff;
  padding: 1px 5px;
  border-radius: 2px;
  font-size: 11px;
  color: #303133;
  border: 1px solid #e4e7ed;
}
.step { }

/* ---- 分区标题 ---- */
.api-section {
  margin-bottom: 24px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.section-port {
  font-size: 12px;
  color: #909399;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}
.badge {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 4px;
}
.badge-api   { background: #ecf5ff; color: #409eff; }
.badge-proxy { background: #e8f5e9; color: #4caf50; }

/* ---- 表格 ---- */
.table-wrap {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  overflow: hidden;
}
.api-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.api-table th {
  background: #fafafa;
  text-align: left;
  padding: 9px 14px;
  font-weight: 600;
  color: #909399;
  font-size: 12px;
  border-bottom: 1px solid #e4e7ed;
}
.api-table td {
  padding: 8px 14px;
  border-bottom: 1px solid #f5f5f5;
  vertical-align: middle;
}
.api-table tr:last-child td { border-bottom: none; }
.col-method { width: 80px; }
.col-path   { width: 220px; }
.col-desc   { }

.ep-method {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 3px;
}
.ep-method.GET    { background: #e8f5e9; color: #388e3c; }
.ep-method.POST   { background: #e3f2fd; color: #1976d2; }
.ep-method.PUT    { background: #fff3e0; color: #f57c00; }
.ep-method.DELETE { background: #ffebee; color: #d32f2f; }

.ep-path {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  color: #303133;
}
.ep-desc {
  color: #606266;
  font-size: 13px;
}

/* ---- 调用示例 ---- */
.proxy-note {
  font-size: 12px;
  color: #909399;
  margin-top: 8px;
  line-height: 1.6;
}
.proxy-note code {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  background: #f5f7fa;
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 11px;
}
.code-block {
  background: #1e1e2e;
  border-radius: 6px;
  padding: 14px 16px;
}
.code-block code {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  color: #cdd6f4;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.7;
}
</style>
