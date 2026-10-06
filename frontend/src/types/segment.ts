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

/* ---------------- 单段拆分 ---------------- */

/** 参与拆分归段计算的最小缺陷结构（types 层不反向依赖 defect.ts） */
export interface SplitDefectLike {
  /** 展向位置（米，缺陷中点） */
  positionM: number
  /** 缺陷长度（毫米），换算成展向跨度判断是否跨过分界点 */
  lengthMm: number
}

/** 拆分归段结果：front 前段（根部侧）/ rear 新段（叶尖侧） */
export type SplitPlacement = 'front' | 'rear'

/** 分界点是否严格落在段内（不含两个端点） */
export function isValidSplitPoint(startM: number, endM: number, splitM: number): boolean {
  return Number.isFinite(splitM) && splitM > startM && splitM < endM
}

/**
 * 单段拆分时确定一条缺陷归入前段还是新段：
 * 以 positionM 为中点、lengthMm 换算展向跨度（超出本段的部分裁掉），
 * 比较缺陷在分界点两侧的覆盖长度，覆盖更多的一侧接走；同样多时以根部侧（前段）为准。
 */
export function splitPlacementForDefect(
  startM: number,
  endM: number,
  splitM: number,
  defect: SplitDefectLike
): SplitPlacement {
  const halfSpanM = defect.lengthMm / 2000 // 毫米 → 米后取半
  const defectStart = Math.max(startM, defect.positionM - halfSpanM)
  const defectEnd = Math.min(endM, defect.positionM + halfSpanM)
  const frontCover = Math.max(0, Math.min(defectEnd, splitM) - defectStart)
  const rearCover = Math.max(0, defectEnd - Math.max(defectStart, splitM))
  return rearCover > frontCover ? 'rear' : 'front'
}

/** 拆分对话框预览的归段预案 */
export interface SegmentSplitPlan {
  /** 归一化（保留两位小数）后的分界米数 */
  boundaryM: number
  /** 归入前段（根部侧）的缺陷数 */
  frontDefects: number
  /** 归入新段（叶尖侧）的缺陷数 */
  rearDefects: number
  /** 长度跨过分界点的缺陷数 */
  crossBoundaryDefects: number
}

/**
 * 计算单段拆分预案；分界点不合法时返回 null。
 * 页面预览与 store 写库共用同一套归段口径。
 */
export function planSegmentSplit(
  segment: Pick<Segment, 'startM' | 'endM'>,
  defects: readonly SplitDefectLike[],
  splitM: number
): SegmentSplitPlan | null {
  const boundaryM = Math.round(splitM * 100) / 100
  if (!isValidSplitPoint(segment.startM, segment.endM, boundaryM)) return null
  let front = 0
  let rear = 0
  let cross = 0
  defects.forEach((defect) => {
    const halfSpanM = defect.lengthMm / 2000
    if (defect.positionM - halfSpanM < boundaryM && defect.positionM + halfSpanM > boundaryM) {
      cross += 1
    }
    if (
      splitPlacementForDefect(segment.startM, segment.endM, boundaryM, defect) === 'rear'
    ) {
      rear += 1
    } else {
      front += 1
    }
  })
  return { boundaryM, frontDefects: front, rearDefects: rear, crossBoundaryDefects: cross }
}
