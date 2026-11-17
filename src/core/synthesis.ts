import type { ProgressMsg, SynthesisParams } from '../types';
import { ImageBuffer } from './image';
import { clamp, rng } from './math';

/**
 * 四方连续纹理合成（环形 Image Quilting）
 *
 * 思路：
 * 1. 输出画布本身是环面（torus），块坐标越界自动回绕——天然保证可平铺；
 * 2. 先用随机样本块铺满环面，让所有重叠区都有合法邻居；
 * 3. 蛇形扫描两遍，每块按重叠区 SSD 选候选，再用动态规划 min-cut 切缝；
 * 4. 第二遍重切所有接缝，保证首行/首列与末行/末列的回绕边也被切到。
 */

interface Patch {
  sx: number;
  sy: number;
}

export function synthesize(
  source: ImageBuffer,
  params: SynthesisParams,
  onProgress?: (p: ProgressMsg) => void
): ImageBuffer {
  const { patchSize: P, overlap: O, candidates: K, seed } = params;
  const rand = rng(seed);
  const step = P - O;

  // 网格数：画布 S = N*step，块在 S 处回绕，回绕部分恰好与首块重叠 O
  const N = Math.max(2, Math.round(params.outSize / step));
  const S = N * step;

  if (P >= source.width || P >= source.height) {
    throw new Error('合成块尺寸接近或超过样片尺寸，请减小块尺寸或使用更大的样片');
  }
  const margin = 1;
  const maxX = source.width - P - margin;
  const maxY = source.height - P - margin;

  const canvas = ImageBuffer.create(S, S);
  const cd = canvas.data;
  const sd = source.data;
  const sw = source.width;

  // —— 初始化：随机块环形铺满 ——
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p = randomPatch(rand, maxX, maxY);
      blit(cd, S, sd, sw, p, j * step, i * step, P, true);
    }
  }

  const sweeps = params.mode === 'quilting' ? 2 : 1;
  let totalWork = sweeps * N * N;
  let done = 0;

  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (let i = 0; i < N; i++) {
      // 蛇形：偶数行从左到右，奇数行从右到左
      const reverse = i % 2 === 1;
      for (let jj = 0; jj < N; jj++) {
        const j = reverse ? N - 1 - jj : jj;
        const bx = j * step;
        const by = i * step;

        // 1) 采样 K 个候选，按重叠区 SSD 选最优
        let best: Patch | null = null;
        let bestErr = Infinity;
        for (let k = 0; k < K; k++) {
          const p = randomPatch(rand, maxX, maxY);
          const err = overlapError(cd, S, sd, sw, p, bx, by, P, O);
          if (err < bestErr) {
            bestErr = err;
            best = p;
          }
        }
        const patch = best!;

        if (params.mode === 'feather') {
          blitFeather(cd, S, sd, sw, patch, bx, by, P, O);
        } else {
          blitMinCut(cd, S, sd, sw, patch, bx, by, P, O);
        }

        done++;
        if (done % 4 === 0 || done === totalWork) {
          onProgress?.({
            phase: sweep === 0 ? '纹理合成（第一遍）' : '纹理合成（回绕接缝重切）',
            ratio: done / totalWork
          });
        }
      }
    }
  }

  // 环形重采样到精确输出尺寸（保持 toroidal 连续性）
  onProgress?.({ phase: '重采样到目标尺寸', ratio: 0.95 });
  const resized = resizeSquareToroidal(canvas, params.outSize);
  // 环面条带样条混合：数学上保证回绕边零色差，内部像素不动
  onProgress?.({ phase: '接缝融合', ratio: 0.97 });
  const out = params.mode === 'feather' ? resized : toroidalBlend(resized);
  onProgress?.({ phase: '完成', ratio: 1 });
  return out;
}

function randomPatch(rand: () => number, maxX: number, maxY: number): Patch {
  return {
    sx: Math.floor(rand() * (maxX + 1)),
    sy: Math.floor(rand() * (maxY + 1))
  };
}

/** 环形/普通贴块 */
function blit(
  cd: Uint8ClampedArray,
  S: number,
  sd: Uint8ClampedArray,
  sw: number,
  p: Patch,
  bx: number,
  by: number,
  P: number,
  wrap: boolean
): void {
  for (let y = 0; y < P; y++) {
    const cy = wrap ? (by + y) % S : by + y;
    if (cy >= S) continue;
    for (let x = 0; x < P; x++) {
      const cx = wrap ? (bx + x) % S : bx + x;
      if (cx >= S) continue;
      const si = ((p.sy + y) * sw + (p.sx + x)) * 4;
      const di = (cy * S + cx) * 4;
      cd[di] = sd[si];
      cd[di + 1] = sd[si + 1];
      cd[di + 2] = sd[si + 2];
      cd[di + 3] = 255;
    }
  }
}

/** 候选块与画布左/上重叠区的 SSD（环形读取） */
function overlapError(
  cd: Uint8ClampedArray,
  S: number,
  sd: Uint8ClampedArray,
  sw: number,
  p: Patch,
  bx: number,
  by: number,
  P: number,
  O: number
): number {
  let err = 0;
  // 左重叠带（整列高）
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < O; x++) {
      const si = ((p.sy + y) * sw + (p.sx + x)) * 4;
      const di = ringIndex(S,bx + x, by + y);
      err += sq(sd[si] - cd[di]) + sq(sd[si + 1] - cd[di + 1]) + sq(sd[si + 2] - cd[di + 2]);
    }
  }
  // 上重叠带（不含左上角，避免重复计权）
  for (let y = 0; y < O; y++) {
    for (let x = O; x < P; x++) {
      const si = ((p.sy + y) * sw + (p.sx + x)) * 4;
      const di = ringIndex(S,bx + x, by + y);
      err += sq(sd[si] - cd[di]) + sq(sd[si + 1] - cd[di + 1]) + sq(sd[si + 2] - cd[di + 2]);
    }
  }
  return err;
}

function ringIndex(S: number, x: number, y: number): number {
  return (((y + S) % S) * S + ((x + S) % S)) * 4;
}

function sq(v: number): number {
  return v * v;
}

/** 最小切缝贴块：左重叠带走竖直缝，上重叠带走水平缝，角区取联合规则 */
function blitMinCut(
  cd: Uint8ClampedArray,
  S: number,
  sd: Uint8ClampedArray,
  sw: number,
  p: Patch,
  bx: number,
  by: number,
  P: number,
  O: number
): void {
  // 能量矩阵
  const eL = new Float32Array(P * O);
  const eT = new Float32Array(O * P);
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < O; x++) {
      const si = ((p.sy + y) * sw + (p.sx + x)) * 4;
      const di = ringIndex(S,bx + x, by + y);
      let e = 0;
      for (let c = 0; c < 3; c++) e += sq(sd[si + c] - cd[di + c]);
      eL[y * O + x] = e;
    }
  }
  for (let y = 0; y < O; y++) {
    for (let x = 0; x < P; x++) {
      const si = ((p.sy + y) * sw + (p.sx + x)) * 4;
      const di = ringIndex(S,bx + x, by + y);
      let e = 0;
      for (let c = 0; c < 3; c++) e += sq(sd[si + c] - cd[di + c]);
      eT[y * P + x] = e;
    }
  }

  const seamL = verticalSeam(eL, P, O); // 每行一个切缝列
  const seamT = horizontalSeam(eT, O, P); // 每列一个切缝行

  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      let takeNew = true;
      if (x < O && y < O) {
        // 角区：任一切缝判定为新块则取新块
        takeNew = x >= seamL[y] || y >= seamT[x];
      } else if (x < O) {
        takeNew = x >= seamL[y];
      } else if (y < O) {
        takeNew = y >= seamT[x];
      }
      if (!takeNew) continue;
      const si = ((p.sy + y) * sw + (p.sx + x)) * 4;
      const di = ringIndex(S,bx + x, by + y);
      cd[di] = sd[si];
      cd[di + 1] = sd[si + 1];
      cd[di + 2] = sd[si + 2];
    }
  }
}

/** 自上而下的最小能量竖直缝，返回每行的切缝列（该列及其右侧取新块） */
function verticalSeam(e: Float32Array, rows: number, cols: number): Int32Array {
  const dp = new Float32Array(rows * cols);
  const back = new Int32Array(rows * cols);
  for (let x = 0; x < cols; x++) dp[x] = e[x];
  for (let y = 1; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let best = dp[(y - 1) * cols + x];
      let bx = x;
      if (x > 0 && dp[(y - 1) * cols + x - 1] < best) {
        best = dp[(y - 1) * cols + x - 1];
        bx = x - 1;
      }
      if (x < cols - 1 && dp[(y - 1) * cols + x + 1] < best) {
        best = dp[(y - 1) * cols + x + 1];
        bx = x + 1;
      }
      dp[y * cols + x] = e[y * cols + x] + best;
      back[y * cols + x] = bx;
    }
  }
  const seam = new Int32Array(rows);
  let cx = 0;
  for (let x = 1; x < cols; x++) {
    if (dp[(rows - 1) * cols + x] < dp[(rows - 1) * cols + cx]) cx = x;
  }
  for (let y = rows - 1; y >= 0; y--) {
    seam[y] = cx;
    cx = back[y * cols + cx];
  }
  return seam;
}

/** 自左而右的最小能量水平缝，返回每列的切缝行 */
function horizontalSeam(e: Float32Array, rows: number, cols: number): Int32Array {
  const dp = new Float32Array(rows * cols);
  const back = new Int32Array(rows * cols);
  for (let y = 0; y < rows; y++) dp[y * cols] = e[y * cols];
  for (let x = 1; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      let best = dp[y * cols + x - 1];
      let by = y;
      if (y > 0 && dp[(y - 1) * cols + x - 1] < best) {
        best = dp[(y - 1) * cols + x - 1];
        by = y - 1;
      }
      if (y < rows - 1 && dp[(y + 1) * cols + x - 1] < best) {
        best = dp[(y + 1) * cols + x - 1];
        by = y + 1;
      }
      dp[y * cols + x] = e[y * cols + x] + best;
      back[y * cols + x] = by;
    }
  }
  const seam = new Int32Array(cols);
  let cy = 0;
  for (let y = 1; y < rows; y++) {
    if (dp[y * cols + cols - 1] < dp[cy * cols + cols - 1]) cy = y;
  }
  for (let x = cols - 1; x >= 0; x--) {
    seam[x] = cy;
    cy = back[cy * cols + x];
  }
  return seam;
}

/** 快速模式：重叠区线性羽化混合 */
function blitFeather(
  cd: Uint8ClampedArray,
  S: number,
  sd: Uint8ClampedArray,
  sw: number,
  p: Patch,
  bx: number,
  by: number,
  P: number,
  O: number
): void {
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      let a = 1;
      if (x < O || y < O) {
        const ax = x < O ? x / (O - 1) : 1;
        const ay = y < O ? y / (O - 1) : 1;
        a = Math.max(ax, ay);
      }
      const si = ((p.sy + y) * sw + (p.sx + x)) * 4;
      const di = ringIndex(S,bx + x, by + y);
      cd[di] = cd[di] * (1 - a) + sd[si] * a;
      cd[di + 1] = cd[di + 1] * (1 - a) + sd[si + 1] * a;
      cd[di + 2] = cd[di + 2] * (1 - a) + sd[si + 2] * a;
    }
  }
}

/** 环形双线性缩放到正方形：边界采样按环面回绕，缩放本身不引入接缝 */
function resizeSquareToroidal(src: ImageBuffer, outSize: number): ImageBuffer {
  const out = ImageBuffer.create(outSize, outSize);
  const ratio = src.width / outSize;
  const w = src.width;
  const h = src.height;
  const at = (x: number, y: number, c: number): number =>
    src.data[(((y + h) % h) * w + ((x + w) % w)) * 4 + c];
  for (let y = 0; y < outSize; y++) {
    const sy = y * ratio;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < outSize; x++) {
      const sx = x * ratio;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const o = (y * outSize + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
        const bot = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx;
        out.data[o + c] = clamp(top * (1 - fy) + bot * fy, 0, 255);
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/**
 * 环面条带样条混合（保证四方连续）：
 * 对每条回绕边，把接缝两侧各 b 像素的条带按 smoothstep 权重
 * 向共同的中点值混合——接缝处两侧取同一个值（零色差），
 * 条带外侧权重为 0（内部像素原样保留）。
 * 水平、垂直两个方向依次处理。
 */
function toroidalBlend(src: ImageBuffer): ImageBuffer {
  const w = src.width;
  const h = src.height;
  const out = src.clone();
  const b = Math.max(4, Math.round(Math.min(w, h) * 0.08));
  const smooth = (t: number) => t * t * (3 - 2 * t);

  // 垂直回绕边（左 x=0 / 右 x=w-1）
  for (let y = 0; y < h; y++) {
    for (let k = 0; k < b; k++) {
      // 缝边 a=1（两侧取同一中点值），条带内侧 a=0（原值不变）
      const a = smooth(1 - k / b);
      const xL = k;
      const xR = w - 1 - k;
      const iL = (y * w + xL) * 4;
      const iR = (y * w + xR) * 4;
      for (let c = 0; c < 3; c++) {
        const l = out.data[iL + c];
        const r = out.data[iR + c];
        const mid = (l + r) / 2;
        out.data[iL + c] = l + (mid - l) * a;
        out.data[iR + c] = r + (mid - r) * a;
      }
    }
  }

  // 水平回绕边（上 y=0 / 下 y=h-1），在垂直融合结果上继续
  for (let x = 0; x < w; x++) {
    for (let k = 0; k < b; k++) {
      const a = smooth(1 - k / b);
      const iT = (k * w + x) * 4;
      const iB = ((h - 1 - k) * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const t = out.data[iT + c];
        const btm = out.data[iB + c];
        const mid = (t + btm) / 2;
        out.data[iT + c] = t + (mid - t) * a;
        out.data[iB + c] = btm + (mid - btm) * a;
      }
    }
  }
  return out;
}
