import type { CorrectionParams, Pt } from '../types';
import { ImageBuffer } from './image';
import { clamp, gaussianBlur, rgbToU8, u8ToRGB } from './math';

/**
 * 由四对点求 3x3 单应性矩阵（dst = H · src，齐次坐标）。
 * 用高斯消元解 8x8 线性方程组。
 */
export function findHomography(src: Pt[], dst: Pt[]): number[] {
  const n = 4;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < n; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const h = solveLinear(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // 选主元
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/** 透视校正：把归一化四角内的区域拉正为正方形输出 */
export function perspectiveCorrect(
  src: ImageBuffer,
  corners: [Pt, Pt, Pt, Pt],
  outSize: number
): ImageBuffer {
  const srcPts = corners.map((p) => ({
    x: clamp(p.x, 0, 1) * (src.width - 1),
    y: clamp(p.y, 0, 1) * (src.height - 1)
  }));
  const s = outSize - 1;
  const dstPts: Pt[] = [
    { x: 0, y: 0 },
    { x: s, y: 0 },
    { x: s, y: s },
    { x: 0, y: s }
  ];
  // 求 输出 -> 输入 的逆映射
  const H = findHomography(dstPts, srcPts);
  const out = ImageBuffer.create(outSize, outSize);
  const sd = src.data;
  for (let y = 0; y < outSize; y++) {
    for (let x = 0; x < outSize; x++) {
      const w = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / w;
      const sy = (H[3] * x + H[4] * y + H[5]) / w;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const o = (y * outSize + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= src.width - 1 || y0 >= src.height - 1) {
        out.data[o + 3] = 255;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * src.width + x0) * 4;
      const i01 = i00 + 4;
      const i10 = i00 + src.width * 4;
      const i11 = i10 + 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] * (1 - fx) + sd[i01 + c] * fx;
        const bot = sd[i10 + c] * (1 - fx) + sd[i11 + c] * fx;
        out.data[o + c] = clamp(top * (1 - fy) + bot * fy, 0, 255);
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/**
 * 光照不均校正（flat-field）：
 * 用大半径高斯模糊估计缓慢变化的照度场，再按均值做除法校正。
 * 输出仍为 8bit。
 */
export function flatfieldCorrect(
  src: ImageBuffer,
  radiusRatio: number,
  strength: number
): ImageBuffer {
  const rgb = u8ToRGB(src.data);
  const radius = Math.max(4, Math.round(radiusRatio * Math.min(src.width, src.height)));
  const field = gaussianBlur(rgb, src.width, src.height, 3, radius, false);
  // 每通道全局均值
  const n = src.width * src.height;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    mean[0] += field[i * 3];
    mean[1] += field[i * 3 + 1];
    mean[2] += field[i * 3 + 2];
  }
  mean[0] /= n;
  mean[1] /= n;
  mean[2] /= n;
  const corrected = new Float32Array(rgb.length);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const f = Math.max(field[i * 3 + c], 1e-4);
      const v = rgb[i * 3 + c] * (mean[c] / f);
      corrected[i * 3 + c] = rgb[i * 3 + c] * (1 - strength) + clamp(v, 0, 1) * strength;
    }
  }
  return new ImageBuffer(src.width, src.height, rgbToU8(corrected));
}

/** 完整校正管线：透视 -> 光照 */
export function runCorrection(
  src: ImageBuffer,
  params: CorrectionParams,
  outSize = 1024,
  onProgress?: (ratio: number) => void
): ImageBuffer {
  onProgress?.(0.15);
  let out = perspectiveCorrect(src, params.corners, outSize);
  onProgress?.(0.65);
  if (params.flatfield) {
    out = flatfieldCorrect(out, params.flatfieldRadius, params.flatfieldStrength);
  }
  onProgress?.(1);
  return out;
}

export function defaultCorners(): [Pt, Pt, Pt, Pt] {
  return [
    { x: 0.06, y: 0.06 },
    { x: 0.94, y: 0.06 },
    { x: 0.94, y: 0.94 },
    { x: 0.06, y: 0.94 }
  ];
}
