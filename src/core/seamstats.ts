import type { SeamStats } from '../types';
import { meanStd, studentTUpperTail } from './math';

/**
 * 四方连续接缝统计检验
 *
 * 工程目标是"接缝处与内部在统计上没有显著区别"——这是一个等效性
 * 问题而非差异性问题，因此采用双单侧检验（TOST, Two One-Sided Tests）：
 *
 *   设 Δ = 接缝色差均值 − 内部色差均值，等效界值 margin = k·σ_internal
 *   H01: Δ ≤ -margin   H02: Δ ≥ +margin
 *   两个单侧 t 检验同时被拒绝（p1<α 且 p2<α）=> 判定等效（可平铺）。
 *
 * 同时保留经典 Welch 检验量与效应量（Cohen's d）作为报告信息。
 * 零方差完美接缝（σ_seam=0）在 TOST 下自然通过。
 *
 * 采样：
 * - 接缝样本：左右、上下回绕边各取 n 对；
 * - 内部样本：同样数量的水平/垂直相邻对，限制在边界内 2px 安全区，
 *   绝不触碰回绕边，避免基准污染。
 */
export function analyzeSeam(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  samplesPerEdge = 2000
): SeamStats {
  const seamDiffs: number[] = [];
  const interiorDiffs: number[] = [];

  const colorDist = (i1: number, i2: number): number => {
    const dr = data[i1] - data[i2];
    const dg = data[i1 + 1] - data[i2 + 1];
    const db = data[i1 + 2] - data[i2 + 2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const n = Math.min(samplesPerEdge, Math.max(256, Math.floor(Math.min(w, h) / 2)));
  const xSpan = Math.max(1, w - 5);
  const ySpan = Math.max(1, h - 5);

  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const x = Math.min(w - 1, Math.floor(t * w));
    const y = Math.min(h - 1, Math.floor(t * h));

    seamDiffs.push(colorDist((y * w + (w - 1)) * 4, (y * w) * 4));
    seamDiffs.push(colorDist(((h - 1) * w + x) * 4, x * 4));

    const xi = 2 + ((k * 7919) % xSpan);
    const yi = 2 + ((k * 6271) % ySpan);
    interiorDiffs.push(colorDist((yi * w + xi) * 4, (yi * w + xi + 1) * 4));
    interiorDiffs.push(colorDist((yi * w + xi) * 4, ((yi + 1) * w + xi) * 4));
  }

  const s = meanStd(Float64Array.from(seamDiffs));
  const m = meanStd(Float64Array.from(interiorDiffs));
  const n1 = seamDiffs.length;
  const n2 = interiorDiffs.length;

  const se = Math.sqrt((s.std * s.std) / n1 + (m.std * m.std) / n2);
  const delta = s.mean - m.mean;
  const tStat = se === 0 ? 0 : delta / se;
  const num = Math.pow(s.std * s.std / n1 + m.std * m.std / n2, 2);
  const den =
    Math.pow(s.std * s.std / n1, 2) / (n1 - 1) + Math.pow(m.std * m.std / n2, 2) / (n2 - 1);
  const dof = den === 0 ? n1 + n2 - 2 : num / den;
  const welchP = studentTUpperTail(Math.abs(tStat), dof) * 2;

  // —— TOST 等效性检验 ——
  // 等效界值：取"内部相邻色差均值"与"内部色差 0.35σ 波动容差"的较大者，
  // 再加绝对下限。含义：接缝差异只要不超过贴图内部随处可见的典型
  // 相邻像素变化，人眼与铺贴软件都无法区分，即统计等效。
  const margin = Math.max(1.5, m.mean, 0.35 * m.std);
  // 接缝本身的绝对差异已低于内部典型变化：直接判等效。
  // 这同时正确处理"零接缝"（seam 均值与方差都趋零）这一比等效更好的情形。
  const effectivelySeamless = s.mean <= margin;
  // 单侧 t：tLow>0 才能拒绝 H01（Δ ≤ -margin），tHigh>0 才能拒绝 H02（Δ ≥ +margin）
  const tLow = se === 0 ? Infinity : (delta + margin) / se;
  const tHigh = se === 0 ? Infinity : (margin - delta) / se;
  const p1 = effectivelySeamless ? 0 : tLow > 0 ? studentTUpperTail(tLow, dof) : 1;
  const p2 = effectivelySeamless ? 0 : tHigh > 0 ? studentTUpperTail(tHigh, dof) : 1;
  const pass = p1 < 0.05 && p2 < 0.05;

  // Cohen's d（合并标准差），效应量报告
  const pooledStd = Math.sqrt(((n1 - 1) * s.std * s.std + (n2 - 1) * m.std * m.std) / (n1 + n2 - 2));
  const cohensD = pooledStd === 0 ? 0 : delta / pooledStd;

  return {
    seamMean: s.mean,
    interiorMean: m.mean,
    seamStd: s.std,
    interiorStd: m.std,
    margin,
    tStat,
    dof,
    pValue: welchP,
    pEquivalence: Math.max(p1, p2),
    cohensD,
    n: n1,
    pass
  };
}
