<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Check, Plus, Refresh, RefreshLeft, Right } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import SeverityTag from '@/components/common/SeverityTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useDefectStore } from '@/stores/defectStore'
import { useWorkOrderStore, type DispatchOption, type WorkOrderRow } from '@/stores/workOrderStore'
import { useBladeStore } from '@/stores/bladeStore'
import {
  WORK_ORDER_STATE_COLOR,
  WORK_ORDER_STATES,
  WORK_TEAMS,
  type WorkOrder,
  type WorkOrderState
} from '@/types/workOrder'
import { FACE_LABEL, formatRange, type SegmentFace } from '@/types/segment'
import { seedDemoData } from '@/utils/db'

const router = useRouter()
const workOrderStore = useWorkOrderStore()
const defectStore = useDefectStore()
const bladeStore = useBladeStore()

function todayString(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function dateAfter(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function formatDateTime(value: number | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 距限期的天数：负数表示已超期 */
function daysLeft(dueDate: string): number {
  if (!dueDate) return 0
  const due = new Date(`${dueDate}T00:00:00`).getTime()
  const today = new Date(`${todayString()}T00:00:00`).getTime()
  return Math.round((due - today) / (24 * 60 * 60 * 1000))
}

const filterModel = computed<FilterModel>(() => ({
  keyword: workOrderStore.keyword,
  teams: workOrderStore.teamFilter,
  states: workOrderStore.stateFilter,
  onlyOverdue: workOrderStore.onlyOverdue
}))

const filterSelects = computed(() => [
  {
    key: 'teams',
    label: '班组',
    options: workOrderStore.teamOptions.map((team) => ({ label: team, value: team })),
    placeholder: '选择班组'
  },
  {
    key: 'states',
    label: '工单状态',
    options: WORK_ORDER_STATES.map((state) => ({ label: state, value: state })),
    placeholder: '选择状态'
  }
])

const queryKeys = {
  keyword: 'kw',
  teams: 'team',
  states: 'state',
  onlyOverdue: 'overdue'
}

function handleFilterChange(value: FilterModel): void {
  workOrderStore.patchFilter({
    keyword: typeof value.keyword === 'string' ? value.keyword : '',
    teams: (Array.isArray(value.teams) ? value.teams : []) as string[],
    states: (Array.isArray(value.states) ? value.states : []) as WorkOrderState[],
    onlyOverdue: value.onlyOverdue === true
  })
}

function stateColor(state: string): string {
  return WORK_ORDER_STATE_COLOR[state as WorkOrderState] ?? '#4a5b63'
}

/** 面位中文标签（模板内免去类型断言） */
function faceText(face: string): string {
  return FACE_LABEL[face as SegmentFace] ?? face
}

/* ---------------- 新建工单（派工） ---------------- */
const createVisible = ref(false)
const createSubmitting = ref(false)
const createFormRef = ref<FormInstance>()
const createForm = reactive({
  defectId: '',
  team: WORK_TEAMS[0],
  dueDate: dateAfter(7)
})

const createRules: FormRules = {
  defectId: [{ required: true, message: '请选择需要派工的缺陷', trigger: 'change' }]
}

const dispatchable = computed<DispatchOption[]>(() => workOrderStore.dispatchableDefects)

function defectOptionLabel(row: DispatchOption): string {
  const turbine = row.turbine?.code ?? '未知机组'
  const blade = row.blade?.serial ?? '—'
  const segment = row.segment ? `第 ${row.segment.index} 段` : '分段缺失'
  return `${turbine}｜叶片 ${blade}｜${segment}｜${row.defect.type}（${row.defect.severity}）`
}

function openCreate(): void {
  createForm.defectId = dispatchable.value[0]?.defect.id ?? ''
  createForm.team = WORK_TEAMS[0]
  createForm.dueDate = dateAfter(7)
  createVisible.value = true
}

async function submitCreate(): Promise<void> {
  if (!createFormRef.value) return
  const valid = await createFormRef.value.validate().catch(() => false)
  if (!valid) return
  createSubmitting.value = true
  try {
    await workOrderStore.dispatch({
      defectId: createForm.defectId,
      team: createForm.team,
      dueDate: createForm.dueDate
    })
    createVisible.value = false
    ElMessage.success(`已派工给「${createForm.team}」，限期 ${createForm.dueDate}，缺陷状态已置为已派工`)
  } finally {
    createSubmitting.value = false
  }
}

/* ---------------- 状态流转 ---------------- */
async function advance(row: WorkOrderRow): Promise<void> {
  if (row.order.state === '待验收') {
    openAccept(row.order)
    return
  }
  const next = await workOrderStore.advanceState(row.order.id)
  if (next) ElMessage.success(`工单已推进到「${next}」`)
  else ElMessage.info('该工单已闭环，如需修正请使用「撤回验收」')
}

const acceptVisible = ref(false)
const acceptSubmitting = ref(false)
const acceptTarget = ref<WorkOrder | null>(null)
const acceptForm = reactive({ acceptor: '' })
const acceptFormRef = ref<FormInstance>()
const acceptRules: FormRules = {
  acceptor: [{ required: true, message: '请填写验收人', trigger: 'blur' }]
}

function openAccept(order: WorkOrder): void {
  acceptTarget.value = order
  acceptForm.acceptor = order.acceptor || ''
  acceptVisible.value = true
}

async function submitAccept(): Promise<void> {
  if (!acceptFormRef.value || !acceptTarget.value) return
  const valid = await acceptFormRef.value.validate().catch(() => false)
  if (!valid) return
  acceptSubmitting.value = true
  try {
    await workOrderStore.acceptOrder(acceptTarget.value.id, acceptForm.acceptor)
    acceptVisible.value = false
    ElMessage.success('验收通过，工单已闭环，对应缺陷已回写为「已修复」')
  } finally {
    acceptSubmitting.value = false
  }
}

async function reopen(row: WorkOrderRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '撤回验收会把工单退回「待验收」，并把缺陷改回「已派工」。确认撤回？',
      '撤回验收确认',
      { type: 'warning', confirmButtonText: '确认撤回', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await workOrderStore.reopenOrder(row.order.id)
  ElMessage.success('已撤回验收')
}

/* ---------------- 编辑 / 删除 ---------------- */
const editVisible = ref(false)
const editSubmitting = ref(false)
const editId = ref<string | null>(null)
const editForm = reactive({
  team: WORK_TEAMS[0],
  dueDate: todayString(),
  state: '待派' as WorkOrderState,
  acceptor: ''
})

function openEdit(order: WorkOrder): void {
  editId.value = order.id
  editForm.team = order.team
  editForm.dueDate = order.dueDate
  editForm.state = order.state
  editForm.acceptor = order.acceptor
  editVisible.value = true
}

async function submitEdit(): Promise<void> {
  if (!editId.value) return
  editSubmitting.value = true
  try {
    const closed = editForm.state === '已闭环'
    await workOrderStore.updateWorkOrder(editId.value, {
      team: editForm.team,
      dueDate: editForm.dueDate,
      state: editForm.state,
      acceptor: editForm.acceptor,
      closedAt: closed ? Date.now() : null
    })
    const order = workOrderStore.orderById(editId.value)
    if (order) {
      await defectStore.setState(order.defectId, closed ? '已修复' : '已派工')
    }
    editVisible.value = false
    ElMessage.success('工单信息已更新，并同步了缺陷状态')
  } finally {
    editSubmitting.value = false
  }
}

async function removeOrder(row: WorkOrderRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除工单 #${row.order.id.slice(-6)}（${row.order.team} · ${row.order.state}）？删除后缺陷会回到「待处理」。`,
      '删除工单确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await workOrderStore.removeWorkOrder(row.order.id)
  ElMessage.success('工单已删除，缺陷状态已同步')
}

function locate(row: WorkOrderRow): void {
  if (!row.blade) {
    ElMessage.warning('该工单缺少叶片归属，无法定位')
    return
  }
  bladeStore.setCurrentBlade(row.blade.id)
  void router.push(`/blades/${row.blade.id}/segments`)
}

async function handleSeed(): Promise<void> {
  const seeded = await seedDemoData()
  if (seeded) {
    ElMessage.success('已生成演示数据：2 台机组 × 各 2 片叶片 × 各 3 个展向分段与 4 张工单')
  } else {
    ElMessage.info('本地已有数据，未重复播种')
  }
}

const stats = computed(() => workOrderStore.stats)
const tableRows = computed(() => workOrderStore.sortedRows)
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>维修工单</h2>
        <p>按班组与状态筛选，派工后跟进限期；验收通过即回写缺陷为「已修复」，形成闭环。</p>
      </div>
      <div class="toolbar">
        <el-button :icon="Refresh" @click="workOrderStore.resetFilters()">清空筛选</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建工单</el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge label="工单总数" :value="stats.total" suffix="张" tone="primary" icon="Files" />
      <StatBadge label="待派" :value="stats.pending" suffix="张" tone="info" icon="Document" />
      <StatBadge label="处理中" :value="stats.processing" suffix="张" tone="warning" icon="Tools" />
      <StatBadge label="待验收" :value="stats.awaiting" suffix="张" tone="primary" icon="Odometer" />
      <StatBadge label="已闭环" :value="stats.closed" suffix="张" tone="success" icon="SuccessFilled" />
      <StatBadge label="超期未闭环" :value="stats.overdue" suffix="张" tone="danger" icon="WarningFilled" />
      <StatBadge
        label="闭环率"
        :value="stats.closedPercent"
        :percent="stats.closedPercent"
        suffix="%"
        tone="success"
        icon="PieChart"
      />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      :query-keys="queryKeys"
      keyword-placeholder="搜索班组 / 状态 / 验收人 / 机组…"
      switch-key="onlyOverdue"
      switch-label="仅看超期"
      :switch-value="workOrderStore.onlyOverdue"
      has-switch
      class="section-card"
      @change="handleFilterChange"
    />

    <div class="section-card">
      <div class="section-card__head">
        <h3>工单清单（当前筛选 {{ tableRows.length }} 张）</h3>
        <span class="muted">今天：{{ workOrderStore.today }}</span>
      </div>

      <EmptyPanel
        v-if="tableRows.length === 0"
        title="没有符合条件的工单"
        description="可以从缺陷标注台勾选缺陷批量派工，也可以直接在此新建工单。"
        action-text="新建工单"
        :show-seed="stats.total === 0"
        @action="openCreate"
        @seed="handleSeed"
      />

      <el-table v-else :data="tableRows" row-key="order.id" border>
        <el-table-column label="工单号" width="130">
          <template #default="{ row }">
            <span class="mono">#{{ row.order.id.slice(-6) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="缺陷定位" min-width="240">
          <template #default="{ row }">
            <div class="cell-stack">
              <span>
                {{ row.turbine?.code ?? '—' }}｜叶片 {{ row.blade?.serial ?? '—' }}｜
                {{ row.segment ? `第 ${row.segment.index} 段 · ${formatRange(row.segment.startM, row.segment.endM)}` : '分段缺失' }}
              </span>
              <span class="muted">
                {{ row.defect?.type ?? '缺陷已删除' }}｜{{ row.defect ? faceText(row.defect.face) : '—' }}｜
                {{ row.defect ? `${row.defect.positionM} m` : '—' }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="程度" width="180">
          <template #default="{ row }">
            <SeverityTag
              v-if="row.defect"
              :severity="row.defect.severity"
              :length-mm="row.defect.lengthMm"
              :width-mm="row.defect.widthMm"
              size="small"
            />
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="派工班组" prop="order.team" width="140" />
        <el-table-column label="限期" width="180">
          <template #default="{ row }">
            <div class="cell-stack">
              <span class="mono">{{ row.order.dueDate || '—' }}</span>
              <span v-if="row.order.state === '已闭环'" class="muted text-success">已闭环</span>
              <span v-else-if="row.overdue" class="text-danger">
                已超期 {{ Math.abs(daysLeft(row.order.dueDate)) }} 天
              </span>
              <span v-else class="muted">剩余 {{ daysLeft(row.order.dueDate) }} 天</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <span
              class="state-pill"
              :style="{ color: '#ffffff', backgroundColor: stateColor(row.order.state) }"
            >
              {{ row.order.state }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="验收人" width="110">
          <template #default="{ row }">{{ row.order.acceptor || '—' }}</template>
        </el-table-column>
        <el-table-column label="闭环时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.order.closedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.order.state !== '已闭环'"
              link
              type="primary"
              :icon="row.order.state === '待验收' ? Check : Right"
              @click="advance(row)"
            >
              {{ row.order.state === '待验收' ? '验收闭环' : '推进状态' }}
            </el-button>
            <el-button
              v-else
              link
              type="warning"
              :icon="RefreshLeft"
              @click="reopen(row)"
            >
              撤回验收
            </el-button>
            <el-button link type="primary" @click="openEdit(row.order)">编辑</el-button>
            <el-button link type="primary" @click="locate(row)">定位分段</el-button>
            <el-button link type="danger" @click="removeOrder(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="createVisible" title="新建维修工单（派工）" width="640px" destroy-on-close>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="110px">
        <el-form-item label="派工对象" prop="defectId">
          <el-select
            v-model="createForm.defectId"
            filterable
            class="full-width"
            placeholder="选择未闭环且尚未派工的缺陷"
          >
            <el-option
              v-for="row in dispatchable"
              :key="row.defect.id"
              :label="defectOptionLabel(row)"
              :value="row.defect.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="派工班组">
          <el-select v-model="createForm.team" class="full-width">
            <el-option v-for="team in WORK_TEAMS" :key="team" :label="team" :value="team" />
          </el-select>
        </el-form-item>
        <el-form-item label="限期">
          <el-date-picker v-model="createForm.dueDate" type="date" value-format="YYYY-MM-DD" />
          <el-button link type="primary" class="quick-date" @click="createForm.dueDate = dateAfter(3)">
            +3 天
          </el-button>
          <el-button link type="primary" @click="createForm.dueDate = dateAfter(14)">+14 天</el-button>
        </el-form-item>
        <el-alert
          v-if="dispatchable.length === 0"
          type="warning"
          :closable="false"
          show-icon
          title="当前没有可派工的缺陷：所有缺陷都已修复或已存在工单。"
        />
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createSubmitting" :disabled="dispatchable.length === 0" @click="submitCreate">
          确认派工
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="acceptVisible" title="闭环验收" width="520px" destroy-on-close>
      <el-form ref="acceptFormRef" :model="acceptForm" :rules="acceptRules" label-width="100px">
        <el-form-item label="工单">
          <span class="mono">#{{ acceptTarget?.id.slice(-6) }}</span>
          <span class="muted unit">{{ acceptTarget?.team }}｜限期 {{ acceptTarget?.dueDate }}</span>
        </el-form-item>
        <el-form-item label="验收人" prop="acceptor">
          <el-input v-model="acceptForm.acceptor" placeholder="如 赵鹏" clearable />
        </el-form-item>
        <el-alert
          type="success"
          :closable="false"
          show-icon
          title="验收通过后工单置为「已闭环」，对应缺陷回写为「已修复」。"
        />
      </el-form>
      <template #footer>
        <el-button @click="acceptVisible = false">取消</el-button>
        <el-button type="primary" :loading="acceptSubmitting" @click="submitAccept">确认验收</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑工单" width="560px" destroy-on-close>
      <el-form label-width="110px">
        <el-form-item label="派工班组">
          <el-select v-model="editForm.team" class="full-width">
            <el-option v-for="team in WORK_TEAMS" :key="team" :label="team" :value="team" />
          </el-select>
        </el-form-item>
        <el-form-item label="限期">
          <el-date-picker v-model="editForm.dueDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="工单状态">
          <el-select v-model="editForm.state" class="full-width">
            <el-option v-for="state in WORK_ORDER_STATES" :key="state" :label="state" :value="state" />
          </el-select>
        </el-form-item>
        <el-form-item label="验收人">
          <el-input v-model="editForm.acceptor" placeholder="闭环时填写的验收人" clearable />
        </el-form-item>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="手工把状态改为「已闭环」会同步把缺陷回写为「已修复」，并记录闭环时间。"
        />
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSubmitting" @click="submitEdit">保存</el-button>
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

.full-width {
  width: 100%;
}

.quick-date {
  margin-left: 8px;
}

.unit {
  margin-left: 8px;
  font-size: 12px;
}
</style>
