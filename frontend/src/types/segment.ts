/** 检修面：PS 迎风面 / SS 背风面 / LE 前缘 / TE 后缘 */
export type SegmentFace = 'PS' | 'SS' | 'LE' | 'TE'

/**
 * 展向分段：叶片沿展向切出的一段，挂接剖面图并叠加缺陷记录。
 */
export interface Segment {
  id: string
  bladeId: string
  /** 段序号，从 1 开始（根部 → 叶尖） */
  index: number
  /** 起始米数 */
  startM: number
  /** 结束米数 */
  endM: number
  /** 翼型代号 */
  airfoil: string
  /** 检修面 */
  face: SegmentFace
  /** 剖面图文件名，如 seg-01-PS.png */
  sectionImage: string
  /** 剖面图本地预览（DataURL，文件不离开浏览器；仅用于页面回显） */
  sectionPreview?: string
  createdAt: number
  updatedAt: number
}

export const SEGMENT_FACES: SegmentFace[] = ['PS', 'SS', 'LE', 'TE']

/** 检修面中文全称 */
export const FACE_LABEL: Record<SegmentFace, string> = {
  PS: 'PS 迎风面',
  SS: 'SS 背风面',
  LE: 'LE 前缘',
  TE: 'TE 后缘'
}

/** 检修面短标签 */
export const FACE_SHORT: Record<SegmentFace, string> = {
  PS: '迎风面',
  SS: '背风面',
  LE: '前缘',
  TE: '后缘'
}

export function faceLabel(face: SegmentFace): string {
  return FACE_LABEL[face] ?? face
}

/** 翼型代号候选 */
export const AIRFOILS: string[] = ['DU-91-W2-250', 'DU-93-W-210', 'FX77-W-153', 'NACA 64-618']

/** 分段缺陷汇总，分段表与剖面视图直接消费 */
export interface SegmentStat {
  segmentId: string
  defectCount: number
  openCount: number
  heavyCount: number
}

/** 生成分段时使用的参数 */
export interface SegmentGenerateOptions {
  /** 段数 */
  count: number
  /** 起始米数 */
  startM: number
  /** 结束米数 */
  endM: number
  /** 检修面 */
  face: SegmentFace
  /** 翼型代号 */
  airfoil: string
  /** true 时先清空该叶片已有分段（含缺陷、工单） */
  overwrite: boolean
}

/** 构造形如 0.0-22.8 m 的展向区间文案 */
export function formatRange(startM: number, endM: number): string {
  return `${startM.toFixed(1)}-${endM.toFixed(1)} m`
}
