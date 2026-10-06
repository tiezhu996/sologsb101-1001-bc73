<script setup lang="ts">
import { computed } from 'vue'
import { CircleCloseFilled, SuccessFilled, WarningFilled } from '@element-plus/icons-vue'
import type { Severity } from '@/types/defect'
import { SEVERITY_BG, SEVERITY_COLOR, SEVERITY_ICON, formatSize } from '@/utils/severity'

const props = withDefaults(
  defineProps<{
    severity: Severity
    /** 是否显示图标 */
    icon?: boolean
    /** 缺陷长度（毫米），传入后一并展示尺寸 */
    lengthMm?: number
    /** 缺陷宽度（毫米） */
    widthMm?: number
    size?: 'default' | 'small' | 'large'
    /** 描边风格（浅底 + 深字） */
    plain?: boolean
  }>(),
  {
    icon: true,
    lengthMm: undefined,
    widthMm: undefined,
    size: 'default',
    plain: false
  }
)

const iconComponent = computed(() => {
  const name = SEVERITY_ICON[props.severity]
  if (name === 'CircleCloseFilled') return CircleCloseFilled
  if (name === 'WarningFilled') return WarningFilled
  return SuccessFilled
})

const style = computed(() => ({
  color: props.plain ? SEVERITY_COLOR[props.severity] : '#ffffff',
  backgroundColor: props.plain ? SEVERITY_BG[props.severity] : SEVERITY_COLOR[props.severity],
  borderColor: SEVERITY_COLOR[props.severity]
}))

const sizeText = computed(() => {
  if (props.lengthMm === undefined || props.widthMm === undefined) return ''
  return formatSize(props.lengthMm, props.widthMm)
})
</script>

<template>
  <span class="severity-tag" :class="[`is-${size}`, { 'is-plain': plain }]" :style="style">
    <el-icon v-if="icon" class="severity-tag__icon">
      <component :is="iconComponent" />
    </el-icon>
    <span class="severity-tag__text">{{ severity }}</span>
    <span v-if="sizeText" class="severity-tag__size">· {{ sizeText }}</span>
  </span>
</template>

<style scoped>
.severity-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
}

.severity-tag.is-small {
  padding: 0 8px;
  font-size: 12px;
  line-height: 18px;
}

.severity-tag.is-large {
  padding: 4px 14px;
  font-size: 15px;
  line-height: 24px;
}

.severity-tag__icon {
  font-size: 13px;
}

.severity-tag__size {
  font-weight: 400;
  opacity: 0.92;
}
</style>
