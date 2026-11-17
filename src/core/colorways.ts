import type { Colorway } from '../types';
import { ImageBuffer } from './image';
import { clamp, hslToRgb, labToRgb, rgbToHsl, rgbToLab } from './math';

/**
 * 同款多色号处理：在 Lab 空间做整体目标色迁移（保留纹理明暗结构），
 * 或在 HSL 空间做色相/饱和/明度调整。
 */
export function applyColorway(src: ImageBuffer, cw: Colorway): ImageBuffer {
  const out = ImageBuffer.create(src.width, src.height);
  const d = src.data;
  const o = out.data;

  let dL = 0;
  let da = 0;
  let db = 0;

  if (cw.lab) {
    // 计算原图平均 Lab
    let sumL = 0;
    let sumA = 0;
    let sumB = 0;
    const n = src.width * src.height;
    // 抽样加速
    const step = Math.max(1, Math.floor(n / 20000));
    let cnt = 0;
    for (let i = 0; i < n; i += step) {
      const [L, a, b] = rgbToLab(d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255);
      sumL += L;
      sumA += a;
      sumB += b;
      cnt++;
    }
    dL = cw.lab.l - sumL / cnt;
    da = cw.lab.a - sumA / cnt;
    db = cw.lab.b - sumB / cnt;
  }

  for (let i = 0; i < src.width * src.height; i++) {
    const r = d[i * 4] / 255;
    const g = d[i * 4 + 1] / 255;
    const b = d[i * 4 + 2] / 255;
    let nr = r;
    let ng = g;
    let nb = b;

    if (cw.lab) {
      const [L, a, bb] = rgbToLab(r, g, b);
      [nr, ng, nb] = labToRgb(clamp(L + dL, 0, 100), a + da, bb + db);
    } else {
      const [h, s, l] = rgbToHsl(r, g, b);
      [nr, ng, nb] = hslToRgb(
        h + cw.hueShift,
        clamp(s * cw.satScale, 0, 1),
        clamp(l * cw.lightScale, 0, 1)
      );
    }

    o[i * 4] = clamp(nr * 255, 0, 255);
    o[i * 4 + 1] = clamp(ng * 255, 0, 255);
    o[i * 4 + 2] = clamp(nb * 255, 0, 255);
    o[i * 4 + 3] = 255;
  }
  return out;
}

/** 从图像取平均 Lab（供色号取色按钮使用） */
export function meanLab(src: ImageBuffer): { l: number; a: number; b: number } {
  const d = src.data;
  const n = src.width * src.height;
  const step = Math.max(1, Math.floor(n / 20000));
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let cnt = 0;
  for (let i = 0; i < n; i += step) {
    const [L, a, b] = rgbToLab(d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255);
    sumL += L;
    sumA += a;
    sumB += b;
    cnt++;
  }
  return { l: sumL / cnt, a: sumA / cnt, b: sumB / cnt };
}
