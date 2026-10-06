import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { db } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import {
  createEmptyDefectFilter,
  type Defect,
  type DefectFilterState,
  type DefectState,
  type DefectType,
  type Severity
} from '@/types/defect'
import type { Segment } from '@/types/segment'
import type { Blade } from '@/types/blade'
import type { Turbine } from '@/types/turbine'
import type { WorkOrder } from '@/types/workOrder'
import { compareSeverity, defectAreaCm2, percentOf } from '@/utils/severity'

/** 缺陷标注台的一行：缺陷 + 所属分段 + 叶片 + 机组 */
export interface DefectRow {
  defect: Defect
  segment: Segment | null
  blade: Blade | null
  turbine: Turbine | null
}

/**
 * 缺陷 store：维护筛选条件、跨页选中集合与分级统计派生值。
 * 筛选条件在此集中管理，叶片分段页与报告页共用同一份状态。
 */
export const useDefectStore = defineStore('defect', () => {
  const defectsTable = useIdbTable<Defect>((database) => database.defects)
  const segmentsTable = useIdbTable<Segment>((database) => database.segments, { sortByUpdatedAt: false })
  const bladesTable = useIdbTable<Blade>((database) => database.blades, { sortByUpdatedAt: false })
  const turbinesTable = useIdbTable<Turbine>((database) => database.turbines, { sortByUpdatedAt: false })
  const workOrdersTable = useIdbTable<WorkOrder>((database) => database.workOrders, {
    sortByUpdatedAt: false
  })

  const filter = ref<DefectFilterState>(createEmptyDefectFilter())
  const selectedIds = reactive<Set<string>>(new Set<string>())

  const defects = computed<Defect[]>(() => defectsTable.rows.value)
  const segments = computed<Segment[]>(() => segmentsTable.rows.value)
  const blades = computed<Blade[]>(() => bladesTable.rows.value)
  const turbines = computed<Turbine[]>(() => turbinesTable.rows.value)
  const workOrders = computed<WorkOrder[]>(() => workOrdersTable.rows.value)
  const loading = computed(() => defectsTable.loading.value)
  const defectsReady = computed(() => defectsTable.ready.value)

  /** 展开后的缺陷行：附带分段、叶片与机组归属 */
  const rows = computed<DefectRow[]>(() => {
    const segmentMap = new Map(segments.value.map((segment) => [segment.id, segment]))
    const bladeMap = new Map(blades.value.map((blade) => [blade.id, blade]))
    const turbineMap = new Map(turbines.value.map((turbine) => [turbine.id, turbine]))
    return defects.value.map((defect) => {
      const segment = segmentMap.get(defect.segmentId) ?? null
      const blade = segment ? bladeMap.get(segment.bladeId) ?? null : null
      const turbine = blade ? turbineMap.get(blade.turbineId) ?? null : null
      return { defect, segment, blade, turbine }
    })
  })

  /** 应用筛选条件后的缺陷行（全局，不含叶片范围限定） */
  const filteredRows = computed<DefectRow[]>(() =>
    rows.value.filter((row) => {
      const { defect, segment, blade, turbine } = row
      const kw = filter.value.keyword.trim()
      if (kw.length > 0) {
        const haystack = `${defect.type}${defect.severity}${defect.face}${defect.state}${
          defect.foundAt
        }${segment?.airfoil ?? ''}${segment?.sectionImage ?? ''}${blade?.serial ?? ''}${
          turbine?.code ?? ''
        }`
        if (!haystack.includes(kw)) return false
      }
      if (filter.value.turbines.length > 0 && (!turbine || !filter.value.turbines.includes(turbine.id)))
        return false
      if (filter.value.types.length > 0 && !filter.value.types.includes(defect.type)) return false
      if (filter.value.severities.length > 0 && !filter.value.severities.includes(defect.severity))
        return false
      if (filter.value.faces.length > 0 && !filter.value.faces.includes(defect.face)) return false
      if (filter.value.states.length > 0 && !filter.value.states.includes(defect.state)) return false
      if (filter.value.onlyOpen && defect.state === '已修复') return false
      return true
    })
  )

  const sortedRows = computed<DefectRow[]>(() =>
    [...filteredRows.value].sort((a, b) =>
      compareSeverity(a.defect.severity, b.defect.severity, a.defect.lengthMm, b.defect.lengthMm)
    )
  )

  const severityCounts = computed<Record<Severity, number>>(() => {
    const counts: Record<Severity, number> = { 轻度: 0, 中度: 0, 重度: 0 }
    defects.value.forEach((defect) => {
      counts[defect.severity] += 1
    })
    return counts
  })

  const typeCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    defects.value.forEach((defect) => {
      counts[defect.type] = (counts[defect.type] ?? 0) + 1
    })
    return counts
  })

  const faceCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    defects.value.forEach((defect) => {
      counts[defect.face] = (counts[defect.face] ?? 0) + 1
    })
    return counts
  })

  const stateCounts = computed<Record<DefectState, number>>(() => {
    const counts: Record<DefectState, number> = { 待处理: 0, 已派工: 0, 已修复: 0 }
    defects.value.forEach((defect) => {
      counts[defect.state] += 1
    })
    return counts
  })

  const totalAreaCm2 = computed(() =>
    defects.value.reduce((sum, defect) => sum + defectAreaCm2(defect.lengthMm, defect.widthMm), 0)
  )

  const filteredAreaCm2 = computed(() =>
    filteredRows.value.reduce(
      (sum, row) => sum + defectAreaCm2(row.defect.lengthMm, row.defect.widthMm),
      0
    )
  )

  const openCount = computed(() => defects.value.filter((defect) => defect.state !== '已修复').length)
  const heavyCount = computed(() => severityCounts.value['重度'])
  const heavyPercent = computed(() => percentOf(heavyCount.value, defects.value.length))
  const closedPercent = computed(() =>
    percentOf(defects.value.length - openCount.value, defects.value.length)
  )

  /** 按机组聚合缺陷数量，机组合账卡片直接消费 */
  const turbineAggregate = computed<
    Record<string, { total: number; open: number; heavy: number; areaCm2: number }>
  >(() => {
    const aggregate: Record<string, { total: number; open: number; heavy: number; areaCm2: number }> = {}
    rows.value.forEach((row) => {
      if (!row.turbine) return
      const bucket =
        aggregate[row.turbine.id] ?? { total: 0, open: 0, heavy: 0, areaCm2: 0 }
      bucket.total += 1
      if (row.defect.state !== '已修复') bucket.open += 1
      if (row.defect.severity === '重度') bucket.heavy += 1
      bucket.areaCm2 += defectAreaCm2(row.defect.lengthMm, row.defect.widthMm)
      aggregate[row.turbine.id] = bucket
    })
    return aggregate
  })

  const hasFilter = computed(
    () =>
      filter.value.keyword.trim().length > 0 ||
      filter.value.turbines.length > 0 ||
      filter.value.types.length > 0 ||
      filter.value.severities.length > 0 ||
      filter.value.faces.length > 0 ||
      filter.value.states.length > 0 ||
      filter.value.onlyOpen
  )

  function patchFilter(patch: Partial<DefectFilterState>): void {
    filter.value = { ...filter.value, ...patch }
  }

  function resetFilter(): void {
    filter.value = createEmptyDefectFilter()
  }

  function rowsOfSegment(segmentId: string): DefectRow[] {
    return rows.value.filter((row) => row.defect.segmentId === segmentId)
  }

  function rowsOfBlade(bladeId: string): DefectRow[] {
    return rows.value.filter((row) => row.blade?.id === bladeId)
  }

  function rowsOfTurbine(turbineId: string): DefectRow[] {
    return rows.value.filter((row) => row.turbine?.id === turbineId)
  }

  function defectById(id: string): Defect | undefined {
    return defects.value.find((defect) => defect.id === id)
  }

  function ordersOfDefect(defectId: string): WorkOrder[] {
    return workOrders.value.filter((order) => order.defectId === defectId)
  }

  function toggleSelection(id: string): void {
    if (selectedIds.has(id)) selectedIds.delete(id)
    else selectedIds.add(id)
  }

  function setSelection(ids: string[]): void {
    selectedIds.clear()
    ids.forEach((id) => selectedIds.add(id))
  }

  function clearSelection(): void {
    selectedIds.clear()
  }

  /** 记录当前页选中 id：表格 selectable 回调使用 */
  function isSelected(id: string): boolean {
    return selectedIds.has(id)
  }

  async function createDefect(payload: Omit<Defect, 'id' | 'createdAt' | 'updatedAt'>): Promise<Defect> {
    return defectsTable.create(payload, 'dfc')
  }

  async function updateDefect(id: string, patch: Partial<Defect>): Promise<void> {
    await defectsTable.update(id, patch)
  }

  /** 级联删除缺陷及其维修工单 */
  async function removeDefect(id: string): Promise<void> {
    await db.transaction('rw', [db.defects, db.workOrders], async () => {
      await db.workOrders.where('defectId').equals(id).delete()
      await db.defects.delete(id)
    })
    selectedIds.delete(id)
  }

  async function removeDefects(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    await db.transaction('rw', [db.defects, db.workOrders], async () => {
      await db.workOrders.where('defectId').anyOf(ids).delete()
      await db.defects.bulkDelete(ids)
    })
    ids.forEach((id) => selectedIds.delete(id))
    return ids.length
  }

  /** 批量改严重程度（缺陷标注台的批量操作） */
  async function bulkSetSeverity(ids: string[], severity: Severity): Promise<number> {
    const now = Date.now()
    await db.defects
      .where('id')
      .anyOf(ids)
      .modify((defect) => {
        defect.severity = severity
        defect.updatedAt = now
      })
    return ids.length
  }

  /** 批量改缺陷类型 */
  async function bulkSetType(ids: string[], type: DefectType): Promise<number> {
    const now = Date.now()
    await db.defects
      .where('id')
      .anyOf(ids)
      .modify((defect) => {
        defect.type = type
        defect.updatedAt = now
      })
    return ids.length
  }

  /** 批量改面位 */
  async function bulkSetFace(ids: string[], face: Defect['face']): Promise<number> {
    const now = Date.now()
    await db.defects
      .where('id')
      .anyOf(ids)
      .modify((defect) => {
        defect.face = face
        defect.updatedAt = now
      })
    return ids.length
  }

  /** 标记缺陷状态（派工 / 修复时由工单流程回调） */
  async function setState(id: string, state: DefectState): Promise<void> {
    await defectsTable.update(id, { state })
  }

  async function bulkSetState(ids: string[], state: DefectState): Promise<number> {
    const now = Date.now()
    await db.defects
      .where('id')
      .anyOf(ids)
      .modify((defect) => {
        defect.state = state
        defect.updatedAt = now
      })
    return ids.length
  }

  return {
    filter,
    selectedIds,
    defects,
    segments,
    blades,
    turbines,
    workOrders,
    loading,
    defectsReady,
    rows,
    filteredRows,
    sortedRows,
    severityCounts,
    typeCounts,
    faceCounts,
    stateCounts,
    totalAreaCm2,
    filteredAreaCm2,
    openCount,
    heavyCount,
    heavyPercent,
    closedPercent,
    turbineAggregate,
    hasFilter,
    patchFilter,
    resetFilter,
    rowsOfSegment,
    rowsOfBlade,
    rowsOfTurbine,
    defectById,
    ordersOfDefect,
    toggleSelection,
    setSelection,
    clearSelection,
    isSelected,
    createDefect,
    updateDefect,
    removeDefect,
    removeDefects,
    bulkSetSeverity,
    bulkSetType,
    bulkSetFace,
    bulkSetState,
    setState
  }
})
