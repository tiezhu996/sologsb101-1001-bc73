/** 叶片序号：按机组内的安装顺序标记 A / B / C */
export type BladeSerial = 'A' | 'B' | 'C'
/** 叶片主材 */
export type BladeMaterial = '玻璃纤维' | '碳纤维' | '混合'

/**
 * 叶片：隶属于某台机组的一片叶片。
 * 动作：按机组展开叶片清单，并按 segmentCount 批量生成展向分段。
 */
export interface Blade {
  id: string
  turbineId: string
  serial: BladeSerial
  /** 叶片长度（米） */
  lengthM: number
  material: BladeMaterial
  /** 展向段数，批量生成分段的依据 */
  segmentCount: number
  createdAt: number
  updatedAt: number
}

export const BLADE_SERIALS: BladeSerial[] = ['A', 'B', 'C']
export const BLADE_MATERIALS: BladeMaterial[] = ['玻璃纤维', '碳纤维', '混合']

export const DEFAULT_BLADE_LENGTH_M = 68.5
export const DEFAULT_SEGMENT_COUNT = 3
export const MIN_SEGMENT_COUNT = 1
export const MAX_SEGMENT_COUNT = 12

/** 第 index 片叶片（从 0 开始）的序号：超出 A/B/C 时退化为 B4 形式的编号 */
export function serialFromIndex(index: number): BladeSerial {
  return BLADE_SERIALS[index] ?? (`B${index + 1}` as BladeSerial)
}

/** 叶片卡片回显用的聚合值 */
export interface BladeStat {
  bladeId: string
  segmentCount: number
  defectCount: number
  openCount: number
  heavyCount: number
}
