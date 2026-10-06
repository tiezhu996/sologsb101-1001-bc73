<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Plus, Position, Refresh, Tools, WarningFilled } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useTurbineStore } from '@/stores/turbineStore'
import { useBladeStore } from '@/stores/bladeStore'
import { useDefectStore } from '@/stores/defectStore'
import { useWorkOrderStore } from '@/stores/workOrderStore'
import { seedDemoData } from '@/utils/db'
import { formatArea } from '@/utils/severity'
import {
  BLADE_MATERIALS,
  DEFAULT_BLADE_LENGTH_M,
  type BladeMaterial
} from '@/types/blade'
import {
  DEFAULT_BLADE_COUNT,
  MAX_BLADE_COUNT,
  MIN_BLADE_COUNT,
  TURBINE_MODELS,
  commissionYearOf,
  type Turbine
} from '@/types/turbine'

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

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)
const submitting = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  code: '',
  model: TURBINE_MODELS[0],
  hubHeightM: 110,
  commissionDate: todayString(),
  bladeCount: DEFAULT_BLADE_COUNT,
  bladeLengthM: DEFAULT_BLADE_LENGTH_M,
  bladeMaterial: '玻璃纤维' as BladeMaterial
})

const rules: FormRules = {
  code: [{ required: true, message: '请填写机组编号，如 WT-A01', trigger: 'blur' }],
  model: [{ required: true, message: '请选择或输入机型', trigger: 'change' }],
  commissionDate: [{ required: true, message: '请选择投运日期', trigger: 'change' }]
}

const filterModel = computed<FilterModel>(() => ({
  keyword: turbineStore.keyword,
  model: turbineStore.modelFilter,
  year: turbineStore.yearFilter
}))

const filterSelects = computed(() => [
  {
    key: 'model',
    label: '机型',
    options: turbineStore.modelOptions.map((model) => ({ label: model, value: model })),
    placeholder: '选择机型'
  },
  {
    key: 'year',
    label: '投运年份',
    options: turbineStore.yearOptions.map((year) => ({ label: `${year} 年`, value: year })),
    placeholder: '选择年份'
  }
])

const cards = computed(() =>
  turbineStore.filteredTurbines.map((turbine) => {
    const stat = turbineStore.statMap[turbine.id]
    const aggregate = defectStore.turbineAggregate[turbine.id]
    return {
      turbine,
      blades: turbineStore.bladesOfTurbine(turbine.id),
      bladeCount: stat?.bladeCount ?? 0,
      segmentCount: stat?.segmentCount ?? 0,
      defectCount: stat?.defectCount ?? 0,
      openCount: stat?.openCount ?? 0,
      heavyPercent: stat?.heavyPercent ?? 0,
      areaText: formatArea(aggregate?.areaCm2 ?? 0),
      orderCount: turbineStore.workOrdersOfTurbine(turbine.id).length,
      year: commissionYearOf(turbine)
    }
  })
)

function handleFilterChange(value: FilterModel): void {
  turbineStore.keyword = typeof value.keyword === 'string' ? value.keyword : ''
  turbineStore.modelFilter = Array.isArray(value.model) ? value.model : []
  turbineStore.yearFilter = Array.isArray(value.year) ? value.year : []
}

function openCreate(): void {
  dialogMode.value = 'create'
  editingId.value = null
  form.code = ''
  form.model = turbineStore.modelOptions[0] ?? TURBINE_MODELS[0]
  form.hubHeightM = 110
  form.commissionDate = todayString()
  form.bladeCount = DEFAULT_BLADE_COUNT
  form.bladeLengthM = DEFAULT_BLADE_LENGTH_M
  form.bladeMaterial = '玻璃纤维'
  dialogVisible.value = true
}

function openEdit(turbine: Turbine): void {
  dialogMode.value = 'edit'
  editingId.value = turbine.id
  form.code = turbine.code
  form.model = turbine.model
  form.hubHeightM = turbine.hubHeightM
  form.commissionDate = turbine.commissionDate
  form.bladeCount = turbineStore.bladesOfTurbine(turbine.id).length || turbine.bladeCount
  const first = turbineStore.bladesOfTurbine(turbine.id)[0]
  form.bladeLengthM = first?.lengthM ?? DEFAULT_BLADE_LENGTH_M
  form.bladeMaterial = first?.material ?? '玻璃纤维'
  dialogVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (dialogMode.value === 'create') {
      const turbine = await turbineStore.createTurbine({
        code: form.code,
        model: form.model,
        hubHeightM: form.hubHeightM,
        commissionDate: form.commissionDate,
        bladeCount: form.bladeCount,
        bladeLengthM: form.bladeLengthM,
        bladeMaterial: form.bladeMaterial
      })
      dialogVisible.value = false
      ElMessage.success(
        `已新建机组 ${turbine.code}，并按 ${form.bladeCount} 片派生叶片记录，请继续划分展向分段`
      )
    } else if (editingId.value) {
      const id = editingId.value
      await turbineStore.updateTurbine(id, {
        code: form.code.trim(),
        model: form.model,
        hubHeightM: form.hubHeightM,
        commissionDate: form.commissionDate
      })
      const changed = await turbineStore.syncBladeCount(id, form.bladeCount, {
        lengthM: form.bladeLengthM,
        material: form.bladeMaterial
      })
      dialogVisible.value = false
      const tip =
        changed === 0
          ? '机组信息已更新'
          : changed > 0
            ? `机组信息已更新，新增 ${changed} 片叶片`
            : `机组信息已更新，删除 ${Math.abs(changed)} 片叶片及其分段与缺陷`
      ElMessage.success(tip)
    }
  } finally {
    submitting.value = false
  }
}

function openBlade(turbine: Turbine, bladeId: string): void {
  turbineStore.setCurrentTurbine(turbine.id)
  bladeStore.setCurrentBlade(bladeId)
  void router.push(`/blades/${bladeId}/segments`)
}

function openBladePage(turbine: Turbine): void {
  const blade = turbineStore.bladesOfTurbine(turbine.id)[0]
  if (!blade) {
    ElMessage.warning('该机组尚无叶片记录，请先编辑机组补足叶片数')
    return
  }
  openBlade(turbine, blade.id)
}

function openDefects(turbine: Turbine): void {
  turbineStore.setCurrentTurbine(turbine.id)
  defectStore.patchFilter({ turbines: [turbine.id] })
  void router.push('/defects')
}

function openWorkOrders(turbine: Turbine): void {
  turbineStore.setCurrentTurbine(turbine.id)
  workOrderStore.resetFilters()
  void router.push('/workorders')
}

async function handleRemove(turbine: Turbine): Promise<void> {
  const stat = turbineStore.statMap[turbine.id]
  try {
    await ElMessageBox.confirm(
      `删除机组 ${turbine.code} 会级联删除其 ${stat?.bladeCount ?? 0} 片叶片、${
        stat?.segmentCount ?? 0
      } 个展向分段、${stat?.defectCount ?? 0} 条缺陷与相关工单，且不可恢复。确认删除？`,
      '删除机组确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await turbineStore.removeTurbine(turbine.id)
  ElMessage.success(`已删除机组 ${turbine.code} 及其全部下级记录`)
}

async function handleSeed(): Promise<void> {
  const seeded = await seedDemoData()
  if (seeded) {
    ElMessage.success('已生成 2 台机组 × 各 2 片叶片 × 各 3 个展向分段的演示数据')
  } else {
    ElMessage.info('本地已有数据，未重复播种')
  }
}

const summary = computed(() => turbineStore.totals)
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>机组合账</h2>
        <p>建立风电机组与叶片台账，按机型与投运年份筛选；新建机组后自动按叶片数派生叶片记录。</p>
      </div>
      <div class="toolbar">
        <el-button :icon="Refresh" @click="turbineStore.resetFilters()">清空筛选</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建机组</el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge label="机组总数" :value="summary.turbines" suffix="台" tone="primary" icon="Odometer" />
      <StatBadge label="叶片总数" :value="summary.blades" suffix="片" tone="info" icon="Grid" />
      <StatBadge label="展向分段" :value="summary.segments" suffix="段" tone="default" icon="Histogram" />
      <StatBadge label="缺陷总数" :value="summary.defects" suffix="条" tone="warning" icon="WarningFilled" />
      <StatBadge label="未闭环缺陷" :value="summary.openDefects" suffix="条" tone="danger" icon="Files" />
      <StatBadge
        label="重度占比"
        :value="summary.heavyPercent"
        :percent="summary.heavyPercent"
        suffix="%"
        tone="danger"
        icon="PieChart"
      />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      keyword-placeholder="搜索机组编号 / 机型 / 投运日期…"
      class="section-card"
      @change="handleFilterChange"
    />

    <EmptyPanel
      v-if="cards.length === 0"
      title="暂无机组记录"
      description="新建一台风电机组，系统会按叶片数自动派生叶片记录，随后即可划分展向分段并标注缺陷。"
      action-text="新建机组"
      :show-seed="summary.turbines === 0"
      @action="openCreate"
      @seed="handleSeed"
    />

    <div v-else class="turbine-grid">
      <el-card v-for="card in cards" :key="card.turbine.id" shadow="hover" class="turbine-card">
        <template #header>
          <div class="turbine-card__head">
            <div class="turbine-card__title">
              <strong>{{ card.turbine.code }}</strong>
              <el-tag size="small" effect="plain" type="info">{{ card.turbine.model }}</el-tag>
            </div>
            <el-tag v-if="card.openCount > 0" size="small" type="warning" effect="dark">
              未闭环 {{ card.openCount }}
            </el-tag>
            <el-tag v-else size="small" type="success" effect="plain">缺陷已闭环</el-tag>
          </div>
        </template>

        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="轮毂高度">{{ card.turbine.hubHeightM }} m</el-descriptions-item>
          <el-descriptions-item label="投运日期">{{ card.turbine.commissionDate }}</el-descriptions-item>
          <el-descriptions-item label="叶片数">
            {{ card.bladeCount }} 片 / 登记 {{ card.turbine.bladeCount }} 片
          </el-descriptions-item>
          <el-descriptions-item label="展向分段">{{ card.segmentCount }} 段</el-descriptions-item>
          <el-descriptions-item label="缺陷总数">
            <span class="mono">{{ card.defectCount }}</span> 条
          </el-descriptions-item>
          <el-descriptions-item label="未闭环">
            <span class="mono text-danger">{{ card.openCount }}</span> 条
          </el-descriptions-item>
          <el-descriptions-item label="损伤面积">{{ card.areaText }}</el-descriptions-item>
          <el-descriptions-item label="维修工单">{{ card.orderCount }} 张</el-descriptions-item>
        </el-descriptions>

        <div class="turbine-card__progress">
          <span class="muted">重度占比 {{ card.heavyPercent }}%</span>
          <el-progress :percentage="card.heavyPercent" :stroke-width="8" color="#c0392b" />
        </div>

        <div class="turbine-card__blades">
          <span class="muted">叶片：</span>
          <el-button
            v-for="blade in card.blades"
            :key="blade.id"
            size="small"
            :type="bladeStore.currentBladeId === blade.id ? 'primary' : 'default'"
            @click="openBlade(card.turbine, blade.id)"
          >
            叶片 {{ blade.serial }}（{{ blade.lengthM }} m）
          </el-button>
          <span v-if="card.blades.length === 0" class="muted">尚未派生叶片</span>
        </div>

        <div class="turbine-card__actions">
          <el-button type="primary" :icon="Position" @click="openBladePage(card.turbine)">
            叶片与分段
          </el-button>
          <el-button :icon="WarningFilled" @click="openDefects(card.turbine)">查看缺陷</el-button>
          <el-button :icon="Tools" @click="openWorkOrders(card.turbine)">工单</el-button>
          <el-button @click="openEdit(card.turbine)">编辑</el-button>
          <el-button type="danger" plain @click="handleRemove(card.turbine)">删除</el-button>
        </div>
      </el-card>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建风电机组' : `编辑机组 ${form.code}`"
      width="640px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="机组编号" prop="code">
          <el-input v-model="form.code" placeholder="如 WT-A01" clearable />
        </el-form-item>
        <el-form-item label="机型" prop="model">
          <el-select
            v-model="form.model"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入机型"
            class="full-width"
          >
            <el-option v-for="model in TURBINE_MODELS" :key="model" :label="model" :value="model" />
          </el-select>
        </el-form-item>
        <el-form-item label="轮毂高度">
          <el-input-number v-model="form.hubHeightM" :min="40" :max="200" :step="5" />
          <span class="muted unit">米</span>
        </el-form-item>
        <el-form-item label="投运日期" prop="commissionDate">
          <el-date-picker
            v-model="form.commissionDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择投运日期"
          />
        </el-form-item>
        <el-form-item label="叶片数">
          <el-input-number
            v-model="form.bladeCount"
            :min="MIN_BLADE_COUNT"
            :max="MAX_BLADE_COUNT"
            :step="1"
          />
          <span class="muted unit">
            {{ dialogMode === 'create' ? '保存后按此数量派生叶片记录' : '调整后会同步新增 / 删除叶片' }}
          </span>
        </el-form-item>
        <el-form-item label="叶片长度">
          <el-input-number v-model="form.bladeLengthM" :min="20" :max="130" :step="0.5" :precision="1" />
          <span class="muted unit">米</span>
        </el-form-item>
        <el-form-item label="叶片材质">
          <el-select v-model="form.bladeMaterial" class="full-width">
            <el-option v-for="material in BLADE_MATERIALS" :key="material" :label="material" :value="material" />
          </el-select>
        </el-form-item>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="叶片长度与材质仅用于派生叶片记录；展向分段请到「叶片分段与剖面」按段数批量生成。"
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ dialogMode === 'create' ? '保存并派生叶片' : '保存修改' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.turbine-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
  gap: 16px;
}

.turbine-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.turbine-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
}

.turbine-card__progress {
  margin: 12px 0 4px;
}

.turbine-card__blades {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.turbine-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.full-width {
  width: 100%;
}

.unit {
  margin-left: 8px;
  font-size: 12px;
}
</style>
