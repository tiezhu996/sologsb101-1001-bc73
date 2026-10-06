<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Plus, Position, Refresh, Tools } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import SeverityTag from '@/components/common/SeverityTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useBladeStore } from '@/stores/bladeStore'
import { useDefectStore, type DefectRow } from '@/stores/defectStore'
import { useTurbineStore } from '@/stores/turbineStore'
import { useWorkOrderStore } from '@/stores/workOrderStore'
import { useDefectFilter } from '@/hooks/useDefectFilter'
import { seedDemoData } from '@/utils/db'
import { formatArea, formatSize } from '@/utils/severity'
import {
  DEFECT_STATE_BG,
  DEFECT_STATE_COLOR,
  DEFECT_STATES,
  DEFECT_TYPES,
  SEVERITIES,
  type Defect,
  type DefectState,
  type DefectType,
  type Severity
} from '@/types/defect'
import { FACE_LABEL, SEGMENT_FACES, formatRange, type SegmentFace } from '@/types/segment'
import { WORK_TEAMS } from '@/types/workOrder'

const router = useRouter()
const turbineStore = useTurbineStore()
const bladeStore = useBladeStore()
const defectStore = useDefectStore()
const workOrderStore = useWorkOrderStore()

function todayString(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

const defectFilter = useDefectFilter()

const filterModel = computed<FilterModel>(() => ({
  keyword: defectStore.filter.keyword,
  turbines: defectStore.filter.turbines,
  types: defectStore.filter.types,
  severities: defectStore.filter.severities,
  faces: defectStore.filter.faces,
  states: defectStore.filter.states,
  onlyOpen: defectStore.filter.onlyOpen
}))

const filterSelects = computed(() => [
  {
    key: 'turbines',
    label: '机组',
    options: defectFilter.turbineOptions.value,
    placeholder: '选择机组'
  },
  {
    key: 'types',
    label: '缺陷类型',
    options: DEFECT_TYPES.map((type) => ({ label: type, value: type })),
    placeholder: '选择类型'
  },
  {
    key: 'severities',
    label: '严重程度',
    options: SEVERITIES.map((severity) => ({ label: severity, value: severity })),
    placeholder: '选择程度'
  },
  {
    key: 'faces',
    label: '面位',
    options: SEGMENT_FACES.map((face) => ({ label: FACE_LABEL[face], value: face })),
    placeholder: '选择面位'
  },
  {
    key: 'states',
    label: '处置状态',
    options: DEFECT_STATES.map((state) => ({ label: state, value: state })),
    placeholder: '选择状态'
  }
])

const queryKeys = {
  keyword: 'kw',
  turbines: 'turbine',
  types: 'types',
  severities: 'sev',
  faces: 'faces',
  states: 'states',
  onlyOpen: 'open'
}

function handleFilterChange(value: FilterModel): void {
  defectStore.patchFilter({
    keyword: typeof value.keyword === 'string' ? value.keyword : '',
    turbines: (Array.isArray(value.turbines) ? value.turbines : []) as string[],
    types: (Array.isArray(value.types) ? value.types : []) as DefectType[],
    severities: (Array.isArray(value.severities) ? value.severities : []) as Severity[],
    faces: (Array.isArray(value.faces) ? value.faces : []) as SegmentFace[],
    states: (Array.isArray(value.states) ? value.states : []) as DefectState[],
    onlyOpen: value.onlyOpen === true
  })
}

/* ---------------- 选中与批量操作 ---------------- */
const selectedRows = ref<DefectRow[]>([])

function handleSelectionChange(rows: DefectRow[]): void {
  selectedRows.value = rows
  defectStore.setSelection(rows.map((row) => row.defect.id))
}

const selectedIds = computed(() => selectedRows.value.map((row) => row.defect.id))

const batchSeverity = ref<Severity>('重度')
const batchType = ref<DefectType>('裂纹')
const batchState = ref<DefectState>('待处理')
const batchWorking = ref(false)

async function applyBatchSeverity(): Promise<void> {
  if (selectedIds.value.length === 0) return
  batchWorking.value = true
  try {
    const count = await defectStore.bulkSetSeverity(selectedIds.value, batchSeverity.value)
    ElMessage.success(`已把 ${count} 条缺陷的严重程度改为「${batchSeverity.value}」`)
  } finally {
    batchWorking.value = false
  }
}

async function applyBatchType(): Promise<void> {
  if (selectedIds.value.length === 0) return
  batchWorking.value = true
  try {
    const count = await defectStore.bulkSetType(selectedIds.value, batchType.value)
    ElMessage.success(`已把 ${count} 条缺陷的类型改为「${batchType.value}」`)
  } finally {
    batchWorking.value = false
  }
}

async function applyBatchState(): Promise<void> {
  if (selectedIds.value.length === 0) return
  batchWorking.value = true
  try {
    const count = await defectStore.bulkSetState(selectedIds.value, batchState.value)
    ElMessage.success(`已把 ${count} 条缺陷的状态改为「${batchState.value}」`)
  } finally {
    batchWorking.value = false
  }
}

async function removeSelected(): Promise<void> {
  if (selectedIds.value.length === 0) return
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedIds.value.length} 条缺陷？其关联工单会一并删除。`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const count = await defectStore.removeDefects(selectedIds.value)
  selectedRows.value = []
  ElMessage.success(`已删除 ${count} 条缺陷`)
}

/* ---------------- 标注表单 ---------------- */
const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({
  turbineId: '',
  bladeId: '',
  segmentId: '',
  type: '裂纹' as DefectType,
  severity: '轻度' as Severity,
  lengthMm: 500,
  widthMm: 6,
  face: 'PS' as SegmentFace,
  positionM: 0,
  foundAt: todayString(),
  state: '待处理' as DefectState
})

const rules: FormRules = {
  segmentId: [{ required: true, message: '请选择所属展向分段', trigger: 'change' }],
  lengthMm: [{ required: true, message: '请填写缺陷长度（毫米）', trigger: 'blur' }],
  widthMm: [{ required: true, message: '请填写缺陷宽度（毫米）', trigger: 'blur' }]
}

const formBlades = computed(() =>
  form.turbineId ? turbineStore.bladesOfTurbine(form.turbineId) : []
)

const formSegments = computed(() =>
  form.bladeId ? bladeStore.segmentsOfBlade(form.bladeId) : []
)

function applySegmentDefaults(segmentId: string): void {
  const segment = formSegments.value.find((item) => item.id === segmentId)
  if (!segment) return
  form.face = segment.face
  form.positionM = Number(((segment.startM + segment.endM) / 2).toFixed(2))
}

function handleTurbineChange(turbineId: string): void {
  form.turbineId = turbineId
  const blade = turbineStore.bladesOfTurbine(turbineId)[0]
  form.bladeId = blade?.id ?? ''
  const segment = form.bladeId ? bladeStore.segmentsOfBlade(form.bladeId)[0] : undefined
  form.segmentId = segment?.id ?? ''
  if (segment) applySegmentDefaults(segment.id)
}

function handleBladeChange(bladeId: string): void {
  form.bladeId = bladeId
  const segment = bladeStore.segmentsOfBlade(bladeId)[0]
  form.segmentId = segment?.id ?? ''
  if (segment) applySegmentDefaults(segment.id)
}

function handleSegmentChange(segmentId: string): void {
  form.segmentId = segmentId
  applySegmentDefaults(segmentId)
}

function openCreate(preselect?: DefectRow): void {
  dialogMode.value = 'create'
  editingId.value = null
  const turbineId = preselect?.turbine?.id ?? defectStore.filter.turbines[0] ?? turbineStore.turbines[0]?.id ?? ''
  const bladeId = preselect?.blade?.id ?? turbineStore.bladesOfTurbine(turbineId)[0]?.id ?? ''
  const segmentId = preselect?.segment?.id ?? (bladeId ? bladeStore.segmentsOfBlade(bladeId)[0]?.id ?? '' : '')
  form.turbineId = turbineId
  form.bladeId = bladeId
  form.segmentId = segmentId
  form.type = '裂纹'
  form.severity = '轻度'
  form.lengthMm = 500
  form.widthMm = 6
  form.foundAt = todayString()
  form.state = '待处理'
  if (segmentId) applySegmentDefaults(segmentId)
  dialogVisible.value = true
}

function openEdit(defect: Defect): void {
  const segment = defectStore.segments.find((item) => item.id === defect.segmentId)
  const blade = segment ? turbineStore.bladeById(segment.bladeId) : undefined
  dialogMode.value = 'edit'
  editingId.value = defect.id
  form.turbineId = blade?.turbineId ?? ''
  form.bladeId = blade?.id ?? ''
  form.segmentId = defect.segmentId
  form.type = defect.type
  form.severity = defect.severity
  form.lengthMm = defect.lengthMm
  form.widthMm = defect.widthMm
  form.face = defect.face
  form.positionM = defect.positionM
  form.foundAt = defect.foundAt
  form.state = defect.state
  dialogVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  const segment = defectStore.segments.find((item) => item.id === form.segmentId)
  if (segment && (form.positionM < segment.startM || form.positionM > segment.endM)) {
    ElMessage.warning(
      `展向位置需落在第 ${segment.index} 段区间 ${formatRange(segment.startM, segment.endM)} 内`
    )
    return
  }
  submitting.value = true
  try {
    if (dialogMode.value === 'create') {
      await defectStore.createDefect({
        segmentId: form.segmentId,
        type: form.type,
        severity: form.severity,
        lengthMm: form.lengthMm,
        widthMm: form.widthMm,
        face: form.face,
        positionM: form.positionM,
        foundAt: form.foundAt,
        state: form.state
      })
      ElMessage.success('缺陷已标注')
    } else if (editingId.value) {
      await defectStore.updateDefect(editingId.value, {
        segmentId: form.segmentId,
        type: form.type,
        severity: form.severity,
        lengthMm: form.lengthMm,
        widthMm: form.widthMm,
        face: form.face,
        positionM: form.positionM,
        foundAt: form.foundAt,
        state: form.state
      })
      ElMessage.success('缺陷已更新')
    }
    dialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

async function removeDefect(row: DefectRow): Promise<void> {
  const orders = defectStore.ordersOfDefect(row.defect.id)
  try {
    await ElMessageBox.confirm(
      `确认删除这条 ${row.defect.type}（${row.defect.severity}）缺陷？${
        orders.length > 0 ? `关联的 ${orders.length} 张工单会一并删除。` : ''
      }`,
      '删除缺陷确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await defectStore.removeDefect(row.defect.id)
  ElMessage.success('缺陷已删除')
}

/* ---------------- 派工 ---------------- */
const dispatchVisible = ref(false)
const dispatchSubmitting = ref(false)
const dispatchTargets = ref<DefectRow[]>([])
const dispatchForm = reactive({
  team: WORK_TEAMS[0],
  dueDate: todayString()
})

function openDispatch(rows: DefectRow[]): void {
  if (rows.length === 0) {
    ElMessage.warning('请先勾选需要派工的缺陷')
    return
  }
  dispatchTargets.value = rows
  dispatchForm.team = WORK_TEAMS[0]
  const due = new Date()
  due.setDate(due.getDate() + 7)
  dispatchForm.dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(
    due.getDate()
  ).padStart(2, '0')}`
  dispatchVisible.value = true
}

async function submitDispatch(): Promise<void> {
  if (dispatchTargets.value.length === 0) return
  dispatchSubmitting.value = true
  try {
    let created = 0
    let reassigned = 0
    for (const row of dispatchTargets.value) {
      const existing = workOrderStore.ordersOfDefect(row.defect.id)[0]
      if (existing) {
        await workOrderStore.updateWorkOrder(existing.id, {
          team: dispatchForm.team,
          dueDate: dispatchForm.dueDate
        })
        if (row.defect.state === '待处理') await defectStore.setState(row.defect.id, '已派工')
        reassigned += 1
      } else {
        await workOrderStore.dispatch({
          defectId: row.defect.id,
          team: dispatchForm.team,
          dueDate: dispatchForm.dueDate
        })
        created += 1
      }
    }
    dispatchVisible.value = false
    ElMessage.success(
      `派工完成：新建 ${created} 张工单${reassigned > 0 ? `，改派 ${reassigned} 张` : ''}，班组「${dispatchForm.team}」，限期 ${dispatchForm.dueDate}`
    )
  } finally {
    dispatchSubmitting.value = false
  }
}

/* ---------------- 行内辅助 ---------------- */
function segmentText(row: DefectRow): string {
  if (!row.segment) return '分段缺失'
  return `第 ${row.segment.index} 段 · ${formatRange(row.segment.startM, row.segment.endM)}`
}

/** 面位中文标签（模板内免去类型断言） */
function faceText(face: string): string {
  return FACE_LABEL[face as SegmentFace] ?? face
}

/** 状态标签配色（模板内免去类型断言） */
function stateColor(state: string): string {
  return DEFECT_STATE_COLOR[state as DefectState] ?? '#4a5b63'
}

function stateBg(state: string): string {
  return DEFECT_STATE_BG[state as DefectState] ?? '#eef4f7'
}

function locate(row: DefectRow): void {
  if (!row.blade) {
    ElMessage.warning('该缺陷缺少叶片归属，无法定位')
    return
  }
  bladeStore.setCurrentBlade(row.blade.id)
  if (row.turbine) turbineStore.setCurrentTurbine(row.turbine.id)
  void router.push(`/blades/${row.blade.id}/segments`)
}

function orderSummary(row: DefectRow): string {
  const orders = defectStore.ordersOfDefect(row.defect.id)
  if (orders.length === 0) return '未派工'
  return orders
    .map((order) => `${order.team}｜${order.state}｜限期 ${order.dueDate}`)
    .join('；')
}

async function handleSeed(): Promise<void> {
  const seeded = await seedDemoData()
  if (seeded) {
    ElMessage.success('已生成演示数据：18 条缺陷覆盖 5 种类型与 3 个等级')
  } else {
    ElMessage.info('本地已有数据，未重复播种')
  }
}

const summary = computed(() => ({
  total: defectStore.defects.length,
  pending: defectStore.stateCounts['待处理'],
  dispatched: defectStore.stateCounts['已派工'],
  repaired: defectStore.stateCounts['已修复'],
  heavyPercent: defectStore.heavyPercent,
  areaText: formatArea(defectStore.totalAreaCm2),
  filtered: defectFilter.filteredCount.value
}))

const tableRows = computed(() => defectFilter.sortedRows.value)
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>缺陷标注台</h2>
        <p>按类型 / 程度 / 面位 / 状态组合筛选，支持单条标注与勾选后批量改等级、改类型、改状态与派工。</p>
      </div>
      <div class="toolbar">
        <el-button :icon="Refresh" @click="defectStore.resetFilter()">清空筛选</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate()">单条标注</el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge label="缺陷总数" :value="summary.total" suffix="条" tone="primary" icon="WarningFilled" />
      <StatBadge label="待处理" :value="summary.pending" suffix="条" tone="danger" icon="CircleCloseFilled" />
      <StatBadge label="已派工" :value="summary.dispatched" suffix="条" tone="warning" icon="Tools" />
      <StatBadge label="已修复" :value="summary.repaired" suffix="条" tone="success" icon="SuccessFilled" />
      <StatBadge
        label="重度占比"
        :value="summary.heavyPercent"
        :percent="summary.heavyPercent"
        suffix="%"
        tone="danger"
        icon="PieChart"
      />
      <StatBadge label="损伤面积" :value="summary.areaText" tone="info" icon="Histogram" />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      :query-keys="queryKeys"
      keyword-placeholder="搜索类型 / 状态 / 机组 / 叶片 / 翼型…"
      switch-key="onlyOpen"
      switch-label="仅看未闭环"
      :switch-value="defectStore.filter.onlyOpen"
      has-switch
      class="section-card"
      @change="handleFilterChange"
    />

    <div class="section-card">
      <div class="section-card__head">
        <h3>缺陷清单（当前筛选 {{ summary.filtered }} 条）</h3>
        <div class="toolbar">
          <el-tag v-if="selectedIds.length > 0" type="warning" effect="dark">
            已选 {{ selectedIds.length }} 条
          </el-tag>
          <el-select v-model="batchSeverity" size="small" class="batch-select">
            <el-option v-for="severity in SEVERITIES" :key="severity" :label="`改等级：${severity}`" :value="severity" />
          </el-select>
          <el-button size="small" :loading="batchWorking" @click="applyBatchSeverity">应用等级</el-button>
          <el-select v-model="batchType" size="small" class="batch-select">
            <el-option v-for="type in DEFECT_TYPES" :key="type" :label="`改类型：${type}`" :value="type" />
          </el-select>
          <el-button size="small" :loading="batchWorking" @click="applyBatchType">应用类型</el-button>
          <el-select v-model="batchState" size="small" class="batch-select">
            <el-option v-for="state in DEFECT_STATES" :key="state" :label="`改状态：${state}`" :value="state" />
          </el-select>
          <el-button size="small" :loading="batchWorking" @click="applyBatchState">应用状态</el-button>
          <el-button size="small" type="primary" :icon="Tools" @click="openDispatch(selectedRows)">
            批量派工
          </el-button>
          <el-button size="small" type="danger" plain @click="removeSelected">批量删除</el-button>
        </div>
      </div>

      <EmptyPanel
        v-if="tableRows.length === 0"
        title="没有符合条件的缺陷"
        description="可以调整筛选条件，或直接在某个展向分段上标注新缺陷。"
        action-text="单条标注"
        :show-seed="summary.total === 0"
        @action="openCreate()"
        @seed="handleSeed"
      />

      <el-table
        v-else
        :data="tableRows"
        row-key="defect.id"
        border
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="46" />
        <el-table-column label="机组 / 叶片" min-width="150">
          <template #default="{ row }">
            <div class="cell-stack">
              <span>{{ row.turbine?.code ?? '—' }}</span>
              <span class="muted">叶片 {{ row.blade?.serial ?? '—' }}｜{{ row.segment ? segmentText(row) : '—' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" prop="defect.type" width="110" />
        <el-table-column label="程度 / 尺寸" min-width="200">
          <template #default="{ row }">
            <div class="cell-stack">
              <SeverityTag
                :severity="row.defect.severity"
                :length-mm="row.defect.lengthMm"
                :width-mm="row.defect.widthMm"
              />
              <span class="muted mono">
                {{ formatSize(row.defect.lengthMm, row.defect.widthMm) }} ·
                面积 {{ formatArea((row.defect.lengthMm * row.defect.widthMm) / 100) }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="面位" width="120">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ faceText(row.defect.face) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="展向位置" width="110">
          <template #default="{ row }">
            <span class="mono">{{ row.defect.positionM }} m</span>
          </template>
        </el-table-column>
        <el-table-column label="发现日期" prop="defect.foundAt" width="120" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <span
              class="state-pill"
              :style="{ color: stateColor(row.defect.state), backgroundColor: stateBg(row.defect.state) }"
            >
              {{ row.defect.state }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="工单" min-width="200">
          <template #default="{ row }">
            <div class="cell-stack">
              <span>{{ orderSummary(row) }}</span>
              <span class="muted">
                工单状态：{{
                  row.defect.state === '待处理' && defectStore.ordersOfDefect(row.defect.id).length === 0
                    ? '尚未派工'
                    : defectStore
                        .ordersOfDefect(row.defect.id)
                        .map((order) => order.state)
                        .join('、') || '—'
                }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row.defect)">编辑</el-button>
            <el-button link type="primary" :icon="Tools" @click="openDispatch([row])">派工</el-button>
            <el-button link type="primary" :icon="Position" @click="locate(row)">定位分段</el-button>
            <el-button link type="danger" @click="removeDefect(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '标注缺陷' : '编辑缺陷'"
      width="680px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="机组">
          <el-select :model-value="form.turbineId" class="full-width" @change="handleTurbineChange">
            <el-option
              v-for="turbine in turbineStore.turbines"
              :key="turbine.id"
              :label="`${turbine.code}（${turbine.model}）`"
              :value="turbine.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="叶片">
          <el-select :model-value="form.bladeId" class="full-width" @change="handleBladeChange">
            <el-option
              v-for="blade in formBlades"
              :key="blade.id"
              :label="`叶片 ${blade.serial}（${blade.lengthM} m · ${blade.material}）`"
              :value="blade.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="展向分段" prop="segmentId">
          <el-select :model-value="form.segmentId" class="full-width" @change="handleSegmentChange">
            <el-option
              v-for="segment in formSegments"
              :key="segment.id"
              :label="`第 ${segment.index} 段 · ${formatRange(segment.startM, segment.endM)} · ${FACE_LABEL[segment.face]}`"
              :value="segment.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="缺陷类型">
          <el-select v-model="form.type" class="full-width">
            <el-option v-for="type in DEFECT_TYPES" :key="type" :label="type" :value="type" />
          </el-select>
        </el-form-item>
        <el-form-item label="严重程度">
          <el-radio-group v-model="form.severity">
            <el-radio-button v-for="severity in SEVERITIES" :key="severity" :value="severity">
              {{ severity }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="尺寸（毫米）">
          <el-input-number v-model="form.lengthMm" :min="1" :max="20000" :step="10" />
          <span class="muted unit">长 ×</span>
          <el-input-number v-model="form.widthMm" :min="1" :max="5000" :step="1" />
          <span class="muted unit">宽</span>
        </el-form-item>
        <el-form-item label="面位">
          <el-select v-model="form.face" class="full-width">
            <el-option v-for="face in SEGMENT_FACES" :key="face" :label="FACE_LABEL[face]" :value="face" />
          </el-select>
        </el-form-item>
        <el-form-item label="展向位置">
          <el-input-number v-model="form.positionM" :min="0" :max="130" :step="0.1" :precision="2" />
          <span class="muted unit">米</span>
        </el-form-item>
        <el-form-item label="发现日期">
          <el-date-picker v-model="form.foundAt" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="处置状态">
          <el-select v-model="form.state" class="full-width">
            <el-option v-for="state in DEFECT_STATES" :key="state" :label="state" :value="state" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dispatchVisible" title="派发维修工单" width="600px" destroy-on-close>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        :title="`本次将处理 ${dispatchTargets.length} 条缺陷；已有工单的缺陷按「改派」更新班组与限期。`"
        class="dispatch-alert"
      />
      <el-form label-width="110px">
        <el-form-item label="派工班组">
          <el-select v-model="dispatchForm.team" class="full-width">
            <el-option v-for="team in WORK_TEAMS" :key="team" :label="team" :value="team" />
          </el-select>
        </el-form-item>
        <el-form-item label="限期">
          <el-date-picker v-model="dispatchForm.dueDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
      </el-form>
      <el-table :data="dispatchTargets" size="small" border max-height="240">
        <el-table-column label="机组" width="100">
          <template #default="{ row }">{{ row.turbine?.code ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="定位" min-width="150">
          <template #default="{ row }">
            叶片 {{ row.blade?.serial ?? '—' }}｜第 {{ row.segment?.index ?? '—' }} 段
          </template>
        </el-table-column>
        <el-table-column label="缺陷" min-width="150">
          <template #default="{ row }">{{ row.defect.type }}（{{ row.defect.severity }}）</template>
        </el-table-column>
        <el-table-column label="当前状态" width="100">
          <template #default="{ row }">{{ row.defect.state }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" :loading="dispatchSubmitting" @click="submitDispatch">
          确认派工
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.cell-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.state-pill {
  display: inline-block;
  padding: 1px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.batch-select {
  width: 150px;
}

.full-width {
  width: 100%;
}

.unit {
  margin: 0 8px;
  font-size: 12px;
}

.dispatch-alert {
  margin-bottom: 12px;
}
</style>
