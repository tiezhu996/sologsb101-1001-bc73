import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { createId, db, readUiPrefs, round2, writeUiPrefs } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import type { Blade, BladeStat } from '@/types/blade'
import { formatRange, type Segment, type SegmentGenerateOptions, type SegmentStat } from '@/types/segment'
import type { Defect } from '@/types/defect'
import type { WorkOrder } from '@/types/workOrder'

export interface GenerateSegmentsResult {
  created: number
  removed: number
}

export interface SplitSegmentResult {
  frontSegment: Segment
  backSegment: Segment
  movedDefectIds: string[]
}

/**
 * 判断缺陷在分界米数两侧的归属。
 * positionM 作为缺陷展向中点；跨越分界时按两侧覆盖长度归类，等长归根部侧（前段）。
 */
function defectBelongsToBack(defect: Defect, splitM: number): boolean {
  const halfLengthM = defect.lengthMm / 2000
  const defectStartM = defect.positionM - halfLengthM
  const defectEndM = defect.positionM + halfLengthM

  if (defectEndM <= splitM) return false
  if (defectStartM >= splitM) return true

  return defectEndM - splitM > splitM - defectStartM
}

/**
 * 叶片 store：维护展向分段与剖面图元数据，并派生出分段 / 叶片的缺陷汇总。
 */
export const useBladeStore = defineStore('blade', () => {
  const segmentsTable = useIdbTable<Segment>((database) => database.segments, { sortByUpdatedAt: false })
  const defectsTable = useIdbTable<Defect>((database) => database.defects, { sortByUpdatedAt: false })
  const bladesTable = useIdbTable<Blade>((database) => database.blades, { sortByUpdatedAt: false })
  const workOrdersTable = useIdbTable<WorkOrder>((database) => database.workOrders, {
    sortByUpdatedAt: false
  })

  const prefs = readUiPrefs()
  const currentBladeId = ref<string | null>(prefs.lastBladeId)

  watch(currentBladeId, (value) => {
    writeUiPrefs({ ...readUiPrefs(), lastBladeId: value })
  })

  const segments = computed<Segment[]>(() => segmentsTable.rows.value)
  const defects = computed<Defect[]>(() => defectsTable.rows.value)
  const blades = computed<Blade[]>(() => bladesTable.rows.value)
  const workOrders = computed<WorkOrder[]>(() => workOrdersTable.rows.value)
  const loading = computed(() => segmentsTable.loading.value)
  /** 分段表是否已完成首次载入：直链场景用于区分「叶片不存在」与「尚未读取」 */
  const segmentsReady = computed(() => segmentsTable.ready.value)
  /** 叶片表是否已完成首次载入：直链进入分段页时用于区分加载中与叶片不存在 */
  const bladesReady = computed(() => bladesTable.ready.value)

  const currentBlade = computed<Blade | null>(
    () => blades.value.find((blade) => blade.id === currentBladeId.value) ?? null
  )

  function bladeById(id: string): Blade | undefined {
    return blades.value.find((blade) => blade.id === id)
  }

  /** 按段序号（根部 → 叶尖）返回某叶片的展向分段 */
  function segmentsOfBlade(bladeId: string): Segment[] {
    return segments.value
      .filter((segment) => segment.bladeId === bladeId)
      .sort((a, b) => a.index - b.index)
  }

  function defectsOfSegment(segmentId: string): Defect[] {
    return defects.value.filter((defect) => defect.segmentId === segmentId)
  }

  function defectsOfBlade(bladeId: string): Defect[] {
    const segmentIds = new Set(segmentsOfBlade(bladeId).map((segment) => segment.id))
    return defects.value.filter((defect) => segmentIds.has(defect.segmentId))
  }

  const segmentStats = computed<Record<string, SegmentStat>>(() => {
    const map: Record<string, SegmentStat> = {}
    segments.value.forEach((segment) => {
      const list = defectsOfSegment(segment.id)
      map[segment.id] = {
        segmentId: segment.id,
        defectCount: list.length,
        openCount: list.filter((defect) => defect.state !== '已修复').length,
        heavyCount: list.filter((defect) => defect.severity === '重度').length
      }
    })
    return map
  })

  const bladeStats = computed<Record<string, BladeStat>>(() => {
    const map: Record<string, BladeStat> = {}
    blades.value.forEach((blade) => {
      const segmentList = segmentsOfBlade(blade.id)
      const defectList = defectsOfBlade(blade.id)
      map[blade.id] = {
        bladeId: blade.id,
        segmentCount: segmentList.length,
        defectCount: defectList.length,
        openCount: defectList.filter((defect) => defect.state !== '已修复').length,
        heavyCount: defectList.filter((defect) => defect.severity === '重度').length
      }
    })
    return map
  })

  function segmentStat(segmentId: string): SegmentStat {
    return (
      segmentStats.value[segmentId] ?? {
        segmentId,
        defectCount: 0,
        openCount: 0,
        heavyCount: 0
      }
    )
  }

  function bladeStat(bladeId: string): BladeStat {
    return (
      bladeStats.value[bladeId] ?? {
        bladeId,
        segmentCount: 0,
        defectCount: 0,
        openCount: 0,
        heavyCount: 0
      }
    )
  }

  function setCurrentBlade(id: string | null): void {
    currentBladeId.value = id
  }

  /** 级联删除某叶片的全部展向分段（含缺陷与工单），返回删除的分段数 */
  async function removeSegmentsOfBlade(bladeId: string): Promise<number> {
    const segmentIds = segmentsOfBlade(bladeId).map((segment) => segment.id)
    if (segmentIds.length === 0) return 0
    const defectIds = defects.value
      .filter((defect) => segmentIds.includes(defect.segmentId))
      .map((defect) => defect.id)
    await db.transaction('rw', [db.segments, db.defects, db.workOrders], async () => {
      await db.workOrders.where('defectId').anyOf(defectIds).delete()
      await db.defects.bulkDelete(defectIds)
      await db.segments.bulkDelete(segmentIds)
    })
    return segmentIds.length
  }

  /**
   * 按段数批量生成展向分段：把 startM-endM 均分为 count 段，逐段写入。
   * overwrite=true 时先清空该叶片已有分段。
   */
  async function generateSegments(
    blade: Blade,
    options: SegmentGenerateOptions
  ): Promise<GenerateSegmentsResult> {
    const count = Math.max(1, Math.floor(options.count))
    const startM = Math.min(options.startM, options.endM)
    const endM = Math.max(options.startM, options.endM)
    const step = (endM - startM) / count

    let removed = 0
    if (options.overwrite) {
      removed = await removeSegmentsOfBlade(blade.id)
    }

    const baseIndex = options.overwrite ? 0 : segmentsOfBlade(blade.id).length
    const now = Date.now()
    const rows: Segment[] = []
    for (let i = 0; i < count; i += 1) {
      const index = baseIndex + i + 1
      rows.push({
        id: `${blade.id}-seg-${index}`,
        bladeId: blade.id,
        index,
        startM: round2(startM + step * i),
        endM: round2(startM + step * (i + 1)),
        airfoil: options.airfoil,
        face: options.face,
        sectionImage: '',
        createdAt: now,
        updatedAt: now
      })
    }
    await segmentsTable.bulkPut(rows)
    await bladesTable.update(blade.id, { segmentCount: baseIndex + count })
    return { created: rows.length, removed }
  }

  /** 单条新增分段（手动微调分段划分时使用） */
  async function createSegment(
    payload: Omit<Segment, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Segment> {
    const segment = await segmentsTable.create(payload, 'seg')
    await syncSegmentCount(payload.bladeId)
    return segment
  }

  /**
   * 单段拆分：前段保留原起点，新段从分界点接住后半段与原剖面图；
   * 后续段序号顺延，段内缺陷按展向覆盖长度重新归属，工单按 defectId 自动跟随。
   */
  async function splitSegment(id: string, rawSplitM: number): Promise<SplitSegmentResult> {
    const segment = await db.segments.get(id)
    if (!segment) throw new Error('未找到要拆分的分段')

    const splitM = round2(rawSplitM)
    if (!(splitM > segment.startM && splitM < segment.endM)) {
      throw new Error(`分界米数必须落在 ${formatRange(segment.startM, segment.endM)} 内`)
    }

    const now = Date.now()
    const bladeSegments = await db.segments
      .where('bladeId')
      .equals(segment.bladeId)
      .toArray()
      .then((list) => list.sort((a, b) => a.index - b.index))

    const frontSegment: Segment = {
      ...segment,
      endM: splitM,
      sectionImage: '',
      sectionPreview: '',
      updatedAt: now
    }
    const backSegment: Segment = {
      ...segment,
      id: createId('seg'),
      index: segment.index + 1,
      startM: splitM,
      endM: segment.endM,
      sectionImage: segment.sectionImage,
      sectionPreview: segment.sectionPreview,
      createdAt: now,
      updatedAt: now
    }
    const shiftedSegments = bladeSegments
      .filter((item) => item.index > segment.index)
      .map((item) => ({ ...item, index: item.index + 1 }))

    const segmentDefects = await db.defects.where('segmentId').equals(segment.id).toArray()
    const movedDefects = segmentDefects.filter((defect) => defectBelongsToBack(defect, splitM))
    const movedDefectIds = movedDefects.map((defect) => defect.id)

    await db.transaction('rw', [db.blades, db.segments, db.defects], async () => {
      await db.segments.bulkPut([frontSegment, backSegment, ...shiftedSegments])
      if (movedDefectIds.length > 0) {
        await db.defects.where('id').anyOf(movedDefectIds).modify((defect) => {
          defect.segmentId = backSegment.id
        })
      }
      await db.blades.update(segment.bladeId, {
        segmentCount: bladeSegments.length + 1,
        updatedAt: now
      })
    })

    return { frontSegment, backSegment, movedDefectIds }
  }

  async function updateSegment(id: string, patch: Partial<Segment>): Promise<void> {
    await segmentsTable.update(id, patch)
  }

  /** 上传剖面图：只保留文件名与本地预览，文件本身不离开浏览器 */
  async function setSectionImage(id: string, fileName: string, preview?: string): Promise<void> {
    const patch: Partial<Segment> = { sectionImage: fileName }
    if (preview !== undefined) patch.sectionPreview = preview
    await segmentsTable.update(id, patch)
  }

  async function clearSectionImage(id: string): Promise<void> {
    await segmentsTable.update(id, { sectionImage: '', sectionPreview: '' })
  }

  /** 级联删除分段：缺陷 → 工单 → 分段，并回写叶片段数 */
  async function removeSegment(id: string): Promise<void> {
    const segment = segments.value.find((item) => item.id === id)
    const defectIds = defectsOfSegment(id).map((defect) => defect.id)
    await db.transaction('rw', [db.segments, db.defects, db.workOrders], async () => {
      await db.workOrders.where('defectId').anyOf(defectIds).delete()
      await db.defects.bulkDelete(defectIds)
      await db.segments.delete(id)
    })
    if (segment) await syncSegmentCount(segment.bladeId)
  }

  /** 分段增删后回写叶片的 segmentCount，保证台账回显一致 */
  async function syncSegmentCount(bladeId: string): Promise<void> {
    const count = segmentsOfBlade(bladeId).length
    const blade = bladeById(bladeId)
    if (blade && blade.segmentCount !== count) {
      await bladesTable.update(bladeId, { segmentCount: count })
    }
  }

  return {
    segments,
    defects,
    blades,
    workOrders,
    loading,
    segmentsReady,
    bladesReady,
    currentBladeId,
    currentBlade,
    segmentStats,
    bladeStats,
    setCurrentBlade,
    bladeById,
    segmentsOfBlade,
    defectsOfSegment,
    defectsOfBlade,
    segmentStat,
    bladeStat,
    generateSegments,
    createSegment,
    splitSegment,
    updateSegment,
    setSectionImage,
    clearSectionImage,
    removeSegment,
    removeSegmentsOfBlade,
    syncSegmentCount
  }
})
