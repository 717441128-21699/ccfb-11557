/** 数值与图像处理基础工具（纯 CPU，无 DOM 依赖，可在 Worker 中使用） */

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

export const clamp255 = (x: number): number => (x < 0 ? 0 : x > 255 ? 255 : x);

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 可复现的 mulberry32 伪随机数生成器 */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 高斯权重（一维） */
function gauss1d(radius: number, sigma: number): Float32Array {
  const k = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/**
 * 可分离高斯模糊，支持环形（toroidal）边界。
 * 大半径时采用"积分图盒式模糊 ×3 次"逼近高斯（O(像素)，与半径无关），
 * 小半径时直接卷积，兼顾质量与速度。
 */
export function gaussianBlur(
  data: Float32Array,
  w: number,
  h: number,
  channels: number,
  radius: number,
  wrap: boolean
): Float32Array {
  const r = Math.max(1, Math.round(radius));
  // 小核直接卷积
  if (r <= 7) {
    const kernel = gauss1d(r, Math.max(r / 2, 0.5));
    const tmp = new Float32Array(data.length);
    const out = new Float32Array(data.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < channels; c++) {
          let acc = 0;
          for (let k = -r; k <= r; k++) {
            let sx = x + k;
            if (wrap) sx = (sx + w) % w;
            else sx = clamp(sx, 0, w - 1);
            acc += data[(y * w + sx) * channels + c] * kernel[k + r];
          }
          tmp[(y * w + x) * channels + c] = acc;
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < channels; c++) {
          let acc = 0;
          for (let k = -r; k <= r; k++) {
            let sy = y + k;
            if (wrap) sy = (sy + h) % h;
            else sy = clamp(sy, 0, h - 1);
            acc += tmp[(sy * w + x) * channels + c] * kernel[k + r];
          }
          out[(y * w + x) * channels + c] = acc;
        }
      }
    }
    return out;
  }

  // 大核：3 次盒式模糊逼近高斯（方差等效半径 r/√3）
  let cur = data;
  const boxR = Math.max(1, Math.round(r / 1.732));
  for (let pass = 0; pass < 3; pass++) {
    cur = boxBlur(cur, w, h, channels, boxR, wrap);
  }
  return cur;
}

/** 积分图盒式模糊，O(像素)，半径无关 */
function boxBlur(
  data: Float32Array,
  w: number,
  h: number,
  channels: number,
  r: number,
  wrap: boolean
): Float32Array {
  const out = new Float32Array(data.length);
  const sat = new Float64Array((w + 1) * (h + 1) * channels);

  // 构建积分图（每通道一张）
  const satIdx = (x: number, y: number, c: number) => ((y * (w + 1) + x) * channels + c);
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      const di = ((y - 1) * w + (x - 1)) * channels;
      for (let c = 0; c < channels; c++) {
        sat[satIdx(x, y, c)] =
          data[di + c] +
          sat[satIdx(x - 1, y, c)] +
          sat[satIdx(x, y - 1, c)] -
          sat[satIdx(x - 1, y - 1, c)];
      }
    }
  }

  const rectSum = (x0: number, y0: number, x1: number, y1: number, c: number): number => {
    // 环形边界：把越界矩形按回绕拆成至多 4 块
    if (wrap) {
      let sum = 0;
      const xs = splitRange(x0, x1, w);
      const ys = splitRange(y0, y1, h);
      for (const [a, b] of xs) {
        for (const [c0, c1] of ys) {
          sum +=
            sat[satIdx(b, c1, c)] -
            sat[satIdx(a, c1, c)] -
            sat[satIdx(b, c0, c)] +
            sat[satIdx(a, c0, c)];
        }
      }
      return sum;
    }
    const cx0 = clamp(x0, 0, w);
    const cy0 = clamp(y0, 0, h);
    const cx1 = clamp(x1, 0, w);
    const cy1 = clamp(y1, 0, h);
    return (
      sat[satIdx(cx1, cy1, c)] -
      sat[satIdx(cx0, cy1, c)] -
      sat[satIdx(cx1, cy0, c)] +
      sat[satIdx(cx0, cy0, c)]
    );
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = x - r;
      const x1 = x + r + 1;
      const y0 = y - r;
      const y1 = y + r + 1;
      // 矩形面积（环形时恒定）
      const count = wrap
        ? (x1 - x0) * (y1 - y0)
        : (Math.min(w, x1) - Math.max(0, x0)) * (Math.min(h, y1) - Math.max(0, y0));
      for (let c = 0; c < channels; c++) {
        out[(y * w + x) * channels + c] = count > 0 ? rectSum(x0, y0, x1, y1, c) / count : 0;
      }
    }
  }
  return out;
}

/** 把可能越界 [0,len) 的区间拆成回绕后的若干合法 [a,b) 段 */
function splitRange(from: number, to: number, len: number): [number, number][] {
  const segs: [number, number][] = [];
  let cur = from;
  while (cur < to) {
    const wrapped = ((cur % len) + len) % len;
    const take = Math.min(to - cur, len - wrapped);
    segs.push([wrapped, wrapped + take]);
    cur += take;
  }
  return segs;
}

/** Uint8 RGBA -> Float32 RGB（0..1） */
export function u8ToRGB(src: Uint8ClampedArray | Uint8Array): Float32Array {
  const n = src.length / 4;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = src[i * 4] / 255;
    out[i * 3 + 1] = src[i * 4 + 1] / 255;
    out[i * 3 + 2] = src[i * 4 + 2] / 255;
  }
  return out;
}

/** Float32 RGB -> Uint8 RGBA */
export function rgbToU8(src: Float32Array, alpha = 255): Uint8ClampedArray {
  const n = src.length / 3;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = clamp255(src[i * 3] * 255);
    out[i * 4 + 1] = clamp255(src[i * 3 + 1] * 255);
    out[i * 4 + 2] = clamp255(src[i * 3 + 2] * 255);
    out[i * 4 + 3] = alpha;
  }
  return out;
}

/** 灰度亮度（Rec.709），输入 0..255 RGBA */
export function luminanceAt(d: Uint8ClampedArray, i: number): number {
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
}

/** sRGB 线性化（单通道 0..1） */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 线性 -> sRGB */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** RGB(0..1, sRGB) -> Lab（D65） */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let R = srgbToLinear(r);
  let G = srgbToLinear(g);
  let B = srgbToLinear(b);
  // linear RGB -> XYZ (D65)
  let x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  let y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  let z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab -> RGB(0..1, sRGB) */
export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const finv = (t: number) => (t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787);
  const x = finv(fx) * 0.95047;
  const y = finv(fy);
  const z = finv(fz) * 1.08883;
  let R = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let G = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  let B = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  return [linearToSrgb(R), linearToSrgb(G), linearToSrgb(B)];
}

/** RGB(0..1) -> HSL（H 度, S/L 0..1） */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

/** 求数组均值与样本标准差（n-1） */
export function meanStd(arr: Float64Array | number[]): { mean: number; std: number } {
  let sum = 0;
  const n = arr.length;
  for (let i = 0; i < n; i++) sum += arr[i];
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = arr[i] - mean;
    varSum += d * d;
  }
  return { mean, std: Math.sqrt(varSum / Math.max(n - 1, 1)) };
}

/** 正则化下溢 p 值 */
export function regCDF(t: number): number {
  // 不完全 beta 函数（连分式），用于 Student-t CDF
  const x = (t + 1) / 2;
  const a = (t + 1) / 2;
  const b = (t + 1) / 2;
  const bt =
    x === 0 || x === 1
      ? 0
      : Math.exp(
          lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
        );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function lnGamma(z: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5
  ];
  let x = z;
  let y = z;
  let tmp = z + 5.5;
  tmp -= (z + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 100;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) <FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** 二维正态 CDF（这里只需要 Student-t 双尾 p） */
export function studentTPValue(t: number, dof: number): number {
  const x = dof / (dof + t * t);
  // I_x(dof/2, 1/2)
  const a = dof / 2;
  const b = 0.5;
  const bt = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  const ib = x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
  return clamp(ib, 0, 1);
}

/** Student-t 单侧上尾 p：P(T_dof ≥ t)，t<0 时返回 >0.5 */
export function studentTUpperTail(t: number, dof: number): number {
  if (t <= 0) return 1 - studentTUpperTail(-t, dof);
  return studentTPValue(t, dof) / 2;
}
