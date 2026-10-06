import type { DefectState, Severity } from '@/types/defect'
import type { WorkOrderState } from '@/types/workOrder'

/** 严重程度排序权重：重度最前 */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  重度: 30,
  中度: 20,
  轻度: 10
}

/** 严重程度配色映射：标签底色与统计条 */
export const SEVERITY_COLOR: Record<Severity, string> = {
  重度: '#c0392b',
  中度: '#d68910',
  轻度: '#1e8449'
}

/** 严重程度对应的浅色底（描边风格标签背景） */
export const SEVERITY_BG: Record<Severity, string> = {
  重度: '#fdecea',
  中度: '#fdf3e3',
  轻度: '#eaf6ee'
}

/** 严重程度图标（Element Plus 图标组件名） */
export const SEVERITY_ICON: Record<Severity, string> = {
  重度: 'CircleCloseFilled',
  中度: 'WarningFilled',
  轻度: 'SuccessFilled'
}

/** 严重程度 → Element Plus tag 类型 */
export const SEVERITY_TAG_TYPE: Record<Severity, 'success' | 'warning' | 'danger'> = {
  重度: 'danger',
  中度: 'warning',
  轻度: 'success'
}

/** 缺陷处置状态 → Element Plus tag 类型 */
export const DEFECT_STATE_TAG_TYPE: Record<DefectState, 'danger' | 'warning' | 'success'> = {
  待处理: 'danger',
  已派工: 'warning',
  已修复: 'success'
}

/** 工单状态 → Element Plus tag 类型 */
export const WORK_ORDER_STATE_TAG_TYPE: Record<
  WorkOrderState,
  'info' | 'warning' | 'primary' | 'success'
> = {
  待派: 'info',
  处理中: 'warning',
  待验收: 'primary',
  已闭环: 'success'
}

/* ---------------- 毫米 / 米单位换算 ---------------- */

export const MM_PER_M = 1000

export function mmToM(mm: number): number {
  return round(mm / MM_PER_M, 4)
}

export function mToMm(m: number): number {
  return round(m * MM_PER_M, 2)
}

/** 毫米读数：超过 1 m 自动换算成米，便于表格与报告展示 */
export function formatMm(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return '0 mm'
  if (mm >= MM_PER_M) return `${mmToM(mm).toFixed(2)} m`
  return `${round(mm, 1)} mm`
}

/** 缺陷尺寸文案：820 mm × 36 mm */
export function formatSize(lengthMm: number, widthMm: number): string {
  return `${formatMm(lengthMm)} × ${formatMm(widthMm)}`
}

/** 缺陷面积（平方厘米）：长 × 宽，用于损伤面积汇总 */
export function defectAreaCm2(lengthMm: number, widthMm: number): number {
  return round((lengthMm * widthMm) / 100, 2)
}

/** 面积可读文案 */
export function formatArea(areaCm2: number): string {
  if (!Number.isFinite(areaCm2) || areaCm2 <= 0) return '0 cm²'
  if (areaCm2 >= 10000) return `${(areaCm2 / 10000).toFixed(2)} m²`
  if (areaCm2 >= 100) return `${(areaCm2 / 100).toFixed(2)} dm²`
  return `${round(areaCm2, 1)} cm²`
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 排序比较器：重度 > 中度 > 轻度，同级按长度降序 */
export function compareSeverity(a: Severity, b: Severity, lengthA = 0, lengthB = 0): number {
  const diff = SEVERITY_WEIGHT[b] - SEVERITY_WEIGHT[a]
  if (diff !== 0) return diff
  return lengthB - lengthA
}

/** 严重程度档位比例（0-1），用于进度条着色 */
export function severityRatio(severity: Severity): number {
  return SEVERITY_WEIGHT[severity] / SEVERITY_WEIGHT['重度']
}

/** 占比：分母为 0 时返回 0，返回 0-100 的整数 */
export function percentOf(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0
  return Math.round((part / total) * 100)
}
