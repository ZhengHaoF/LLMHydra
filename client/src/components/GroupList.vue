<template>
  <div class="group-list">
    <div class="list-header">
      <h3>配置组</h3>
      <button class="btn-add" @click="openAdd" title="新增配置组">+</button>
    </div>

    <div class="proxy-control">
      <div class="status-indicator running">
        <span class="dot"></span>
        <span>运行中 · 端口 {{ port }}</span>
      </div>
      <button class="btn-restart" @click="$emit('restart')" title="重启服务">重启</button>
    </div>

    <div class="list-body">
      <div v-if="groups.length === 0" class="empty">暂无配置组，点击 + 新建</div>
      <div
        v-for="g in groups"
        :key="g.id"
        class="group-item"
        :class="{ active: g.id === activeId }"
        @click="$emit('select', g.id)"
      >
        <div class="group-id">{{ g.id }}</div>
        <div class="group-name">{{ g.name }}</div>
        <div class="group-meta">{{ g.chain.length }} 个节点</div>
        <div class="group-actions" @click.stop>
          <button class="btn-icon" @click="openEditModal(g)" title="修改 ID / 名称"><IconPencil :size="14" /></button>
          <button class="btn-icon danger" @click="pendingDelete = g.id" title="删除"><IconX :size="14" /></button>
        </div>
      </div>
    </div>

    <!-- 新增配置组对话框 -->
    <Teleport to="body">
      <div v-if="addOpen" class="confirm-overlay" @click.self="addOpen = false">
        <div class="confirm-box">
          <div class="confirm-title">新增配置组</div>
          <div class="form-stack">
            <div class="form-row">
              <label>配置组 ID（调用名）</label>
              <input v-model="addForm.id" placeholder="例如: deepseek-v4" maxlength="64" />
              <div class="form-hint">仅允许中英文、数字和 -</div>
            </div>
            <div class="form-row">
              <label>显示名称（可选）</label>
              <input v-model="addForm.name" placeholder="留空则与 ID 相同" maxlength="64" />
            </div>
          </div>
          <div v-if="addError" class="form-error">{{ addError }}</div>
          <div class="confirm-actions">
            <button class="btn-cancel" @click="addOpen = false">取消</button>
            <button class="btn-danger" @click="confirmAdd">确认新增</button>
          </div>
        </div>
      </div>

      <!-- 修改 ID / 名称对话框 -->
      <div v-if="editModalTarget" class="confirm-overlay" @click.self="editModalTarget = null">
        <div class="confirm-box">
          <div class="confirm-title">修改配置组</div>
          <div class="form-stack">
            <div class="form-row">
              <label>配置组 ID（调用名）</label>
              <div class="id-with-copy">
                <input v-model="editForm.id" maxlength="64" />
                <button
                  type="button"
                  class="btn-copy-inline"
                  :class="{ copied: editCopied }"
                  @click="copyEditId"
                  title="复制 ID"
                ><IconCopy :size="13" /> {{ editCopied ? '已复制' : '复制' }}</button>
              </div>
              <div class="form-hint">仅允许中英文、数字和 -</div>
            </div>
            <div class="form-row">
              <label>显示名称</label>
              <input v-model="editForm.name" maxlength="64" />
            </div>
          </div>
          <div v-if="editError" class="form-error">{{ editError }}</div>
          <div class="confirm-actions">
            <button class="btn-cancel" @click="editModalTarget = null">取消</button>
            <button class="btn-danger" @click="confirmEdit">确认</button>
          </div>
        </div>
      </div>

      <!-- 删除确认 -->
      <div v-if="pendingDelete" class="confirm-overlay" @click.self="pendingDelete = null">
        <div class="confirm-box">
          <div class="confirm-title">确认删除</div>
          <div class="confirm-body">
            确定要删除配置组 <strong>{{ getGroupName(pendingDelete) }}</strong> 吗？此操作不可撤销。
          </div>
          <div class="confirm-actions">
            <button class="btn-cancel" @click="pendingDelete = null">取消</button>
            <button class="btn-danger" @click="confirmDelete">确认删除</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { IconPencil, IconX, IconCopy } from '@tabler/icons-vue'

const props = defineProps({
  groups: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
  port: { type: Number, default: 8093 }
})

const emit = defineEmits(['select', 'add', 'rename', 'rename-name', 'delete', 'restart'])

// 新增
const addOpen = ref(false)
const addForm = ref({ id: '', name: '' })
const addError = ref('')

function openAdd() {
  addForm.value = { id: '', name: '' }
  addError.value = ''
  addOpen.value = true
}

function confirmAdd() {
  const id = (addForm.value.id || '').trim()
  if (!id) {
    addError.value = 'ID 不能为空'
    return
  }
  if (!/^[a-zA-Z0-9\u4e00-\u9fa5-]+$/.test(id)) {
    addError.value = 'ID 仅允许中英文、数字和 -'
    return
  }
  if (props.groups.some((g) => g.id === id)) {
    addError.value = `ID "${id}" 已存在`
    return
  }
  emit('add', { id, name: (addForm.value.name || '').trim() || id })
  addOpen.value = false
}

// 行内编辑 id 已废弃：改用模态框（openEditModal）

// 删除
const pendingDelete = ref(null)

function confirmDelete() {
  if (!pendingDelete.value) return
  emit('delete', { oldId: pendingDelete.value, newId: null })
  pendingDelete.value = null
}

function getGroupName(id) {
  const g = props.groups.find((g) => g.id === id)
  return g ? `${g.name} (${g.id})` : id
}

// 修改（模态框）
const editModalTarget = ref(null)
const editForm = ref({ id: '', name: '' })
const editError = ref('')
const editCopied = ref(false)

function openEditModal(g) {
  editModalTarget.value = g.id
  editForm.value = { id: g.id, name: g.name }
  editError.value = ''
  editCopied.value = false
}

function confirmEdit() {
  if (!editModalTarget.value) return
  const newId = (editForm.value.id || '').trim()
  const newName = (editForm.value.name || '').trim()
  if (!newId) {
    editError.value = 'ID 不能为空'
    return
  }
  if (!/^[a-zA-Z0-9\u4e00-\u9fa5-]+$/.test(newId)) {
    editError.value = 'ID 仅允许中英文、数字和 -'
    return
  }
  if (newId !== editModalTarget.value && props.groups.some((x) => x.id === newId)) {
    editError.value = `ID "${newId}" 已存在`
    return
  }
  if (newId !== editModalTarget.value) {
    // id 变了：等价于"删除旧的 + 新建 + 迁移 chain"
    emit('rename', { oldId: editModalTarget.value, newId, name: newName || newId })
  } else {
    // id 没变：只改名称
    emit('rename-name', { id: editModalTarget.value, name: newName || newId })
  }
  editModalTarget.value = null
}

async function copyEditId() {
  const id = (editForm.value.id || '').trim()
  if (!id) return
  const ok = await copyText(id)
  if (ok) {
    editCopied.value = true
    setTimeout(() => { editCopied.value = false }, 1200)
  }
}



async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (e) { /* fall through */ }
  // 兜底：execCommand
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch (e) {
    return false
  }
}
</script>

<style scoped>
.group-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #e4e7ed;
}
.list-header h3 { font-size: 14px; font-weight: 600; color: #303133; }
.btn-add {
  width: 28px;
  height: 28px;
  background: #409eff;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-add:hover { background: #337ecc; }
.proxy-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e4e7ed;
  background: #fafafa;
}
.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #67c23a;
}
.status-indicator .dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #67c23a;
  box-shadow: 0 0 6px rgba(103, 194, 58, 0.4);
}
.btn-restart {
  padding: 4px 14px;
  border-radius: 4px;
  border: 1px solid #e6a23c;
  background: #fff;
  color: #e6a23c;
  cursor: pointer;
  font-size: 12px;
}
.btn-restart:hover { background: #fdf6ec; }
.list-body {
  flex: 1;
  overflow-y: auto;
}
.empty {
  padding: 32px 16px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}
.group-item {
  padding: 12px 16px;
  border-bottom: 1px solid #f2f3f5;
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
}
.group-item:hover { background: #f5f7fa; }
.group-item.active {
  background: #ecf5ff;
  border-left: 3px solid #409eff;
  padding-left: 13px;
}
.group-id {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  font-family: 'Consolas', 'Monaco', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 90px;
}
.group-name {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
  padding-right: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.id-with-copy {
  display: flex;
  gap: 6px;
  align-items: stretch;
}
.id-with-copy input {
  flex: 1;
  min-width: 0;
}
.btn-copy-inline {
  flex-shrink: 0;
  padding: 0 12px;
  background: #f0f5ff;
  color: #409eff;
  border: 1px solid #c6e2ff;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  font-family: inherit;
}
.btn-copy-inline:hover { background: #ecf5ff; }
.btn-copy-inline.copied {
  background: #e1f3d8;
  color: #67c23a;
  border-color: #b3e19d;
}

.group-meta {
  font-size: 11px;
  color: #c0c4cc;
  margin-top: 4px;
  padding-right: 90px;
}
.group-actions {
  position: absolute;
  top: 10px;
  right: 12px;
  display: flex;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}
.group-item:hover .group-actions {
  opacity: 1;
  pointer-events: auto;
}
.btn-icon {
  background: none;
  border: 1px solid #dcdfe6;
  cursor: pointer;
  font-size: 11px;
  color: #909399;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn-icon:hover { color: #409eff; border-color: #c6e2ff; background: #ecf5ff; }
.btn-icon.danger:hover { color: #f56c6c; border-color: #fbc4c4; background: #fef0f0; }

.confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
}
.confirm-box {
  background: #fff; border-radius: 8px;
  padding: 24px; min-width: 360px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
.confirm-title { font-size: 16px; font-weight: 600; color: #303133; margin-bottom: 16px; }
.confirm-body { font-size: 14px; color: #606266; line-height: 1.6; margin-bottom: 20px; }
.confirm-body strong { color: #f56c6c; }
.form-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}
.form-row label {
  display: block;
  font-size: 12px;
  color: #606266;
  margin-bottom: 4px;
}
.form-row input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.form-row input:focus { border-color: #409eff; }
.form-hint { font-size: 11px; color: #909399; margin-top: 4px; }
.form-error {
  color: #f56c6c;
  font-size: 12px;
  background: #fef0f0;
  padding: 6px 10px;
  border-radius: 4px;
  margin-bottom: 12px;
}
.confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
.btn-cancel, .btn-danger {
  padding: 7px 20px; border-radius: 4px; border: 1px solid #dcdfe6;
  cursor: pointer; font-size: 13px;
}
.btn-cancel { background: #fff; color: #606266; }
.btn-cancel:hover { color: #409eff; border-color: #c6e2ff; }
.btn-danger { background: #409eff; color: #fff; border-color: #409eff; }
.btn-danger:hover { background: #337ecc; }
</style>
