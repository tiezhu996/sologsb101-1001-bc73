import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useIdbTable } from '@/hooks/useIdbTable'
import {
  createEmptyWorkOrderStat,
  isOverdue,
  nextWorkOrderState,
  WORK_TEAMS,
  type WorkOrder,
  type WorkOrderState,
  type WorkOrderStat
} from '@/types/workOrder'
import type { Defect } from '@/types/defect'
import type { Segment } from '@/types/segment'
import type { Blade } from '@/types/blade'
import type { Turbine } from '@/types/turbine'
import { percentOf } from '@/utils/severity'

/** 工单列表的一行：工单 + 缺陷 + 分段 + 叶片 + 机组 */
export interface WorkOrderRow {
  order: WorkOrder
  defect: Defect | null
  segment: Segment | null
  blade: Blade | null
  turbine: Turbine | null
  /** 限期已过且未闭环 */
  overdue: boolean
}

/** 可派工缺陷候选项（不含工单字段，供派工下拉框使用） */
export interface DispatchOption {
  defect: Defect
  segment: Segment | null
  blade: Blade | null
  turbine: Turbine | null
}

export interface DispatchInput {
  defectId: string
  team: string
  dueDate: string
}

/** 今天的日期（YYYY-MM-DD，本地时区） */
export function todayString(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

/**
 * 工单 store：维护维修工单的状态流转与验收记录，
 * 验收通过时回写缺陷为「已修复」。
 */
export const useWorkOrderStore = defineStore('workOrder', () => {
  const workOrdersTable = useIdbTable<WorkOrder>((database) => database.workOrders)
  const defectsTable = useIdbTable<Defect>((database) => database.defects, { sortByUpdatedAt: false })
  const segmentsTable = useIdbTable<Segment>((database) => database.segments, { sortByUpdatedAt: false })
  const bladesTable = useIdbTable<Blade>((database) => database.blades, { sortByUpdatedAt: false })
  const turbinesTable = useIdbTable<Turbine>((database) => database.turbines, { sortByUpdatedAt: false })

  const keyword = ref('')
  const teamFilter = ref<string[]>([])
  const stateFilter = ref<WorkOrderState[]>([])
  const onlyOverdue = ref(false)

  const orders = computed<WorkOrder[]>(() => workOrdersTable.rows.value)
  const defects = computed<Defect[]>(() => defectsTable.rows.value)
  const segments = computed<Segment[]>(() => segmentsTable.rows.value)
  const blades = computed<Blade[]>(() => bladesTable.rows.value)
  const turbines = computed<Turbine[]>(() => turbinesTable.rows.value)
  const loading = computed(() => workOrdersTable.loading.value)
  const ordersReady = computed(() => workOrdersTable.ready.value)

  const today = computed(() => todayString())

  const rows = computed<WorkOrderRow[]>(() => {
    const defectMap = new Map(defects.value.map((defect) => [defect.id, defect]))
    const segmentMap = new Map(segments.value.map((segment) => [segment.id, segment]))
    const bladeMap = new Map(blades.value.map((blade) => [blade.id, blade]))
    const turbineMap = new Map(turbines.value.map((turbine) => [turbine.id, turbine]))
    return orders.value.map((order) => {
      const defect = defectMap.get(order.defectId) ?? null
      const segment = defect ? segmentMap.get(defect.segmentId) ?? null : null
      const blade = segment ? bladeMap.get(segment.bladeId) ?? null : null
      const turbine = blade ? turbineMap.get(blade.turbineId) ?? null : null
      return { order, defect, segment, blade, turbine, overdue: isOverdue(order, today.value) }
    })
  })

  /** 按班组与状态筛选，支持关键字与超期开关 */
  const filteredRows = computed<WorkOrderRow[]>(() =>
    rows.value.filter((row) => {
      const { order, defect, blade, turbine } = row
      const kw = keyword.value.trim()
      if (kw.length > 0) {
        const haystack = `${order.team}${order.state}${order.acceptor}${order.dueDate}${
          defect?.type ?? ''
        }${defect?.severity ?? ''}${blade?.serial ?? ''}${turbine?.code ?? ''}`
        if (!haystack.includes(kw)) return false
      }
      if (teamFilter.value.length > 0 && !teamFilter.value.includes(order.team)) return false
      if (stateFilter.value.length > 0 && !stateFilter.value.includes(order.state)) return false
      if (onlyOverdue.value && !row.overdue) return false
      return true
    })
  )

  /** 限期升序：越紧急越靠前 */
  const sortedRows = computed<WorkOrderRow[]>(() =>
    [...filteredRows.value].sort((a, b) => {
      if (a.order.state === b.order.state) return a.order.dueDate.localeCompare(b.order.dueDate)
      if (a.order.state === '已闭环') return 1
      if (b.order.state === '已闭环') return -1
      return a.order.dueDate.localeCompare(b.order.dueDate)
    })
  )

  const teamOptions = computed<string[]>(() => {
    const used = new Set(orders.value.map((order) => order.team))
    return Array.from(new Set([...WORK_TEAMS, ...used]))
  })

  const stats = computed<WorkOrderStat>(() => {
    if (orders.value.length === 0) return createEmptyWorkOrderStat()
    const closed = orders.value.filter((order) => order.state === '已闭环').length
    return {
      total: orders.value.length,
      pending: orders.value.filter((order) => order.state === '待派').length,
      processing: orders.value.filter((order) => order.state === '处理中').length,
      awaiting: orders.value.filter((order) => order.state === '待验收').length,
      closed,
      overdue: rows.value.filter((row) => row.overdue).length,
      closedPercent: percentOf(closed, orders.value.length)
    }
  })

  /** 可派工的缺陷：未修复且尚无工单（以缺陷表为准，不能以工单行为准） */
  const dispatchableDefects = computed<DispatchOption[]>(() => {
    const dispatched = new Set(orders.value.map((order) => order.defectId))
    const segmentMap = new Map(segments.value.map((segment) => [segment.id, segment]))
    const bladeMap = new Map(blades.value.map((blade) => [blade.id, blade]))
    const turbineMap = new Map(turbines.value.map((turbine) => [turbine.id, turbine]))
    const options: DispatchOption[] = []
    defects.value.forEach((defect) => {
      if (defect.state === '已修复' || dispatched.has(defect.id)) return
      const segment = segmentMap.get(defect.segmentId) ?? null
      const blade = segment ? bladeMap.get(segment.bladeId) ?? null : null
      const turbine = blade ? turbineMap.get(blade.turbineId) ?? null : null
      options.push({ defect, segment, blade, turbine })
    })
    return options
  })

  function patchFilter(patch: {
    keyword?: string
    teams?: string[]
    states?: WorkOrderState[]
    onlyOverdue?: boolean
  }): void {
    if (patch.keyword !== undefined) keyword.value = patch.keyword
    if (patch.teams !== undefined) teamFilter.value = patch.teams
    if (patch.states !== undefined) stateFilter.value = patch.states
    if (patch.onlyOverdue !== undefined) onlyOverdue.value = patch.onlyOverdue
  }

  function resetFilters(): void {
    keyword.value = ''
    teamFilter.value = []
    stateFilter.value = []
    onlyOverdue.value = false
  }

  function orderById(id: string): WorkOrder | undefined {
    return orders.value.find((order) => order.id === id)
  }

  function ordersOfDefect(defectId: string): WorkOrder[] {
    return orders.value.filter((order) => order.defectId === defectId)
  }

  /** 派工：新建工单（待派）并把缺陷置为「已派工」 */
  async function dispatch(input: DispatchInput): Promise<WorkOrder> {
    const order = await workOrdersTable.create(
      {
        defectId: input.defectId,
        team: input.team,
        dueDate: input.dueDate,
        state: '待派',
        acceptor: '',
        closedAt: null
      },
      'wo'
    )
    await defectsTable.update(input.defectId, { state: '已派工' })
    return order
  }

  /** 批量派工：同一个班组 + 同一限期 */
  async function dispatchMany(defectIds: string[], team: string, dueDate: string): Promise<number> {
    let count = 0
    for (const defectId of defectIds) {
      await dispatch({ defectId, team, dueDate })
      count += 1
    }
    return count
  }

  async function updateWorkOrder(id: string, patch: Partial<WorkOrder>): Promise<void> {
    await workOrdersTable.update(id, patch)
  }

  /** 状态推进：待派 → 处理中 → 待验收（闭环需走验收） */
  async function advanceState(id: string): Promise<WorkOrderState | null> {
    const order = orderById(id)
    if (!order) return null
    const next = nextWorkOrderState(order.state)
    if (!next || next === '已闭环') return null
    await workOrdersTable.update(id, { state: next })
    return next
  }

  /** 验收闭环：写入验收人与闭环时间，并回写缺陷为「已修复」 */
  async function acceptOrder(id: string, acceptor: string): Promise<void> {
    const order = orderById(id)
    if (!order) return
    await workOrdersTable.update(id, {
      state: '已闭环',
      acceptor: acceptor.trim(),
      closedAt: Date.now()
    })
    await defectsTable.update(order.defectId, { state: '已修复' })
  }

  /** 撤回验收：已闭环 → 待验收，缺陷回到「已派工」 */
  async function reopenOrder(id: string): Promise<void> {
    const order = orderById(id)
    if (!order) return
    await workOrdersTable.update(id, { state: '待验收', closedAt: null })
    await defectsTable.update(order.defectId, { state: '已派工' })
  }

  /** 删除工单并按剩余工单重算缺陷状态 */
  async function removeWorkOrder(id: string): Promise<void> {
    const order = orderById(id)
    if (!order) return
    await workOrdersTable.remove(id)
    // liveQuery 订阅是异步刷新的，这里显式排除已删除的工单
    const rest = ordersOfDefect(order.defectId).filter((item) => item.id !== id)
    if (rest.length === 0) {
      await defectsTable.update(order.defectId, { state: '待处理' })
      return
    }
    const allClosed = rest.every((item) => item.state === '已闭环')
    await defectsTable.update(order.defectId, { state: allClosed ? '已修复' : '已派工' })
  }

  return {
    orders,
    defects,
    segments,
    blades,
    turbines,
    loading,
    ordersReady,
    keyword,
    teamFilter,
    stateFilter,
    onlyOverdue,
    today,
    rows,
    filteredRows,
    sortedRows,
    teamOptions,
    stats,
    dispatchableDefects,
    patchFilter,
    resetFilters,
    orderById,
    ordersOfDefect,
    dispatch,
    dispatchMany,
    updateWorkOrder,
    advanceState,
    acceptOrder,
    reopenOrder,
    removeWorkOrder
  }
})
