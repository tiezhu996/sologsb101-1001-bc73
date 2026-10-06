<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { Refresh, Search } from '@element-plus/icons-vue'

export interface FilterSelectOption {
  label: string
  value: string
}

export interface FilterSelectConfig {
  /** 模型字段名，同时作为组件内唯一标识 */
  key: string
  label: string
  options: FilterSelectOption[]
  placeholder?: string
  /** 多选（默认）或单选 */
  multiple?: boolean
}

export interface FilterModel {
  keyword: string
  [key: string]: string | string[] | boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: FilterModel
    selects?: FilterSelectConfig[]
    /** 关键字输入占位文案 */
    keywordPlaceholder?: string
    /** 附加开关的字段名 */
    switchKey?: string
    /** 附加开关文案，如「仅看未闭环」 */
    switchLabel?: string
    switchValue?: boolean
    /** 是否渲染附加开关 */
    hasSwitch?: boolean
    showReset?: boolean
    /** 是否把筛选条件同步到 URL query（默认开启） */
    syncQuery?: boolean
    /** 自定义 query 键名映射：模型字段 → query 参数名 */
    queryKeys?: Record<string, string>
  }>(),
  {
    selects: () => [],
    keywordPlaceholder: '搜索关键字…',
    switchKey: 'onlyOpen',
    switchLabel: '',
    switchValue: false,
    hasSwitch: false,
    showReset: true,
    syncQuery: true,
    queryKeys: () => ({})
  }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: FilterModel): void
  (event: 'update:switchValue', value: boolean): void
  (event: 'change', value: FilterModel): void
  (event: 'reset'): void
}>()

const route = useRoute()
const router = useRouter()
const keyword = ref(typeof props.modelValue.keyword === 'string' ? props.modelValue.keyword : '')

watch(
  () => props.modelValue,
  (value) => {
    keyword.value = typeof value.keyword === 'string' ? value.keyword : ''
  },
  { deep: true }
)

/** 模型字段 → query 参数名 */
function keyOf(modelKey: string): string {
  if (props.queryKeys[modelKey]) return props.queryKeys[modelKey]
  return modelKey === 'keyword' ? 'kw' : modelKey
}

function emptyModel(): FilterModel {
  const model: FilterModel = { keyword: '' }
  props.selects.forEach((select) => {
    model[select.key] = select.multiple === false ? '' : []
  })
  if (props.hasSwitch) model[props.switchKey] = false
  return model
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string' && value.length > 0) return value.split(',')
  return []
}

function toBool(value: unknown): boolean {
  return value === '1' || value === 'true' || value === true
}

/** 把筛选条件编码为 URL query */
function buildQuery(model: FilterModel): LocationQueryRaw {
  const query: LocationQueryRaw = {}
  const rawKeyword = model.keyword
  if (typeof rawKeyword === 'string' && rawKeyword.trim().length > 0) {
    query[keyOf('keyword')] = rawKeyword.trim()
  }
  props.selects.forEach((select) => {
    const value = model[select.key]
    if (Array.isArray(value) && value.length > 0) query[keyOf(select.key)] = value.join(',')
    else if (typeof value === 'string' && value.length > 0) query[keyOf(select.key)] = value
  })
  if (props.hasSwitch && model[props.switchKey] === true) {
    query[keyOf(props.switchKey)] = '1'
  }
  return query
}

/** 从 URL query 反解筛选条件，未命中任何参数时返回 null */
function readQuery(): FilterModel | null {
  const query = route.query
  const next = emptyModel()
  let touched = false

  const keywordValue = query[keyOf('keyword')]
  if (typeof keywordValue === 'string') {
    next.keyword = keywordValue
    touched = true
  }
  props.selects.forEach((select) => {
    const raw = query[keyOf(select.key)]
    if (raw === undefined) return
    touched = true
    const list = toList(raw)
    next[select.key] = select.multiple === false ? list[0] ?? '' : list
  })
  if (props.hasSwitch) {
    const raw = query[keyOf(props.switchKey)]
    if (raw !== undefined) {
      next[props.switchKey] = toBool(raw)
      touched = true
    }
  }
  return touched ? next : null
}

function stable(query: Record<string, unknown>): string {
  return Object.keys(query)
    .sort()
    .map((key) => `${key}=${String(query[key])}`)
    .join('&')
}

async function pushQuery(model: FilterModel): Promise<void> {
  if (!props.syncQuery) return
  const query = buildQuery(model)
  if (stable(query) === stable(route.query as Record<string, unknown>)) return
  await router.replace({ query })
}

const activeCount = computed(() => {
  const entries = Object.entries(props.modelValue).filter(([key]) => key !== 'keyword')
  return entries.reduce((sum, [, value]) => {
    if (Array.isArray(value)) return sum + value.length
    if (typeof value === 'string' && value.length > 0) return sum + 1
    if (typeof value === 'boolean' && value) return sum + 1
    return sum
  }, 0)
})

function emitChange(next: FilterModel): void {
  emit('update:modelValue', next)
  emit('change', next)
  void pushQuery(next)
}

function handleKeywordInput(value: string): void {
  keyword.value = value
  emitChange({ ...props.modelValue, keyword: value })
}

function handleSelect(key: string, value: string | string[]): void {
  emitChange({ ...props.modelValue, [key]: value })
}

function handleSwitch(value: boolean): void {
  emit('update:switchValue', value)
  emitChange({ ...props.modelValue, [props.switchKey]: value })
}

function handleReset(): void {
  const cleared = emptyModel()
  keyword.value = ''
  emit('update:modelValue', cleared)
  emit('change', cleared)
  if (props.hasSwitch) emit('update:switchValue', false)
  void pushQuery(cleared)
  emit('reset')
}

function valueOf(key: string): string | string[] {
  const value = props.modelValue[key]
  if (Array.isArray(value)) return value
  return typeof value === 'string' ? value : ''
}

// 首次进入：URL query 优先（可直接分享带条件的链接）
onMounted(() => {
  if (!props.syncQuery) return
  const fromQuery = readQuery()
  if (fromQuery) emitChange(fromQuery)
})

// 浏览器前进 / 后退时反向同步
watch(
  () => route.query,
  () => {
    if (!props.syncQuery) return
    if (stable(route.query as Record<string, unknown>) === stable(buildQuery(props.modelValue))) return
    const fromQuery = readQuery()
    emitChange(fromQuery ?? emptyModel())
  }
)
</script>

<template>
  <div class="filter-bar">
    <div class="filter-bar__main">
      <el-input
        :model-value="keyword"
        class="filter-bar__keyword"
        :placeholder="keywordPlaceholder"
        clearable
        @update:model-value="handleKeywordInput"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>

      <div v-for="select in selects" :key="select.key" class="filter-bar__select">
        <span class="filter-bar__label">{{ select.label }}</span>
        <el-select
          :model-value="valueOf(select.key)"
          :multiple="select.multiple !== false"
          :collapse-tags="select.multiple !== false"
          collapse-tags-tooltip
          clearable
          :placeholder="select.placeholder ?? `选择${select.label}`"
          class="filter-bar__control"
          @update:model-value="(value: string | string[]) => handleSelect(select.key, value)"
        >
          <el-option
            v-for="option in select.options"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>

      <div v-if="hasSwitch" class="filter-bar__switch">
        <el-switch
          :model-value="switchValue"
          :active-text="switchLabel"
          inline-prompt
          @update:model-value="handleSwitch"
        />
      </div>

      <slot name="extra" />
    </div>

    <div class="filter-bar__side">
      <slot name="actions" />
      <el-tag v-if="activeCount > 0" type="warning" effect="plain" round>
        {{ activeCount }} 项条件
      </el-tag>
      <el-button v-if="showReset" :icon="Refresh" text type="primary" @click="handleReset">
        重置
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 10px;
}

.filter-bar__main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  flex: 1 1 520px;
}

.filter-bar__side {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-bar__keyword {
  width: 220px;
}

.filter-bar__label {
  margin-right: 6px;
  font-size: 13px;
  color: #5c6b73;
}

.filter-bar__select {
  display: flex;
  align-items: center;
}

.filter-bar__control {
  width: 180px;
}
</style>
