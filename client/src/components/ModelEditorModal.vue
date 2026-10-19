<template>
  <Teleport to="body">
    <div v-if="model || isNew" class="modal-overlay" @click.self="onOverlayClick">
      <div class="modal-box">
        <div class="modal-header">
          <h2>{{ isNew ? '新增模型' : '编辑模型' }}</h2>
          <button class="modal-close" @click="$emit('cancel')" :disabled="saving"><IconX :size="16" /></button>
        </div>
        <div class="modal-body">
          <ModelEditor
            :model="model"
            :is-new="isNew"
            :saving="saving"
            @save="handleSave"
            @cancel="$emit('cancel')"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import ModelEditor from './ModelEditor.vue'
import { IconX } from '@tabler/icons-vue'

const props = defineProps({
  model: { type: Object, default: null },
  isNew: { type: Boolean, default: false },
  saving: { type: Boolean, default: false }
})

const emit = defineEmits(['save', 'cancel'])

// 保存中时不允许点遮罩关闭，避免请求还在飞就把表单内容丢掉
function onOverlayClick() {
  if (props.saving) return
  emit('cancel')
}

function handleSave(data) {
  emit('save', data)
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
}
.modal-box {
  background: #fff;
  border-radius: 10px;
  width: 640px;
  max-width: 92vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0,0,0,0.2);
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e4e7ed;
  background: #fafafa;
}
.modal-header h2 { font-size: 15px; font-weight: 600; color: #303133; }
.modal-close {
  background: none;
  border: none;
  font-size: 18px;
  color: #909399;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.modal-close:hover { color: #303133; background: #f0f0f0; }
.modal-close:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.modal-body {
  overflow-y: auto;
  max-height: calc(90vh - 60px);
}
</style>
