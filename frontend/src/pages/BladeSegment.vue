<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
  type UploadFile
} from 'element-plus'
import { MagicStick, Picture, Plus, Upload, WarningFilled } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import SeverityTag from '@/components/common/SeverityTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useBladeStore } from '@/stores/bladeStore'
import { useDefectStore } from '@/stores/defectStore'
import { useTurbineStore } from '@/stores/turbineStore'
import { useDefectFilter } from '@/hooks/useDefectFilter'
import { percentOf } from '@/utils/severity'
import {
  AIRFOILS,
  FACE_LABEL,
  FACE_SHORT,
  SEGMENT_FACES,
  formatRange,
  type Segment,
  type SegmentFace
} from '@/types/segment'
import {
  DEFECT_STATES,
  DEFECT_TYPES,
  SEVERITIES,
  type Defect,
  type DefectState,
  type DefectType,
  type Severity
} from '@/types/defect'
import type { Blade } from '@/types/blade'

const route = useRoute()
const router = useRouter()
const turbineStore = useTurbineStore()
const bladeStore = useBladeStore()
const defectStore = useDefectStore()

const MAX_PREVIEW_BYTES = 1.5 * 1024 * 1024

function todayString(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

const routeBladeId = computed(() => String(route.params.id ?? ''))
const blade = computed<Blade | null>(() => bladeStore.bladeById(routeBladeId.value) ?? null)
const turbine = computed(() =>
  blade.value ? turbineStore.turbineById(blade.value.turbineId) ?? null : null
)
const siblings = computed(() => (blade.value ? turbineStore.bladesOfTurbine(blade.value.turbineId) : []))

/** 缺陷筛选：限定在当前叶片范围内 */
const defectFilter = useDefectFilter({ bladeId: () => routeBladeId.value })

const segments = computed<Segment[]>(() =>
  blade.value ? bladeStore.segmentsOfBlade(blade.value.id) : []
)

/** 筛选后的缺陷按分段归类，展开行与分段计数共用 */
const defectsBySegment = computed<Record<string, Defect[]>>(() => {
  const grouped: Record<string, Defect[]> = {}
  defectFilter.filteredRows.value.forEach((row) => {
    const key = row.defect.segmentId
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(row.defect)
  })
  return grouped
})

const bladeDefectCount = computed(() =>
  blade.value ? bladeStore.defectsOfBlade(blade.value.id).length : 0
)

const faceQuick = computed<SegmentFace | 'ALL'>(() =>
  defectStore.filter.faces.length === 1 ? defectStore.filter.faces[0] : 'ALL'
)

const filterModel = computed<FilterModel>(() => ({
  keyword: defectFilter.filter.value.keyword,
  types: defectFilter.filter.value.types,
  severities: defectFilter.filter.value.severities,
  faces: defectFilter.filter.value.faces,
  states: defectFilter.filter.value.states,
  onlyOpen: defectFilter.filter.value.onlyOpen
}))

const filterSelects = computed(() => [
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
    label: '检修面',
    options: SEGMENT_FACES.map((face) => ({ label: FACE_LABEL[face], value: face })),
    placeholder: '选择检修面'
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
  types: 'types',
  severities: 'sev',
  faces: 'faces',
  states: 'states',
  onlyOpen: 'open'
}

function handleFilterChange(value: FilterModel): void {
  defectStore.patchFilter({
    keyword: typeof value.keyword === 'string' ? value.keyword : '',
    types: (Array.isArray(value.types) ? value.types : []) as DefectType[],
    severities: (Array.isArray(value.severities) ? value.severities : []) as Severity[],
    faces: (Array.isArray(value.faces) ? value.faces : []) as SegmentFace[],
    states: (Array.isArray(value.states) ? value.states : []) as DefectState[],
    onlyOpen: value.onlyOpen === true
  })
}

function setFaceQuick(face: SegmentFace | 'ALL'): void {
  defectStore.patchFilter({ faces: face === 'ALL' ? [] : [face] })
}

/** 检修面中文标签（模板内免去类型断言） */
function faceText(face: string): string {
  return FACE_LABEL[face as SegmentFace] ?? face
}

/** 检修面视角切换：模板事件参数统一收口 */
function handleFaceQuick(value: unknown): void {
  setFaceQuick(String(value) as SegmentFace | 'ALL')
}

/** 叶片切换：模板事件参数统一收口 */
function handleBladeSwitch(value: unknown): void {
  switchBlade(String(value))
}

function switchBlade(target: string): void {
  if (target === routeBladeId.value) return
  bladeStore.setCurrentBlade(target)
  void router.push(`/blades/${target}/segments`)
}

onMounted(() => {
  syncRouteScope()
})

watch(routeBladeId, () => {
  syncRouteScope()
})

function syncRouteScope(): void {
  const current = blade.value
  if (!current) return
  bladeStore.setCurrentBlade(current.id)
  turbineStore.setCurrentTurbine(current.turbineId)
}

/* ---------------- 批量生成展向分段 ---------------- */
const generateVisible = ref(false)
const generating = ref(false)
const generateForm = reactive({
  count: 3,
  startM: 0,
  endM: 60,
  face: 'PS' as SegmentFace,
  airfoil: AIRFOILS[0],
  overwrite: false
})

function openGenerate(): void {
  const current = blade.value
  if (!current) return
  generateForm.count = Math.max(1, current.segmentCount || 3)
  generateForm.startM = 0
  generateForm.endM = current.lengthM
  generateForm.face = 'PS'
  generateForm.airfoil = AIRFOILS[0]
  generateForm.overwrite = segments.value.length > 0
  generateVisible.value = true
}

async function submitGenerate(): Promise<void> {
  const current = blade.value
  if (!current) return
  if (generateForm.endM <= generateForm.startM) {
    ElMessage.warning('结束米数必须大于起始米数')
    return
  }
  generating.value = true
  try {
    const result = await bladeStore.generateSegments(current, {
      count: generateForm.count,
      startM: generateForm.startM,
      endM: generateForm.endM,
      face: generateForm.face,
      airfoil: generateForm.airfoil,
      overwrite: generateForm.overwrite
    })
    generateVisible.value = false
    ElMessage.success(
      `已为叶片 ${current.serial} 生成 ${result.created} 个展向分段${
        result.removed > 0 ? `，覆盖前清除 ${result.removed} 个旧分段` : ''
      }`
    )
  } finally {
    generating.value = false
  }
}

/* ---------------- 单条分段新增 / 编辑 ---------------- */
const segmentVisible = ref(false)
const segmentMode = ref<'create' | 'edit'>('create')
const segmentEditingId = ref<string | null>(null)
const segmentSubmitting = ref(false)
const segmentFormRef = ref<FormInstance>()
const segmentForm = reactive({
  index: 1,
  startM: 0,
  endM: 20,
  airfoil: AIRFOILS[0],
  face: 'PS' as SegmentFace,
  sectionImage: ''
})

const segmentRules: FormRules = {
  index: [{ required: true, message: '请填写段序号', trigger: 'blur' }]
}

function openSegmentCreate(): void {
  const current = blade.value
  if (!current) return
  const nextIndex = segments.value.length + 1
  const last = segments.value[segments.value.length - 1]
  segmentMode.value = 'create'
  segmentEditingId.value = null
  segmentForm.index = nextIndex
  segmentForm.startM = last ? last.endM : 0
  segmentForm.endM = last
    ? Math.min(current.lengthM, last.endM + (current.lengthM - last.endM || 10))
    : current.lengthM
  segmentForm.airfoil = last?.airfoil ?? AIRFOILS[0]
  segmentForm.face = last?.face ?? 'PS'
  segmentForm.sectionImage = ''
  segmentVisible.value = true
}

function openSegmentEdit(segment: Segment): void {
  segmentMode.value = 'edit'
  segmentEditingId.value = segment.id
  segmentForm.index = segment.index
  segmentForm.startM = segment.startM
  segmentForm.endM = segment.endM
  segmentForm.airfoil = segment.airfoil
  segmentForm.face = segment.face
  segmentForm.sectionImage = segment.sectionImage
  segmentVisible.value = true
}

async function submitSegment(): Promise<void> {
  const current = blade.value
  if (!current || !segmentFormRef.value) return
  const valid = await segmentFormRef.value.validate().catch(() => false)
  if (!valid) return
  if (segmentForm.endM <= segmentForm.startM) {
    ElMessage.warning('结束米数必须大于起始米数')
    return
  }
  segmentSubmitting.value = true
  try {
    if (segmentMode.value === 'create') {
      await bladeStore.createSegment({
        bladeId: current.id,
        index: segmentForm.index,
        startM: segmentForm.startM,
        endM: segmentForm.endM,
        airfoil: segmentForm.airfoil,
        face: segmentForm.face,
        sectionImage: segmentForm.sectionImage
      })
      ElMessage.success(`已新增第 ${segmentForm.index} 段`)
    } else if (segmentEditingId.value) {
      await bladeStore.updateSegment(segmentEditingId.value, {
        index: segmentForm.index,
        startM: segmentForm.startM,
        endM: segmentForm.endM,
        airfoil: segmentForm.airfoil,
        face: segmentForm.face
      })
      ElMessage.success('分段信息已更新')
    }
    segmentVisible.value = false
  } finally {
    segmentSubmitting.value = false
  }
}

async function removeSegment(segment: Segment): Promise<void> {
  const defectCount = defectStore.rowsOfSegment(segment.id).length
  try {
    await ElMessageBox.confirm(
      `删除第 ${segment.index} 段（${formatRange(segment.startM, segment.endM)}）会同时删除其 ${defectCount} 条缺陷与相关工单，确认删除？`,
      '删除分段确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await bladeStore.removeSegment(segment.id)
  ElMessage.success(`已删除第 ${segment.index} 段`)
}

/* ---------------- 剖面图上传 ---------------- */
const previewVisible = ref(false)
const previewSegment = ref<Segment | null>(null)

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

async function handleUpload(segment: Segment, file: UploadFile): Promise<void> {
  const raw = file.raw
  if (!raw) return
  let preview: string | undefined
  if (raw.size <= MAX_PREVIEW_BYTES) {
    try {
      preview = await readAsDataUrl(raw)
    } catch {
      preview = undefined
    }
  }
  await bladeStore.setSectionImage(segment.id, raw.name, preview)
  if (raw.size > MAX_PREVIEW_BYTES) {
    ElMessage.warning(`已记录剖面图文件名 ${raw.name}；图片超过 1.5 MB，未生成本地预览`)
  } else {
    ElMessage.success(`第 ${segment.index} 段剖面图已挂接：${raw.name}`)
  }
}

function openPreview(segment: Segment): void {
  if (!segment.sectionPreview) {
    ElMessage.info('该分段尚未上传剖面图，或图片过大未生成预览')
    return
  }
  previewSegment.value = segment
  previewVisible.value = true
}

async function clearSection(segment: Segment): Promise<void> {
  await bladeStore.clearSectionImage(segment.id)
  ElMessage.success(`已移除第 ${segment.index} 段剖面图`)
}

/* ---------------- 缺陷标注 ---------------- */
const defectVisible = ref(false)
const defectMode = ref<'create' | 'edit'>('create')
const defectEditingId = ref<string | null>(null)
const defectSubmitting = ref(false)
const defectFormRef = ref<FormInstance>()
const defectForm = reactive({
  segmentId: '',
  type: '裂纹' as DefectType,
  severity: '轻度' as Severity,
  lengthMm: 300,
  widthMm: 4,
  face: 'PS' as SegmentFace,
  positionM: 10,
  foundAt: todayString(),
  state: '待处理' as DefectState
})

const defectRules: FormRules = {
  segmentId: [{ required: true, message: '请选择所属展向分段', trigger: 'change' }],
  lengthMm: [{ required: true, message: '请填写缺陷长度', trigger: 'blur' }],
  widthMm: [{ required: true, message: '请填写缺陷宽度', trigger: 'blur' }]
}

function segmentOptions(): Array<{ label: string; value: string }> {
  return segments.value.map((segment) => ({
    label: `第 ${segment.index} 段 · ${formatRange(segment.startM, segment.endM)} · ${FACE_SHORT[segment.face]}`,
    value: segment.id
  }))
}

function applySegmentDefaults(segmentId: string): void {
  const segment = segments.value.find((item) => item.id === segmentId)
  if (!segment) return
  defectForm.face = segment.face
  defectForm.positionM = Number(((segment.startM + segment.endM) / 2).toFixed(2))
}

function handleSegmentChange(segmentId: string): void {
  applySegmentDefaults(segmentId)
}

function openDefectCreate(segment?: Segment): void {
  const target = segment ?? segments.value[0]
  if (!target) {
    ElMessage.warning('请先生成展向分段')
    return
  }
  defectMode.value = 'create'
  defectEditingId.value = null
  defectForm.segmentId = target.id
  defectForm.type = '裂纹'
  defectForm.severity = '轻度'
  defectForm.lengthMm = 300
  defectForm.widthMm = 4
  defectForm.foundAt = todayString()
  defectForm.state = '待处理'
  applySegmentDefaults(target.id)
  defectVisible.value = true
}

function openDefectEdit(defect: Defect): void {
  defectMode.value = 'edit'
  defectEditingId.value = defect.id
  defectForm.segmentId = defect.segmentId
  defectForm.type = defect.type
  defectForm.severity = defect.severity
  defectForm.lengthMm = defect.lengthMm
  defectForm.widthMm = defect.widthMm
  defectForm.face = defect.face
  defectForm.positionM = defect.positionM
  defectForm.foundAt = defect.foundAt
  defectForm.state = defect.state
  defectVisible.value = true
}

async function submitDefect(): Promise<void> {
  if (!defectFormRef.value) return
  const valid = await defectFormRef.value.validate().catch(() => false)
  if (!valid) return
  const segment = segments.value.find((item) => item.id === defectForm.segmentId)
  if (segment && (defectForm.positionM < segment.startM || defectForm.positionM > segment.endM)) {
    ElMessage.warning(
      `展向位置应落在第 ${segment.index} 段区间 ${formatRange(segment.startM, segment.endM)} 内`
    )
    return
  }
  defectSubmitting.value = true
  try {
    if (defectMode.value === 'create') {
      await defectStore.createDefect({
        segmentId: defectForm.segmentId,
        type: defectForm.type,
        severity: defectForm.severity,
        lengthMm: defectForm.lengthMm,
        widthMm: defectForm.widthMm,
        face: defectForm.face,
        positionM: defectForm.positionM,
        foundAt: defectForm.foundAt,
        state: defectForm.state
      })
      ElMessage.success('缺陷已标注')
    } else if (defectEditingId.value) {
      await defectStore.updateDefect(defectEditingId.value, {
        segmentId: defectForm.segmentId,
        type: defectForm.type,
        severity: defectForm.severity,
        lengthMm: defectForm.lengthMm,
        widthMm: defectForm.widthMm,
        face: defectForm.face,
        positionM: defectForm.positionM,
        foundAt: defectForm.foundAt,
        state: defectForm.state
      })
      ElMessage.success('缺陷已更新')
    }
    defectVisible.value = false
  } finally {
    defectSubmitting.value = false
  }
}

async function handleStateChange(defect: Defect, state: DefectState): Promise<void> {
  await defectStore.setState(defect.id, state)
  ElMessage.success(`缺陷状态已改为「${state}」`)
}

async function removeDefect(defect: Defect): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除这条 ${defect.type}（${defect.severity}）缺陷记录？相关工单会一并删除。`,
      '删除缺陷确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await defectStore.removeDefect(defect.id)
  ElMessage.success('缺陷已删除')
}

const faceSummary = computed(() =>
  SEGMENT_FACES.map((face) => ({
    face,
    count: defectFilter.faceCounts.value[face] ?? 0,
    percent: percentOf(defectFilter.faceCounts.value[face] ?? 0, defectFilter.total.value)
  }))
)
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>叶片分段与剖面</h2>
        <p>
          <template v-if="turbine">
            <el-link type="primary" @click="router.push('/turbines')">{{ turbine.code }}</el-link>
            · {{ turbine.model }} ·
          </template>
          按展向划分分段、上传剖面图，并按检修面查看段内缺陷。
        </p>
      </div>
      <div class="toolbar">
        <el-button :icon="MagicStick" :disabled="!blade" @click="openGenerate">批量生成展向分段</el-button>
        <el-button :icon="Plus" :disabled="segments.length === 0" @click="openSegmentCreate">新增单段</el-button>
        <el-button type="primary" :icon="WarningFilled" :disabled="segments.length === 0" @click="openDefectCreate()">
          标注缺陷
        </el-button>
      </div>
    </div>

    <el-skeleton v-if="!blade && !bladeStore.bladesReady" :rows="6" animated class="section-card" />

    <EmptyPanel
      v-else-if="!blade"
      title="未找到该叶片"
      :description="`路由参数叶片 id 为「${routeBladeId}」，本地库中没有对应记录，请从机组合账重新进入。`"
      action-text="返回机组合账"
      @action="router.push('/turbines')"
    />

    <template v-else>
      <div class="section-card">
        <div class="section-card__head">
          <h3>叶片 {{ blade.serial }} · {{ turbine?.code }}</h3>
          <el-radio-group
            :model-value="blade.id"
            size="small"
            @update:model-value="handleBladeSwitch"
          >
            <el-radio-button v-for="item in siblings" :key="item.id" :value="item.id">
              叶片 {{ item.serial }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <el-descriptions :column="5" size="small" border>
          <el-descriptions-item label="叶片长度">{{ blade.lengthM }} m</el-descriptions-item>
          <el-descriptions-item label="主材">{{ blade.material }}</el-descriptions-item>
          <el-descriptions-item label="登记段数">{{ blade.segmentCount }} 段</el-descriptions-item>
          <el-descriptions-item label="实际分段">{{ segments.length }} 段</el-descriptions-item>
          <el-descriptions-item label="缺陷数">{{ bladeDefectCount }} 条</el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="stat-row">
        <StatBadge label="当前筛选缺陷" :value="defectFilter.filteredCount.value" suffix="条" tone="primary" icon="WarningFilled" />
        <StatBadge label="重度" :value="defectFilter.severityCounts.value['重度']" suffix="条" tone="danger" icon="CircleCloseFilled" />
        <StatBadge label="中度" :value="defectFilter.severityCounts.value['中度']" suffix="条" tone="warning" icon="WarningFilled" />
        <StatBadge label="轻度" :value="defectFilter.severityCounts.value['轻度']" suffix="条" tone="success" icon="SuccessFilled" />
        <StatBadge label="重度占比" :value="defectFilter.heavyPercent.value" :percent="defectFilter.heavyPercent.value" suffix="%" tone="danger" icon="PieChart" />
      </div>

      <FilterBar
        :model-value="filterModel"
        :selects="filterSelects"
        :query-keys="queryKeys"
        keyword-placeholder="搜索缺陷类型 / 状态 / 翼型 / 剖面图名…"
        switch-key="onlyOpen"
        switch-label="仅看未闭环"
        :switch-value="defectFilter.filter.value.onlyOpen"
        has-switch
        class="section-card"
        @change="handleFilterChange"
      >
        <template #extra>
          <div class="face-quick">
            <span class="muted">检修面视角：</span>
            <el-radio-group :model-value="faceQuick" size="small" @update:model-value="handleFaceQuick">
              <el-radio-button value="ALL">全部</el-radio-button>
              <el-radio-button v-for="face in SEGMENT_FACES" :key="face" :value="face">
                {{ FACE_SHORT[face] }}
              </el-radio-button>
            </el-radio-group>
          </div>
        </template>
      </FilterBar>

      <div class="section-card">
        <div class="section-card__head">
          <h3>检修面缺陷分布</h3>
          <span class="muted">共 {{ defectFilter.total.value }} 条缺陷</span>
        </div>
        <div class="face-grid">
          <div v-for="item in faceSummary" :key="item.face" class="face-cell">
            <div class="face-cell__head">
              <strong>{{ FACE_LABEL[item.face] }}</strong>
              <span class="mono">{{ item.count }} 条</span>
            </div>
            <el-progress :percentage="item.percent" :stroke-width="8" />
          </div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card__head">
          <h3>展向分段与剖面图</h3>
          <span class="muted">共 {{ segments.length }} 段 · 展开任意分段可查看并按检修面筛选段内缺陷</span>
        </div>

        <EmptyPanel
          v-if="segments.length === 0"
          title="该叶片还没有展向分段"
          description="按段数把叶片沿展向均分，逐段挂接剖面图后即可标注缺陷。"
          action-text="批量生成展向分段"
          compact
          @action="openGenerate"
        />

        <el-table v-else :data="segments" row-key="id" border>
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="expand-box">
                <div class="expand-box__head">
                  <span>
                    第 {{ row.index }} 段缺陷（当前筛选下 {{ (defectsBySegment[row.id] ?? []).length }} 条）
                  </span>
                  <el-button size="small" type="primary" plain :icon="Plus" @click="openDefectCreate(row)">
                    在该段标注缺陷
                  </el-button>
                </div>
                <el-table :data="defectsBySegment[row.id] ?? []" size="small" border>
                  <el-table-column label="类型" prop="type" width="110" />
                  <el-table-column label="程度" width="150">
                    <template #default="{ row: defect }">
                      <SeverityTag
                        :severity="defect.severity"
                        :length-mm="defect.lengthMm"
                        :width-mm="defect.widthMm"
                        size="small"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="面位" width="90">
                    <template #default="{ row: defect }">{{ defect.face }}</template>
                  </el-table-column>
                  <el-table-column label="展向位置" width="110">
                    <template #default="{ row: defect }">{{ defect.positionM }} m</template>
                  </el-table-column>
                  <el-table-column label="发现日期" prop="foundAt" width="120" />
                  <el-table-column label="状态" width="150">
                    <template #default="{ row: defect }">
                      <el-select
                        :model-value="defect.state"
                        size="small"
                        @update:model-value="(value: DefectState) => handleStateChange(defect, value)"
                      >
                        <el-option v-for="state in DEFECT_STATES" :key="state" :label="state" :value="state" />
                      </el-select>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="150">
                    <template #default="{ row: defect }">
                      <el-button link type="primary" @click="openDefectEdit(defect)">编辑</el-button>
                      <el-button link type="danger" @click="removeDefect(defect)">删除</el-button>
                    </template>
                  </el-table-column>
                  <template #empty>
                    <span class="muted">该分段在当前筛选条件下没有缺陷</span>
                  </template>
                </el-table>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="段序号" width="90">
            <template #default="{ row }">第 {{ row.index }} 段</template>
          </el-table-column>
          <el-table-column label="展向区间" width="150">
            <template #default="{ row }">
              <span class="mono">{{ formatRange(row.startM, row.endM) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="翼型代号" prop="airfoil" width="150" />
          <el-table-column label="检修面" width="130">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ faceText(row.face) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="剖面图" min-width="260">
            <template #default="{ row }">
              <div class="section-image">
                <el-image
                  v-if="row.sectionPreview"
                  :src="row.sectionPreview"
                  fit="cover"
                  class="section-image__thumb"
                  @click="openPreview(row)"
                />
                <el-icon v-else class="section-image__icon"><Picture /></el-icon>
                <div class="section-image__meta">
                  <span class="mono">{{ row.sectionImage || '未上传剖面图' }}</span>
                  <div class="section-image__actions">
                    <el-upload
                      :auto-upload="false"
                      :show-file-list="false"
                      accept="image/*"
                      :on-change="(file: UploadFile) => handleUpload(row, file)"
                    >
                      <el-button size="small" :icon="Upload">上传</el-button>
                    </el-upload>
                    <el-button v-if="row.sectionImage" size="small" link type="danger" @click="clearSection(row)">
                      移除
                    </el-button>
                  </div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="缺陷 / 未闭环 / 重度" width="180">
            <template #default="{ row }">
              <el-tag size="small" type="warning">{{ bladeStore.segmentStat(row.id).defectCount }} 条</el-tag>
              <el-tag size="small" type="danger" effect="plain">
                未闭环 {{ bladeStore.segmentStat(row.id).openCount }}
              </el-tag>
              <el-tag size="small" type="info" effect="plain">
                重度 {{ bladeStore.segmentStat(row.id).heavyCount }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDefectCreate(row)">标注缺陷</el-button>
              <el-button link type="primary" @click="openSegmentEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="removeSegment(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <el-dialog v-model="generateVisible" title="批量生成展向分段" width="600px" destroy-on-close>
      <el-form label-width="130px">
        <el-form-item label="段数">
          <el-input-number v-model="generateForm.count" :min="1" :max="12" :step="1" />
          <span class="muted unit">段</span>
        </el-form-item>
        <el-form-item label="展向范围">
          <el-input-number v-model="generateForm.startM" :min="0" :max="130" :step="1" :precision="1" />
          <span class="muted unit">至</span>
          <el-input-number v-model="generateForm.endM" :min="0" :max="130" :step="1" :precision="1" />
          <span class="muted unit">米</span>
        </el-form-item>
        <el-form-item label="默认检修面">
          <el-select v-model="generateForm.face" class="full-width">
            <el-option v-for="face in SEGMENT_FACES" :key="face" :label="FACE_LABEL[face]" :value="face" />
          </el-select>
        </el-form-item>
        <el-form-item label="翼型代号">
          <el-select v-model="generateForm.airfoil" filterable allow-create class="full-width">
            <el-option v-for="airfoil in AIRFOILS" :key="airfoil" :label="airfoil" :value="airfoil" />
          </el-select>
        </el-form-item>
        <el-form-item label="覆盖已有分段">
          <el-switch v-model="generateForm.overwrite" />
          <span class="muted unit">开启后会先删除该叶片已存在的分段及其缺陷与工单</span>
        </el-form-item>
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="分段会把展向范围均分，例如 0-68.5 m 分 3 段即 0-22.8 / 22.8-45.7 / 45.7-68.5 m。"
        />
      </el-form>
      <template #footer>
        <el-button @click="generateVisible = false">取消</el-button>
        <el-button type="primary" :loading="generating" @click="submitGenerate">生成分段</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="segmentVisible"
      :title="segmentMode === 'create' ? '新增展向分段' : '编辑展向分段'"
      width="560px"
      destroy-on-close
    >
      <el-form ref="segmentFormRef" :model="segmentForm" :rules="segmentRules" label-width="120px">
        <el-form-item label="段序号" prop="index">
          <el-input-number v-model="segmentForm.index" :min="1" :max="99" :step="1" />
        </el-form-item>
        <el-form-item label="展向范围">
          <el-input-number v-model="segmentForm.startM" :min="0" :max="130" :step="0.5" :precision="1" />
          <span class="muted unit">至</span>
          <el-input-number v-model="segmentForm.endM" :min="0" :max="130" :step="0.5" :precision="1" />
          <span class="muted unit">米</span>
        </el-form-item>
        <el-form-item label="翼型代号">
          <el-select v-model="segmentForm.airfoil" filterable allow-create class="full-width">
            <el-option v-for="airfoil in AIRFOILS" :key="airfoil" :label="airfoil" :value="airfoil" />
          </el-select>
        </el-form-item>
        <el-form-item label="检修面">
          <el-select v-model="segmentForm.face" class="full-width">
            <el-option v-for="face in SEGMENT_FACES" :key="face" :label="FACE_LABEL[face]" :value="face" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="segmentVisible = false">取消</el-button>
        <el-button type="primary" :loading="segmentSubmitting" @click="submitSegment">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="defectVisible"
      :title="defectMode === 'create' ? '标注缺陷' : '编辑缺陷'"
      width="680px"
      destroy-on-close
    >
      <el-form ref="defectFormRef" :model="defectForm" :rules="defectRules" label-width="120px">
        <el-form-item label="所属分段" prop="segmentId">
          <el-select
            v-model="defectForm.segmentId"
            class="full-width"
            @change="(value: string) => handleSegmentChange(value)"
          >
            <el-option
              v-for="option in segmentOptions()"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="缺陷类型">
          <el-select v-model="defectForm.type" class="full-width">
            <el-option v-for="type in DEFECT_TYPES" :key="type" :label="type" :value="type" />
          </el-select>
        </el-form-item>
        <el-form-item label="严重程度">
          <el-radio-group v-model="defectForm.severity">
            <el-radio-button v-for="severity in SEVERITIES" :key="severity" :value="severity">
              {{ severity }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="尺寸（毫米）">
          <el-input-number v-model="defectForm.lengthMm" :min="1" :max="20000" :step="10" />
          <span class="muted unit">长 ×</span>
          <el-input-number v-model="defectForm.widthMm" :min="1" :max="5000" :step="1" />
          <span class="muted unit">宽</span>
        </el-form-item>
        <el-form-item label="面位">
          <el-select v-model="defectForm.face" class="full-width">
            <el-option v-for="face in SEGMENT_FACES" :key="face" :label="FACE_LABEL[face]" :value="face" />
          </el-select>
        </el-form-item>
        <el-form-item label="展向位置">
          <el-input-number v-model="defectForm.positionM" :min="0" :max="130" :step="0.1" :precision="2" />
          <span class="muted unit">米（需落在所属分段区间内）</span>
        </el-form-item>
        <el-form-item label="发现日期">
          <el-date-picker v-model="defectForm.foundAt" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="处置状态">
          <el-select v-model="defectForm.state" class="full-width">
            <el-option v-for="state in DEFECT_STATES" :key="state" :label="state" :value="state" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="defectVisible = false">取消</el-button>
        <el-button type="primary" :loading="defectSubmitting" @click="submitDefect">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" title="剖面图预览" width="720px">
      <div v-if="previewSegment" class="preview-box">
        <p class="mono">{{ previewSegment.sectionImage }}</p>
        <el-image :src="previewSegment.sectionPreview" fit="contain" class="preview-box__image" />
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.face-quick {
  display: flex;
  align-items: center;
  gap: 8px;
}

.face-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.face-cell__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 13px;
}

.expand-box {
  padding: 8px 12px 12px;
  background: #f7fbfd;
}

.expand-box__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  color: #4a5b63;
}

.section-image {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-image__thumb {
  width: 56px;
  height: 40px;
  border-radius: 6px;
  border: 1px solid var(--line);
  cursor: pointer;
}

.section-image__icon {
  font-size: 22px;
  color: #9db4c0;
}

.section-image__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.section-image__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.preview-box__image {
  max-height: 420px;
}

.full-width {
  width: 100%;
}

.unit {
  margin: 0 8px;
  font-size: 12px;
}
</style>
