<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type UploadFile } from 'element-plus'
import { Delete, Document, Download, Refresh, Upload } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import SeverityTag from '@/components/common/SeverityTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useTurbineStore } from '@/stores/turbineStore'
import {
  DB_NAME,
  DB_VERSION,
  clearAllTables,
  readLastBackupAt,
  readStampedDbVersion,
  seedDemoData
} from '@/utils/db'
import {
  countPayload,
  exportBackupJson,
  exportReportJson,
  importBackup,
  readFileText,
  remapIds,
  validateBackup
} from '@/utils/export'
import { buildTurbineReport, reportToText, type TurbineReport } from '@/utils/report'
import { formatArea, formatSize } from '@/utils/severity'
import { FACE_LABEL, formatRange, type SegmentFace } from '@/types/segment'
import { DEFECT_STATE_COLOR, type DefectState } from '@/types/defect'
import type { BackupPayload } from '@/utils/db'

const turbineStore = useTurbineStore()

const selectedTurbineId = ref<string>(turbineStore.currentTurbineId ?? '')

watch(
  () => turbineStore.turbines.length,
  () => {
    const current = selectedTurbineId.value
    const stillExists = current.length > 0 && turbineStore.turbineById(current)
    if (stillExists) return
    const fallback =
      turbineStore.currentTurbineId && turbineStore.turbineById(turbineStore.currentTurbineId)
        ? turbineStore.currentTurbineId
        : turbineStore.turbines[0]?.id ?? ''
    selectedTurbineId.value = fallback
  },
  { immediate: true }
)

watch(selectedTurbineId, (value) => {
  if (value) turbineStore.setCurrentTurbine(value)
})

/** 按机组实时汇总缺陷统计并生成报告数据结构 */
const report = computed<TurbineReport | null>(() => {
  const turbine = turbineStore.turbineById(selectedTurbineId.value)
  if (!turbine) return null
  return buildTurbineReport(
    {
      id: turbine.id,
      code: turbine.code,
      model: turbine.model,
      hubHeightM: turbine.hubHeightM,
      commissionDate: turbine.commissionDate,
      bladeCount: turbine.bladeCount
    },
    {
      blades: turbineStore.blades,
      segments: turbineStore.segments,
      defects: turbineStore.defects,
      workOrders: turbineStore.workOrders
    },
    DB_VERSION
  )
})

const dbMeta = computed(() => ({
  name: DB_NAME,
  version: DB_VERSION,
  stampedVersion: readStampedDbVersion(),
  lastBackupAt: readLastBackupAt(),
  turbines: turbineStore.turbines.length,
  blades: turbineStore.blades.length,
  segments: turbineStore.segments.length,
  defects: turbineStore.defects.length,
  workOrders: turbineStore.workOrders.length
}))

/** 面位中文标签（模板内免去类型断言） */
function faceText(face: string): string {
  return FACE_LABEL[face as SegmentFace] ?? face
}

/** 缺陷状态配色（模板内免去类型断言） */
function stateColor(state: string): string {
  return DEFECT_STATE_COLOR[state as DefectState] ?? '#4a5b63'
}

const structureVisible = ref(false)
const structureText = computed(() => (report.value ? reportToText(report.value) : '请先选择机组'))

function openStructure(): void {
  structureVisible.value = true
}

/* ---------------- 导出 ---------------- */
async function handleExportBackup(): Promise<void> {
  const result = await exportBackupJson()
  ElMessage.success(
    `已导出备份 ${result.fileName}（机组 ${result.counts.turbines} · 叶片 ${result.counts.blades} · 分段 ${result.counts.segments} · 缺陷 ${result.counts.defects} · 工单 ${result.counts.workOrders}）`
  )
}

function handleExportReport(): void {
  const current = report.value
  if (!current) {
    ElMessage.warning('请先选择机组')
    return
  }
  const fileName = exportReportJson(current)
  ElMessage.success(`已导出巡检报告 ${fileName}`)
}

/* ---------------- 导入 ---------------- */
const importVisible = ref(false)
const importSubmitting = ref(false)
const importFile = ref('')
const importMode = ref<'overwrite' | 'merge' | 'append'>('merge')
const importErrors = ref<string[]>([])
const importPayload = ref<BackupPayload | null>(null)
const importCounts = ref<Record<string, number> | null>(null)

async function handleImportFile(file: UploadFile): Promise<void> {
  const raw = file.raw
  if (!raw) return
  importFile.value = raw.name
  const text = await readFileText(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    ElMessage.error('JSON 解析失败，请确认文件内容完整')
    return
  }
  const result = validateBackup(parsed)
  if (!result.ok || !result.payload) {
    importErrors.value = result.errors
    importPayload.value = null
    importCounts.value = null
    importVisible.value = true
    return
  }
  importErrors.value = []
  importPayload.value = result.payload
  importCounts.value = countPayload(result.payload)
  importMode.value = 'merge'
  importVisible.value = true
}

async function submitImport(): Promise<void> {
  const payload = importPayload.value
  if (!payload) return
  importSubmitting.value = true
  try {
    if (importMode.value === 'overwrite') {
      await importBackup(payload, true)
    } else if (importMode.value === 'append') {
      await importBackup(remapIds(payload), false)
    } else {
      await importBackup(payload, false)
    }
    importVisible.value = false
    const modeText =
      importMode.value === 'overwrite' ? '覆盖导入' : importMode.value === 'append' ? '追加导入（已重新分配 id）' : '按 id 合并导入'
    ElMessage.success(`${modeText}完成：机组 ${payload.turbines.length} · 叶片 ${payload.blades.length} · 分段 ${payload.segments.length} · 缺陷 ${payload.defects.length} · 工单 ${payload.workOrders.length}`)
  } finally {
    importSubmitting.value = false
  }
}

/* ---------------- 本地数据维护 ---------------- */
const maintenanceWorking = ref(false)

async function handleClear(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '清空会删除本浏览器 IndexedDB 中的全部机组、叶片、分段、缺陷与工单记录，且不可恢复。确认清空？',
      '清空本地数据确认',
      { type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  maintenanceWorking.value = true
  try {
    await clearAllTables()
    ElMessage.success('本地数据已清空，可点击「重新播种演示数据」恢复样例')
  } finally {
    maintenanceWorking.value = false
  }
}

async function handleReseed(): Promise<void> {
  maintenanceWorking.value = true
  try {
    await clearAllTables()
    const seeded = await seedDemoData()
    if (seeded) ElMessage.success('已重新播种演示数据（2 台机组 × 各 2 片叶片 × 各 3 个分段）')
    else ElMessage.warning('播种未执行，请刷新页面重试')
  } finally {
    maintenanceWorking.value = false
  }
}

const bladePanels = computed(() => report.value?.blades ?? [])
const activePanels = ref<string[]>([])

watch(bladePanels, (panels) => {
  if (activePanels.value.length === 0 && panels.length > 0) {
    activePanels.value = panels.map((panel) => panel.blade.id)
  }
})
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>报告与导出</h2>
        <p>按机组汇总巡检结果生成报告预览，查看本地数据结构版本，并导出 / 导入 JSON 数据。</p>
      </div>
      <div class="toolbar">
        <el-select v-model="selectedTurbineId" placeholder="选择机组" class="turbine-select">
          <el-option
            v-for="turbine in turbineStore.turbines"
            :key="turbine.id"
            :label="`${turbine.code}（${turbine.model}）`"
            :value="turbine.id"
          />
        </el-select>
        <el-button :icon="Document" @click="openStructure">查看导出结构</el-button>
        <el-button :icon="Download" @click="handleExportReport" :disabled="!report">导出本机组报告</el-button>
        <el-button type="primary" :icon="Download" @click="handleExportBackup">导出全量备份</el-button>
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".json,application/json"
          :on-change="(file: UploadFile) => handleImportFile(file)"
        >
          <el-button :icon="Upload">导入 JSON</el-button>
        </el-upload>
      </div>
    </div>

    <EmptyPanel
      v-if="turbineStore.turbines.length === 0"
      title="暂无可生成报告的机组"
      description="先建立机组台账，或直接播种演示数据后再生成巡检报告。"
      :show-seed="true"
      @seed="handleReseed"
    />

    <template v-else>
      <div class="section-card">
        <div class="section-card__head">
          <h3>本地数据与结构版本</h3>
          <div class="toolbar">
            <el-button :icon="Refresh" :loading="maintenanceWorking" @click="handleReseed">
              重新播种演示数据
            </el-button>
            <el-button type="danger" plain :icon="Delete" :loading="maintenanceWorking" @click="handleClear">
              清空本地数据
            </el-button>
          </div>
        </div>
        <el-descriptions :column="4" size="small" border>
          <el-descriptions-item label="IndexedDB 库名">{{ dbMeta.name }}</el-descriptions-item>
          <el-descriptions-item label="结构版本">v{{ dbMeta.version }}</el-descriptions-item>
          <el-descriptions-item label="本地标记版本">v{{ dbMeta.stampedVersion }}</el-descriptions-item>
          <el-descriptions-item label="上次备份">
            {{ dbMeta.lastBackupAt ? dbMeta.lastBackupAt.replace('T', ' ').slice(0, 19) : '尚未备份' }}
          </el-descriptions-item>
          <el-descriptions-item label="机组">{{ dbMeta.turbines }} 台</el-descriptions-item>
          <el-descriptions-item label="叶片">{{ dbMeta.blades }} 片</el-descriptions-item>
          <el-descriptions-item label="展向分段">{{ dbMeta.segments }} 段</el-descriptions-item>
          <el-descriptions-item label="缺陷 / 工单">
            {{ dbMeta.defects }} 条 / {{ dbMeta.workOrders }} 张
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <template v-if="report">
        <div class="stat-row">
          <StatBadge label="叶片" :value="report.summary.bladeCount" suffix="片" tone="info" icon="Grid" />
          <StatBadge label="展向分段" :value="report.summary.segmentCount" suffix="段" tone="default" icon="Histogram" />
          <StatBadge label="缺陷总数" :value="report.summary.defectCount" suffix="条" tone="primary" icon="WarningFilled" />
          <StatBadge label="未闭环" :value="report.summary.openCount" suffix="条" tone="danger" icon="CircleCloseFilled" />
          <StatBadge
            label="重度占比"
            :value="report.summary.heavyPercent"
            :percent="report.summary.heavyPercent"
            suffix="%"
            tone="danger"
            icon="PieChart"
          />
          <StatBadge
            label="闭环率"
            :value="report.summary.closedPercent"
            :percent="report.summary.closedPercent"
            suffix="%"
            tone="success"
            icon="SuccessFilled"
          />
          <StatBadge label="损伤面积" :value="formatArea(report.summary.areaCm2)" tone="warning" icon="Odometer" />
          <StatBadge label="工单 / 超期" :value="`${report.summary.workOrderCount} / ${report.summary.overdueCount}`" tone="info" icon="Files" />
        </div>

        <div class="section-card">
          <div class="section-card__head">
            <h3>
              巡检报告预览 · {{ report.turbine.code }}（{{ report.turbine.model }}）
            </h3>
            <span class="muted">风险分 {{ report.summary.riskScore }} · 生成时间 {{ report.generatedAt.replace('T', ' ').slice(0, 19) }}</span>
          </div>
          <el-descriptions :column="4" size="small" border class="report-meta">
            <el-descriptions-item label="轮毂高度">{{ report.turbine.hubHeightM }} m</el-descriptions-item>
            <el-descriptions-item label="投运日期">{{ report.turbine.commissionDate }}</el-descriptions-item>
            <el-descriptions-item label="登记叶片数">{{ report.turbine.bladeCount }} 片</el-descriptions-item>
            <el-descriptions-item label="结构版本">v{{ report.dbVersion }}</el-descriptions-item>
          </el-descriptions>

          <div class="dist-grid">
            <div class="dist-cell">
              <h4>严重程度分布</h4>
              <div v-for="row in report.severityDist" :key="row.label" class="dist-row">
                <span class="dist-row__label">{{ row.label }}</span>
                <el-progress :percentage="row.percent" :stroke-width="10" />
                <span class="dist-row__count mono">{{ row.count }} 条</span>
              </div>
            </div>
            <div class="dist-cell">
              <h4>缺陷类型分布</h4>
              <div v-for="row in report.typeDist" :key="row.label" class="dist-row">
                <span class="dist-row__label">{{ row.label }}</span>
                <el-progress :percentage="row.percent" :stroke-width="10" color="#0f5c7a" />
                <span class="dist-row__count mono">{{ row.count }} 条</span>
              </div>
            </div>
            <div class="dist-cell">
              <h4>处置状态分布</h4>
              <div v-for="row in report.stateDist" :key="row.label" class="dist-row">
                <span class="dist-row__label">{{ row.label }}</span>
                <el-progress :percentage="row.percent" :stroke-width="10" color="#1e8449" />
                <span class="dist-row__count mono">{{ row.count }} 条</span>
              </div>
            </div>
          </div>
        </div>

        <div class="section-card">
          <div class="section-card__head">
            <h3>叶片与展向分段明细</h3>
            <span class="muted">共 {{ bladePanels.length }} 片叶片</span>
          </div>
          <EmptyPanel
            v-if="bladePanels.length === 0"
            title="该机组尚未登记叶片"
            description="到机组合账编辑机组补足叶片数，或在叶片分段页生成展向分段。"
            compact
          />
          <el-collapse v-else v-model="activePanels">
            <el-collapse-item
              v-for="panel in bladePanels"
              :key="panel.blade.id"
              :name="panel.blade.id"
            >
              <template #title>
                <div class="panel-title">
                  <strong>叶片 {{ panel.blade.serial }}</strong>
                  <span class="muted">
                    {{ panel.blade.lengthM }} m · {{ panel.blade.material }} · {{ panel.segments.length }} 段
                  </span>
                  <el-tag size="small" type="warning">缺陷 {{ panel.defectCount }} 条</el-tag>
                  <el-tag size="small" type="danger" effect="plain">未闭环 {{ panel.openCount }} 条</el-tag>
                  <el-tag size="small" type="info" effect="plain">重度 {{ panel.heavyCount }} 条</el-tag>
                  <el-tag size="small" effect="plain">损伤 {{ formatArea(panel.areaCm2) }}</el-tag>
                </div>
              </template>
              <el-table :data="panel.segments" size="small" border>
                <el-table-column label="段序号" width="90">
                  <template #default="{ row }">第 {{ row.segment.index }} 段</template>
                </el-table-column>
                <el-table-column label="展向区间" width="150">
                  <template #default="{ row }">
                    <span class="mono">{{ formatRange(row.segment.startM, row.segment.endM) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="检修面" width="130">
                  <template #default="{ row }">{{ faceText(row.segment.face) }}</template>
                </el-table-column>
                <el-table-column label="翼型" prop="segment.airfoil" width="150" />
                <el-table-column label="剖面图" prop="segment.sectionImage" min-width="180">
                  <template #default="{ row }">
                    <span class="mono">{{ row.segment.sectionImage || '未上传' }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="缺陷 / 未闭环 / 重度" width="200">
                  <template #default="{ row }">
                    {{ row.defectCount }} / {{ row.openCount }} / {{ row.heavyCount }}
                  </template>
                </el-table-column>
                <el-table-column label="损伤面积" width="120">
                  <template #default="{ row }">{{ formatArea(row.areaCm2) }}</template>
                </el-table-column>
                <el-table-column type="expand" width="60">
                  <template #default="{ row }">
                    <el-table :data="row.defects" size="small" border class="defect-subtable">
                      <el-table-column label="类型" prop="type" width="110" />
                      <el-table-column label="程度" width="150">
                        <template #default="{ row: defect }">
                          <SeverityTag :severity="defect.severity" size="small" />
                        </template>
                      </el-table-column>
                      <el-table-column label="尺寸" width="180">
                        <template #default="{ row: defect }">
                          <span class="mono">{{ formatSize(defect.lengthMm, defect.widthMm) }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column label="面位" prop="face" width="90" />
                      <el-table-column label="展向位置" width="110">
                        <template #default="{ row: defect }">{{ defect.positionM }} m</template>
                      </el-table-column>
                      <el-table-column label="发现日期" prop="foundAt" width="120" />
                      <el-table-column label="状态" width="100">
                        <template #default="{ row: defect }">
                          <span :style="{ color: stateColor(defect.state), fontWeight: 600 }">
                            {{ defect.state }}
                          </span>
                        </template>
                      </el-table-column>
                      <template #empty>
                        <span class="muted">该分段暂无缺陷</span>
                      </template>
                    </el-table>
                  </template>
                </el-table-column>
                <template #empty>
                  <span class="muted">该叶片尚未划分展向分段</span>
                </template>
              </el-table>
            </el-collapse-item>
          </el-collapse>
        </div>

        <div class="section-card">
          <div class="section-card__head">
            <h3>维修工单跟踪</h3>
            <span class="muted">共 {{ report.workOrders.length }} 张</span>
          </div>
          <el-table :data="report.workOrders" size="small" border>
            <el-table-column label="工单号" width="120">
              <template #default="{ row }">
                <span class="mono">#{{ row.order.id.slice(-6) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="定位" min-width="180">
              <template #default="{ row }">
                叶片 {{ row.bladeSerial }}｜第 {{ row.segmentIndex }} 段
              </template>
            </el-table-column>
            <el-table-column label="缺陷" min-width="150">
              <template #default="{ row }">{{ row.defectType }}（{{ row.severity }}）</template>
            </el-table-column>
            <el-table-column label="班组" prop="order.team" width="140" />
            <el-table-column label="限期" width="130">
              <template #default="{ row }">
                <span class="mono">{{ row.order.dueDate }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                {{ row.order.state }}
                <el-tag v-if="row.overdue" size="small" type="danger" effect="dark">超期</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="验收人" width="110">
              <template #default="{ row }">{{ row.order.acceptor || '—' }}</template>
            </el-table-column>
            <template #empty>
              <span class="muted">该机组暂无维修工单</span>
            </template>
          </el-table>
        </div>
      </template>

      <EmptyPanel
        v-else
        title="请选择机组"
        description="选择一台机组后即可生成巡检报告预览。"
        compact
      />
    </template>

    <el-dialog v-model="structureVisible" title="导出结构预览（纯文本）" width="860px">
      <pre class="structure-preview">{{ structureText }}</pre>
      <template #footer>
        <el-button @click="structureVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importVisible" title="导入本地数据" width="640px" destroy-on-close>
      <template v-if="importPayload">
        <el-alert
          type="success"
          :closable="false"
          show-icon
          :title="`文件 ${importFile} 校验通过，请选择导入方式。`"
          class="import-alert"
        />
        <el-descriptions v-if="importCounts" :column="3" size="small" border class="import-meta">
          <el-descriptions-item label="机组">{{ importCounts.turbines }}</el-descriptions-item>
          <el-descriptions-item label="叶片">{{ importCounts.blades }}</el-descriptions-item>
          <el-descriptions-item label="分段">{{ importCounts.segments }}</el-descriptions-item>
          <el-descriptions-item label="缺陷">{{ importCounts.defects }}</el-descriptions-item>
          <el-descriptions-item label="工单">{{ importCounts.workOrders }}</el-descriptions-item>
          <el-descriptions-item label="文件版本">v{{ importPayload.dbVersion }}</el-descriptions-item>
        </el-descriptions>
        <el-radio-group v-model="importMode" class="import-mode">
          <el-radio value="overwrite">覆盖导入（先清空本地全部数据）</el-radio>
          <el-radio value="merge">按 id 合并（同 id 覆盖）</el-radio>
          <el-radio value="append">追加导入（重新分配 id，不覆盖现有记录）</el-radio>
        </el-radio-group>
      </template>
      <template v-else>
        <el-alert
          type="error"
          :closable="false"
          show-icon
          title="文件校验未通过，未执行任何写入。"
          class="import-alert"
        />
        <ul class="import-errors">
          <li v-for="error in importErrors" :key="error">{{ error }}</li>
        </ul>
      </template>
      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button
          v-if="importPayload"
          type="primary"
          :loading="importSubmitting"
          @click="submitImport"
        >
          确认导入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.turbine-select {
  width: 240px;
}

.report-meta {
  margin-bottom: 14px;
}

.dist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.dist-cell h4 {
  margin: 0 0 8px;
  font-size: 14px;
}

.dist-row {
  display: grid;
  grid-template-columns: 76px 1fr 70px;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}

.dist-row__count {
  text-align: right;
  color: #4a5b63;
}

.panel-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.defect-subtable {
  margin: 8px 12px;
}

.structure-preview {
  max-height: 520px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  background: #f5f9fb;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.import-alert {
  margin-bottom: 12px;
}

.import-meta {
  margin-bottom: 12px;
}

.import-mode {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.import-errors {
  margin: 8px 0 0;
  padding-left: 20px;
  color: #c0392b;
  font-size: 13px;
}
</style>
