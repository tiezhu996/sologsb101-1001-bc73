import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { db, readUiPrefs, writeUiPrefs } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import {
  DEFAULT_BLADE_COUNT,
  commissionYearOf,
  type Turbine,
  type TurbineStat
} from '@/types/turbine'
import {
  DEFAULT_BLADE_LENGTH_M,
  DEFAULT_SEGMENT_COUNT,
  serialFromIndex,
  type Blade,
  type BladeMaterial
} from '@/types/blade'
import type { Segment } from '@/types/segment'
import type { Defect } from '@/types/defect'
import type { WorkOrder } from '@/types/workOrder'
import { percentOf } from '@/utils/severity'

/** 新建机组的入参：除机组本体外，同时给出派生叶片所需的默认参数 */
export interface CreateTurbineInput {
  code: string
  model: string
  hubHeightM: number
  commissionDate: string
  bladeCount: number
  bladeLengthM: number
  bladeMaterial: BladeMaterial
}

export interface CreateBladeInput {
  turbineId: string
  serial: string
  lengthM: number
  material: BladeMaterial
  segmentCount: number
}

/**
 * 机组 store：维护机组与叶片列表、当前选中机组，并派生出各机组的缺陷统计。
 */
export const useTurbineStore = defineStore('turbine', () => {
  const turbinesTable = useIdbTable<Turbine>((database) => database.turbines)
  const bladesTable = useIdbTable<Blade>((database) => database.blades, { sortByUpdatedAt: false })
  const segmentsTable = useIdbTable<Segment>((database) => database.segments, { sortByUpdatedAt: false })
  const defectsTable = useIdbTable<Defect>((database) => database.defects, { sortByUpdatedAt: false })
  const workOrdersTable = useIdbTable<WorkOrder>((database) => database.workOrders, {
    sortByUpdatedAt: false
  })

  const prefs = readUiPrefs()
  const currentTurbineId = ref<string | null>(prefs.lastTurbineId)
  const keyword = ref('')
  const modelFilter = ref<string[]>([])
  const yearFilter = ref<string[]>([])

  watch(currentTurbineId, (value) => {
    writeUiPrefs({ ...readUiPrefs(), lastTurbineId: value })
  })

  const turbines = computed<Turbine[]>(() => turbinesTable.rows.value)
  const blades = computed<Blade[]>(() => bladesTable.rows.value)
  const segments = computed<Segment[]>(() => segmentsTable.rows.value)
  const defects = computed<Defect[]>(() => defectsTable.rows.value)
  const workOrders = computed<WorkOrder[]>(() => workOrdersTable.rows.value)
  const loading = computed(() => turbinesTable.loading.value)
  /** 机组表是否已完成首次载入：区分「机组不存在」与「尚未读取」 */
  const turbinesReady = computed(() => turbinesTable.ready.value)

  const currentTurbine = computed<Turbine | null>(
    () => turbines.value.find((turbine) => turbine.id === currentTurbineId.value) ?? null
  )

  const modelOptions = computed<string[]>(() =>
    Array.from(new Set(turbines.value.map((turbine) => turbine.model).filter((model) => model.length > 0))).sort()
  )

  const yearOptions = computed<string[]>(() =>
    Array.from(new Set(turbines.value.map((turbine) => commissionYearOf(turbine)))).sort((a, b) =>
      b.localeCompare(a)
    )
  )

  function bladesOfTurbine(turbineId: string): Blade[] {
    return blades.value
      .filter((blade) => blade.turbineId === turbineId)
      .sort((a, b) => a.serial.localeCompare(b.serial))
  }

  function segmentsOfTurbine(turbineId: string): Segment[] {
    const bladeIds = new Set(bladesOfTurbine(turbineId).map((blade) => blade.id))
    return segments.value.filter((segment) => bladeIds.has(segment.bladeId))
  }

  function defectsOfTurbine(turbineId: string): Defect[] {
    const segmentIds = new Set(segmentsOfTurbine(turbineId).map((segment) => segment.id))
    return defects.value.filter((defect) => segmentIds.has(defect.segmentId))
  }

  function workOrdersOfTurbine(turbineId: string): WorkOrder[] {
    const defectIds = new Set(defectsOfTurbine(turbineId).map((defect) => defect.id))
    return workOrders.value.filter((order) => defectIds.has(order.defectId))
  }

  /** 机组卡片回显的缺陷总数与未闭环数 */
  const stats = computed<TurbineStat[]>(() =>
    turbines.value.map((turbine) => {
      const bladeList = bladesOfTurbine(turbine.id)
      const segmentList = segmentsOfTurbine(turbine.id)
      const defectList = defectsOfTurbine(turbine.id)
      const openCount = defectList.filter((defect) => defect.state !== '已修复').length
      const heavyCount = defectList.filter((defect) => defect.severity === '重度').length
      return {
        turbineId: turbine.id,
        bladeCount: bladeList.length,
        segmentCount: segmentList.length,
        defectCount: defectList.length,
        openCount,
        heavyCount,
        heavyPercent: percentOf(heavyCount, defectList.length)
      }
    })
  )

  const statMap = computed<Record<string, TurbineStat>>(() => {
    const map: Record<string, TurbineStat> = {}
    stats.value.forEach((stat) => {
      map[stat.turbineId] = stat
    })
    return map
  })

  /** 机组合账的筛选结果（关键字 + 机型 + 投运年份） */
  const filteredTurbines = computed<Turbine[]>(() =>
    turbines.value.filter((turbine) => {
      const kw = keyword.value.trim()
      if (kw.length > 0) {
        const haystack = `${turbine.code}${turbine.model}${turbine.commissionDate}${turbine.hubHeightM}`
        if (!haystack.includes(kw)) return false
      }
      if (modelFilter.value.length > 0 && !modelFilter.value.includes(turbine.model)) return false
      if (yearFilter.value.length > 0 && !yearFilter.value.includes(commissionYearOf(turbine))) return false
      return true
    })
  )

  const totals = computed(() => {
    const openDefects = defects.value.filter((defect) => defect.state !== '已修复').length
    const heavy = defects.value.filter((defect) => defect.severity === '重度').length
    return {
      turbines: turbines.value.length,
      blades: blades.value.length,
      segments: segments.value.length,
      defects: defects.value.length,
      openDefects,
      heavy,
      heavyPercent: percentOf(heavy, defects.value.length)
    }
  })

  function setCurrentTurbine(id: string | null): void {
    currentTurbineId.value = id
  }

  function resetFilters(): void {
    keyword.value = ''
    modelFilter.value = []
    yearFilter.value = []
  }

  function turbineById(id: string): Turbine | undefined {
    return turbines.value.find((turbine) => turbine.id === id)
  }

  function bladeById(id: string): Blade | undefined {
    return blades.value.find((blade) => blade.id === id)
  }

  /** 新建机组：按 bladeCount 派生对应数量的叶片记录 */
  async function createTurbine(input: CreateTurbineInput): Promise<Turbine> {
    const turbine = await turbinesTable.create(
      {
        code: input.code.trim(),
        model: input.model,
        hubHeightM: input.hubHeightM,
        commissionDate: input.commissionDate,
        bladeCount: input.bladeCount
      },
      'tbn'
    )
    const count = Math.max(1, Math.floor(input.bladeCount))
    const newBlades: Blade[] = []
    const now = Date.now()
    for (let i = 0; i < count; i += 1) {
      newBlades.push({
        id: `${turbine.id}-bld-${i + 1}`,
        turbineId: turbine.id,
        serial: serialFromIndex(i),
        lengthM: input.bladeLengthM || DEFAULT_BLADE_LENGTH_M,
        material: input.bladeMaterial,
        segmentCount: DEFAULT_SEGMENT_COUNT,
        createdAt: now,
        updatedAt: now
      })
    }
    await bladesTable.bulkPut(newBlades)
    currentTurbineId.value = turbine.id
    return turbine
  }

  async function updateTurbine(id: string, patch: Partial<Turbine>): Promise<void> {
    await turbinesTable.update(id, patch)
  }

  /** 编辑机组时同步叶片数量：增加则补足，减少则级联删除多余叶片 */
  async function syncBladeCount(
    turbineId: string,
    bladeCount: number,
    defaults?: { lengthM: number; material: BladeMaterial }
  ): Promise<number> {
    const current = bladesOfTurbine(turbineId)
    const target = Math.max(1, Math.floor(bladeCount))
    const turbine = turbineById(turbineId)
    if (!turbine) return 0

    if (target > current.length) {
      const now = Date.now()
      const added: Blade[] = []
      for (let i = current.length; i < target; i += 1) {
        added.push({
          id: `${turbineId}-bld-${i + 1}`,
          turbineId,
          serial: serialFromIndex(i),
          lengthM: defaults?.lengthM ?? current[0]?.lengthM ?? DEFAULT_BLADE_LENGTH_M,
          material: defaults?.material ?? current[0]?.material ?? '玻璃纤维',
          segmentCount: current[0]?.segmentCount ?? DEFAULT_SEGMENT_COUNT,
          createdAt: now,
          updatedAt: now
        })
      }
      await bladesTable.bulkPut(added)
      await turbinesTable.update(turbineId, { bladeCount: target })
      return added.length
    }

    if (target < current.length) {
      const removed = current.slice(target)
      for (const blade of removed) {
        await removeBlade(blade.id)
      }
      await turbinesTable.update(turbineId, { bladeCount: target })
      return -removed.length
    }

    await turbinesTable.update(turbineId, { bladeCount: target })
    return 0
  }

  async function createBlade(input: CreateBladeInput): Promise<Blade> {
    const blade = await bladesTable.create(
      {
        turbineId: input.turbineId,
        serial: (input.serial || serialFromIndex(bladesOfTurbine(input.turbineId).length)) as Blade['serial'],
        lengthM: input.lengthM,
        material: input.material,
        segmentCount: input.segmentCount
      },
      'bld'
    )
    const list = bladesOfTurbine(input.turbineId)
    await turbinesTable.update(input.turbineId, { bladeCount: list.length })
    return blade
  }

  async function updateBlade(id: string, patch: Partial<Blade>): Promise<void> {
    await bladesTable.update(id, patch)
  }

  /** 级联删除叶片：分段 → 缺陷 → 工单 */
  async function removeBlade(id: string): Promise<void> {
    const blade = bladeById(id)
    const segmentIds = segments.value.filter((segment) => segment.bladeId === id).map((segment) => segment.id)
    const defectIds = defects.value
      .filter((defect) => segmentIds.includes(defect.segmentId))
      .map((defect) => defect.id)
    await db.transaction(
      'rw',
      [db.blades, db.segments, db.defects, db.workOrders],
      async () => {
        await db.workOrders.where('defectId').anyOf(defectIds).delete()
        await db.defects.bulkDelete(defectIds)
        await db.segments.bulkDelete(segmentIds)
        await db.blades.delete(id)
      }
    )
    if (blade) {
      const rest = bladesOfTurbine(blade.turbineId).length
      await turbinesTable.update(blade.turbineId, { bladeCount: rest })
    }
  }

  /** 级联删除机组：叶片 → 分段 → 缺陷 → 工单 */
  async function removeTurbine(id: string): Promise<void> {
    const bladeIds = bladesOfTurbine(id).map((blade) => blade.id)
    const segmentIds = segments.value
      .filter((segment) => bladeIds.includes(segment.bladeId))
      .map((segment) => segment.id)
    const defectIds = defects.value
      .filter((defect) => segmentIds.includes(defect.segmentId))
      .map((defect) => defect.id)
    await db.transaction(
      'rw',
      [db.turbines, db.blades, db.segments, db.defects, db.workOrders],
      async () => {
        await db.workOrders.where('defectId').anyOf(defectIds).delete()
        await db.defects.bulkDelete(defectIds)
        await db.segments.bulkDelete(segmentIds)
        await db.blades.bulkDelete(bladeIds)
        await db.turbines.delete(id)
      }
    )
    if (currentTurbineId.value === id) currentTurbineId.value = null
  }

  return {
    turbines,
    blades,
    segments,
    defects,
    workOrders,
    loading,
    turbinesReady,
    currentTurbineId,
    currentTurbine,
    keyword,
    modelFilter,
    yearFilter,
    modelOptions,
    yearOptions,
    stats,
    statMap,
    filteredTurbines,
    totals,
    defaultBladeCount: DEFAULT_BLADE_COUNT,
    setCurrentTurbine,
    resetFilters,
    turbineById,
    bladeById,
    bladesOfTurbine,
    segmentsOfTurbine,
    defectsOfTurbine,
    workOrdersOfTurbine,
    createTurbine,
    updateTurbine,
    syncBladeCount,
    createBlade,
    updateBlade,
    removeBlade,
    removeTurbine
  }
})
