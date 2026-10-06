<script setup lang="ts">
import { computed } from 'vue'
import { Box, FolderOpened, MagicStick, Plus } from '@element-plus/icons-vue'

const props = withDefaults(
  defineProps<{
    /** 空状态标题 */
    title?: string
    /** 补充说明，指导下一步动作 */
    description?: string
    /** 新建按钮文案，为空则不渲染 */
    actionText?: string
    /** 次要按钮文案 */
    secondaryText?: string
    /** 是否展示「生成演示数据」按钮 */
    showSeed?: boolean
    compact?: boolean
  }>(),
  {
    title: '暂无数据',
    description: '当前筛选条件下没有记录，可调整条件或新建一条。',
    actionText: '',
    secondaryText: '',
    showSeed: false,
    compact: false
  }
)

const emit = defineEmits<{
  (event: 'action'): void
  (event: 'secondary'): void
  (event: 'seed'): void
}>()

const iconComponent = computed(() =>
  props.showSeed ? MagicStick : props.actionText ? Box : FolderOpened
)
</script>

<template>
  <div class="empty-panel" :class="{ 'is-compact': compact }">
    <el-icon class="empty-panel__icon">
      <component :is="iconComponent" />
    </el-icon>
    <h3 class="empty-panel__title">{{ title }}</h3>
    <p class="empty-panel__desc">{{ description }}</p>
    <div class="empty-panel__actions">
      <el-button v-if="actionText" type="primary" :icon="Plus" @click="emit('action')">
        {{ actionText }}
      </el-button>
      <el-button v-if="secondaryText" @click="emit('secondary')">{{ secondaryText }}</el-button>
      <el-button v-if="showSeed" type="success" plain :icon="MagicStick" @click="emit('seed')">
        生成演示数据
      </el-button>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.empty-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  background: #f7fbfd;
  border: 1px dashed #b9cfda;
  border-radius: 12px;
  text-align: center;
}

.empty-panel.is-compact {
  padding: 24px 16px;
}

.empty-panel__icon {
  font-size: 34px;
  color: #7fa8bd;
}

.empty-panel__title {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: #1c2b33;
}

.empty-panel__desc {
  margin: 0;
  max-width: 460px;
  font-size: 13px;
  line-height: 1.7;
  color: #7b8c95;
}

.empty-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
</style>
