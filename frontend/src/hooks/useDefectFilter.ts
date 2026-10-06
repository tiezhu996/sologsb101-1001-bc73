import { computed, onMounted, type ComputedRef, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useDefectStore, type DefectRow } from '@/stores/defectStore'
import { useTurbineStore } from '@/stores/turbineStore'
import {
  createEmptyDefectFilter,
  DEFECT_STATES,
  DEFECT_TYPES,
  SEVERITIES,
  type DefectFilterState,
  type DefectState,
  type DefectType,
  type Severity
} from '@/types/defect'
import { FACE_LABEL, SEGMENT_FACES, type SegmentFace } from '@/types/segment'
import { compareSeverity, defectAreaCm2, percentOf } from '@/utils/severity'

export interface UseDefectFilterOptions {
  /** 初始筛选条件（仅在首次挂载时与空条件合并） */
  initial?: Partial<DefectFilterState>
  /** 限定叶片范围（叶片分段页传入当前叶片 id 的取值函数） */
  bladeId?: () => string | null
}

export interface UseDefectFilterResult {
  filter: Ref<DefectFilterState>
  turbineOptions: ComputedRef<Array<{ label: string; value: string }>>
  typeOptions: DefectType[]
  severityOptions: Severity[]
  stateOptions: DefectState[]
  faceOptions: Array<{ label: string; value: SegmentFace }>
  /** 当前范围内的全部缺陷行 */
  rows: ComputedRef<DefectRow[]>
  /** 应用筛选条件后的缺陷行 */
  filteredRows: ComputedRef<DefectRow[]>
  /** 按严重程度排序后的缺陷行（列表页直接渲染） */
  sortedRows: ComputedRef<DefectRow[]>
  severityCounts: ComputedRef<Record<Severity, number>>
  typeCounts: ComputedRef<Record<string, number>>
  faceCounts: ComputedRef<Record<string, number>>
  stateCounts: ComputedRef<Record<DefectState, number>>
  total: ComputedRef<number>
  filteredCount: ComputedRef<number>
  openCount: ComputedRef<number>
  heavyCount: ComputedRef<number>
  heavyPercent: ComputedRef<number>
  filteredAreaCm2: ComputedRef<number>
  hasFilter: ComputedRef<boolean>
  patch: (patch: Partial<DefectFilterState>) => void
  reset: () => void
}

/** 分布统计小工具：按指定取值函数累加计数 */
function countBy<T>(list: T[], pick: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  list.forEach((item) => {
    const key = pick(item)
    counts[key] = (counts[key] ?? 0) + 1
  })
  return counts
}

/**
 * 机组 / 缺陷类型 / 严重程度 / 检修面筛选状态与派生结果。
 * 条件统一存于 defectStore（跨页共享），本 hook 只做派生计算。
 */
export function useDefectFilter(options: UseDefectFilterOptions = {}): UseDefectFilterResult {
  const defectStore = useDefectStore()
  const turbineStore = useTurbineStore()
  const { filter } = storeToRefs(defectStore)

  // 首次挂载合并初始条件（例如从机组合账跳转过来时带上机组 id）
  onMounted(() => {
    if (options.initial) {
      defectStore.patchFilter({ ...createEmptyDefectFilter(), ...options.initial })
    }
  })

  const scopedBladeId = computed<string | null>(() => (options.bladeId ? options.bladeId() : null))

  /** 当前范围内的全部缺陷行（叶片分段页限定到当前叶片） */
  const scopeRows = computed<DefectRow[]>(() => {
    const bladeId = scopedBladeId.value
    if (!bladeId) return defectStore.rows
    return defectStore.rows.filter((row) => row.blade?.id === bladeId)
  })

  const turbineOptions = computed(() =>
    turbineStore.turbines.map((turbine) => ({
      label: `${turbine.code}（${turbine.model}）`,
      value: turbine.id
    }))
  )

  const faceOptions = SEGMENT_FACES.map((face) => ({ label: FACE_LABEL[face], value: face }))

  // 筛选条件由 defectStore 统一维护（跨页共享），此处只做叶片范围限定
  const filteredRows = computed<DefectRow[]>(() => {
    const bladeId = scopedBladeId.value
    if (!bladeId) return defectStore.filteredRows
    return defectStore.filteredRows.filter((row) => row.blade?.id === bladeId)
  })

  const sortedRows = computed<DefectRow[]>(() =>
    [...filteredRows.value].sort((a, b) =>
      compareSeverity(a.defect.severity, b.defect.severity, a.defect.lengthMm, b.defect.lengthMm)
    )
  )

  const severityCounts = computed<Record<Severity, number>>(() => {
    const counts: Record<Severity, number> = { 轻度: 0, 中度: 0, 重度: 0 }
    scopeRows.value.forEach((row) => {
      counts[row.defect.severity] += 1
    })
    return counts
  })

  /** 是否已有生效的筛选条件（直接复用 store 的判断，避免逻辑重复） */
  const hasFilter = computed(() => defectStore.hasFilter)

  const openCount = computed(
    () => scopeRows.value.filter((row) => row.defect.state !== '已修复').length
  )
  const heavyCount = computed(() => severityCounts.value['重度'])

  return {
    filter,
    turbineOptions,
    typeOptions: DEFECT_TYPES,
    severityOptions: SEVERITIES,
    stateOptions: DEFECT_STATES,
    faceOptions,
    rows: scopeRows,
    filteredRows,
    sortedRows,
    severityCounts,
    typeCounts: computed(() => countBy(scopeRows.value, (row) => row.defect.type)),
    faceCounts: computed(() => countBy(scopeRows.value, (row) => row.defect.face)),
    stateCounts: computed(() => {
      const counts = countBy(scopeRows.value, (row) => row.defect.state)
      return {
        待处理: counts['待处理'] ?? 0,
        已派工: counts['已派工'] ?? 0,
        已修复: counts['已修复'] ?? 0
      }
    }),
    total: computed(() => scopeRows.value.length),
    filteredCount: computed(() => filteredRows.value.length),
    openCount,
    heavyCount,
    heavyPercent: computed(() => percentOf(heavyCount.value, scopeRows.value.length)),
    filteredAreaCm2: computed(() =>
      filteredRows.value.reduce(
        (sum, row) => sum + defectAreaCm2(row.defect.lengthMm, row.defect.widthMm),
        0
      )
    ),
    hasFilter,
    patch: (patch: Partial<DefectFilterState>) => defectStore.patchFilter(patch),
    reset: () => defectStore.resetFilter()
  }
}
