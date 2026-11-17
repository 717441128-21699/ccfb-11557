/** 全局共享类型 */

export type PageId = 'import' | 'seam' | 'bake' | 'preview' | 'batch';

export interface Pt {
  x: number;
  y: number;
}

export interface CorrectionParams {
  /** 透视校正四个角点（归一化 0..1，顺序：左上、右上、右下、左下） */
  corners: [Pt, Pt, Pt, Pt];
  /** 是否启用光照不均校正 */
  flatfield: boolean;
  /** 光照校正强度 0..1 */
  flatfieldStrength: number;
  /** 光照低通估计半径（相对样片边长的比例 0.05..0.5） */
  flatfieldRadius: number;
}

export interface SynthesisParams {
  /** 输出贴图边长（像素，正方形） */
  outSize: number;
  /** 合成块边长（像素） */
  patchSize: number;
  /** 重叠区宽度（像素） */
  overlap: number;
  /** 候选块搜索数量 */
  candidates: number;
  /** 算法：quilting 高质量 min-cut；feather 快速羽化混合 */
  mode: 'quilting' | 'feather';
  /** 随机种子（可复现） */
  seed: number;
}

export interface PBRParams {
  /** 法线强度（高度缩放） */
  normalStrength: number;
  /** 粗糙度基准 0..1 */
  roughnessBase: number;
  /** 粗糙度对比（亮度映射幅度） */
  roughnessContrast: number;
  /** 高光强度 0..1 */
  specularLevel: number;
  /** 光泽釉面 clearcoat 0..1 */
  clearcoat: number;
}

export interface SeamStats {
  /** 接缝处相邻像素色差均值 */
  seamMean: number;
  /** 内部相邻像素色差均值 */
  interiorMean: number;
  /** 接缝色差样本标准差 */
  seamStd: number;
  /** 内部色差样本标准差 */
  interiorStd: number;
  /** TOST 等效界值 */
  margin: number;
  /** Welch t 检验统计量（报告用） */
  tStat: number;
  /** 自由度 */
  dof: number;
  /** Welch 双尾 p 值（差异性检验，报告用） */
  pValue: number;
  /** TOST 等效性检验 p 值（<0.05 判定等效） */
  pEquivalence: number;
  /** 效应量 Cohen's d */
  cohensD: number;
  /** 样本量（每条边的采样对数） */
  n: number;
  /** 是否通过（TOST 等效，即统计上无显著区别） */
  pass: boolean;
}

export interface Colorway {
  id: string;
  name: string;
  /** 目标主色（Lab），null 表示保持原色 */
  lab: { l: number; a: number; b: number } | null;
  /** 色相旋转（度），lab 为 null 时生效 */
  hueShift: number;
  /** 饱和度倍率 */
  satScale: number;
  /** 明度倍率 */
  lightScale: number;
}

export interface Preset {
  id: string;
  name: string;
  createdAt: number;
  correction: CorrectionParams;
  synthesis: SynthesisParams;
  pbr: PBRParams;
  colorways: Colorway[];
}

export interface ProgressMsg {
  phase: string;
  ratio: number;
}
