import type { PBRParams } from '../types';
import { ImageBuffer } from './image';
import { clamp, gaussianBlur, luminanceAt, rgbToU8, u8ToRGB } from './math';

export interface PBRMaps {
  normal: ImageBuffer;
  roughness: ImageBuffer;
  specular: ImageBuffer;
  height: ImageBuffer;
}

/**
 * 由颜色图推导 PBR 贴图。所有梯度/滤波均采用环形（toroidal）边界，
 * 因此输出在四边与颜色图一样可四方连续。
 */
export function bakePBR(color: ImageBuffer, params: PBRParams): PBRMaps {
  const { width: w, height: h } = color;
  const d = color.data;

  // —— 1. 高度图：亮度 + 轻度环形高斯去噪 ——
  let height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) height[i] = luminanceAt(d, i * 4) / 255;
  const h3 = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    h3[i * 3] = height[i];
    h3[i * 3 + 1] = height[i];
    h3[i * 3 + 2] = height[i];
  }
  const blurred = gaussianBlur(h3, w, h, 3, 1, true);
  for (let i = 0; i < w * h; i++) height[i] = blurred[i * 3];

  // —— 2. 法线图：环形 Sobel 梯度 ——
  const normal = ImageBuffer.create(w, h);
  const strength = params.normalStrength * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w;
      const xr = (x + 1) % w;
      const yu = (y - 1 + h) % h;
      const yd = (y + 1) % h;
      const hL = height[y * w + xl];
      const hR = height[y * w + xr];
      const hU = height[yu * w + x];
      const hD = height[yd * w + x];
      const hUL = height[yu * w + xl];
      const hUR = height[yu * w + xr];
      const hDL = height[yd * w + xl];
      const hDR = height[yd * w + xr];
      const gx = hDL + 2 * hL + hUL - (hDR + 2 * hR + hUR);
      const gy = hUL + 2 * hU + hUR - (hDL + 2 * hD + hDR);
      let nx = -gx * strength;
      let ny = -gy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * w + x) * 4;
      normal.data[o] = clamp((nx * 0.5 + 0.5) * 255, 0, 255);
      normal.data[o + 1] = clamp((ny * 0.5 + 0.5) * 255, 0, 255);
      normal.data[o + 2] = clamp((nz * 0.5 + 0.5) * 255, 0, 255);
      normal.data[o + 3] = 255;
    }
  }

  // —— 3. 粗糙度：亮度越低/釉面越厚越光滑，加环形模糊去噪 ——
  const roughF = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const lum = luminanceAt(d, i * 4) / 255;
    // 基准 + 亮度对比项；clearcoat 整体压低粗糙度
    let r = params.roughnessBase + (lum - 0.5) * params.roughnessContrast;
    r *= 1 - params.clearcoat * 0.45;
    r = clamp(r, 0.03, 1);
    roughF[i * 3] = r;
    roughF[i * 3 + 1] = r;
    roughF[i * 3 + 2] = r;
  }
  const roughBlur = gaussianBlur(roughF, w, h, 3, 2, true);
  const roughness = new ImageBuffer(w, h, rgbToU8(roughBlur));

  // —— 4. 高光贴图：釉面强度 + 亮度信息（灰度） ——
  const specF = new Float32Array(w * h * 3);
  const specLow = gaussianBlur(u8ToRGB(d), w, h, 3, 3, true);
  for (let i = 0; i < w * h; i++) {
    const lum = specLow[i * 3] * 0.2126 + specLow[i * 3 + 1] * 0.7152 + specLow[i * 3 + 2] * 0.0722;
    const s = clamp(params.specularLevel * (0.55 + 0.45 * lum) + params.clearcoat * 0.35, 0, 1);
    specF[i * 3] = s;
    specF[i * 3 + 1] = s;
    specF[i * 3 + 2] = s;
  }
  const specular = new ImageBuffer(w, h, rgbToU8(specF));

  const heightOut = ImageBuffer.create(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = clamp(height[i] * 255, 0, 255);
    heightOut.data[i * 4] = v;
    heightOut.data[i * 4 + 1] = v;
    heightOut.data[i * 4 + 2] = v;
    heightOut.data[i * 4 + 3] = 255;
  }

  return { normal, roughness, specular, height: heightOut };
}
