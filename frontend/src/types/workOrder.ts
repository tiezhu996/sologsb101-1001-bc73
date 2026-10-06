/** 工单状态流转：待派 → 处理中 → 待验收 → 已闭环 */
export type WorkOrderState = '待派' | '处理中' | '待验收' | '已闭环'

/**
 * 维修工单：针对一条缺陷派发的检修任务，验收通过后回写缺陷为已修复。
 */
export interface WorkOrder {
  id: string
  defectId: string
  /** 派工班组 */
  team: string
  /** 限期 YYYY-MM-DD */
  dueDate: string
  state: WorkOrderState
  /** 验收人，闭环时填写 */
  acceptor: string
  /** 闭环时间戳，未闭环为 null */
  closedAt: number | null
  createdAt: number
  updatedAt: number
}

export const WORK_TEAMS: string[] = ['叶片检修一班', '高空作业二班', '复材修复三班', '无人机巡检组']
export const WORK_ORDER_STATES: WorkOrderState[] = ['待派', '处理中', '待验收', '已闭环']

/** 状态机：每个状态的下一状态，已闭环没有下一状态 */
export const WORK_ORDER_FLOW: Record<WorkOrderState, WorkOrderState | null> = {
  待派: '处理中',
  处理中: '待验收',
  待验收: '已闭环',
  已闭环: null
}

export const WORK_ORDER_STATE_COLOR: Record<WorkOrderState, string> = {
  待派: '#8c8479',
  处理中: '#d68910',
  待验收: '#4a6fa5',
  已闭环: '#1e8449'
}

export function nextWorkOrderState(state: WorkOrderState): WorkOrderState | null {
  return WORK_ORDER_FLOW[state]
}

/** 工单统计汇总，维修工单页与报告页直接消费 */
export interface WorkOrderStat {
  total: number
  pending: number
  processing: number
  awaiting: number
  closed: number
  /** 已超期（限期已过且未闭环）的数量 */
  overdue: number
  /** 闭环率，0-100 的整数 */
  closedPercent: number
}

/** 工单是否超期：限期早于今天且尚未闭环 */
export function isOverdue(order: WorkOrder, today: string): boolean {
  if (order.state === '已闭环') return false
  if (!order.dueDate) return false
  return order.dueDate < today
}

/** 空工单统计 */
export function createEmptyWorkOrderStat(): WorkOrderStat {
  return { total: 0, pending: 0, processing: 0, awaiting: 0, closed: 0, overdue: 0, closedPercent: 0 }
}
