/**
 * 风电机组台账：一个机位上的整机记录。
 * 新建机组后按 bladeCount 派生对应数量的 Blade 叶片记录。
 */
export interface Turbine {
  id: string
  /** 机组编号，如 WT-A01 */
  code: string
  /** 机型，如 GW155-4.5MW */
  model: string
  /** 轮毂高度（米） */
  hubHeightM: number
  /** 投运日期 YYYY-MM-DD */
  commissionDate: string
  /** 叶片数，派生叶片记录的依据 */
  bladeCount: number
  createdAt: number
  updatedAt: number
}

/** 机型候选（同时作为机组合账的机型筛选项） */
export const TURBINE_MODELS: string[] = [
  'GW155-4.5MW',
  'GW171-6.0MW',
  'GW136-3.6MW',
  'EN-141-3.0MW'
]

/** 新建机组时允许的叶片数范围 */
export const MIN_BLADE_COUNT = 1
export const MAX_BLADE_COUNT = 4
export const DEFAULT_BLADE_COUNT = 3

/** 机组合账卡片回显用的聚合值 */
export interface TurbineStat {
  turbineId: string
  /** 已派生叶片数 */
  bladeCount: number
  /** 展向分段总数 */
  segmentCount: number
  /** 缺陷总数 */
  defectCount: number
  /** 未闭环缺陷数（state !== 已修复） */
  openCount: number
  /** 重度缺陷数 */
  heavyCount: number
  /** 重度占比，0-100 的整数 */
  heavyPercent: number
}

/** 投运年份筛选：从投运日期中截取年份 */
export function commissionYearOf(turbine: Turbine): string {
  return turbine.commissionDate.slice(0, 4)
}
