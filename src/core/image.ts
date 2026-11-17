import { clamp } from './math';

/** 简单的内存图像容器（RGBA 8bit） */
export class ImageBuffer {
  constructor(
    public width: number,
    public height: number,
    public data: Uint8ClampedArray
  ) {
    if (data.length !== width * height * 4) throw new Error('ImageBuffer 尺寸不匹配');
  }

  static create(w: number, h: number): ImageBuffer {
    return new ImageBuffer(w, h, new Uint8ClampedArray(w * h * 4));
  }

  get size(): number {
    return this.width * this.height;
  }

  clone(): ImageBuffer {
    return new ImageBuffer(this.width, this.height, new Uint8ClampedArray(this.data));
  }

  toImageData(): ImageData {
    return new ImageData(new Uint8ClampedArray(this.data), this.width, this.height);
  }

  static fromImageData(d: ImageData): ImageBuffer {
    return new ImageBuffer(d.width, d.height, new Uint8ClampedArray(d.data));
  }
}

export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败：' + file.name));
    };
    img.src = url;
  });
}

export function imageElementToBuffer(img: HTMLImageElement, maxSide = 2048): ImageBuffer {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ImageBuffer.fromImageData(ctx.getImageData(0, 0, w, h));
}

export function bufferToCanvas(buf: ImageBuffer, canvas: HTMLCanvasElement): void {
  canvas.width = buf.width;
  canvas.height = buf.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.putImageData(buf.toImageData(), 0, 0);
}

export function bufferToDataURL(buf: ImageBuffer, type = 'image/png', quality?: number): string {
  const canvas = document.createElement('canvas');
  bufferToCanvas(buf, canvas);
  return canvas.toDataURL(type, quality);
}

export async function bufferToBlob(buf: ImageBuffer, type = 'image/png'): Promise<Blob> {
  const canvas = document.createElement('canvas');
  bufferToCanvas(buf, canvas);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob 编码失败'))), type)
  );
}

/** 双线性缩放（含可选纵横比裁剪为正方形） */
export function resizeBuffer(src: ImageBuffer, w: number, h: number, cropSquare = false): ImageBuffer {
  let s = src;
  if (cropSquare) {
    const side = Math.min(src.width, src.height);
    const ox = (src.width - side) / 2;
    const oy = (src.height - side) / 2;
    const c = document.createElement('canvas');
    c.width = side;
    c.height = side;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.putImageData(src.toImageData(), -ox, -oy);
    const cropped = ctx.getImageData(0, 0, side, side);
    s = ImageBuffer.fromImageData(cropped);
  }
  const out = ImageBuffer.create(w, h);
  const xRatio = w > 1 ? (s.width - 1) / (w - 1) : 0;
  const yRatio = h > 1 ? (s.height - 1) / (h - 1) : 0;
  for (let y = 0; y < h; y++) {
    const sy = y * yRatio;
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, s.height - 1);
    const fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = x * xRatio;
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, s.width - 1);
      const fx = sx - x0;
      const i00 = (y0 * s.width + x0) * 4;
      const i01 = (y0 * s.width + x1) * 4;
      const i10 = (y1 * s.width + x0) * 4;
      const i11 = (y1 * s.width + x1) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = s.data[i00 + c] * (1 - fx) + s.data[i01 + c] * fx;
        const bot = s.data[i10 + c] * (1 - fx) + s.data[i11 + c] * fx;
        out.data[o + c] = clamp(top * (1 - fy) + bot * fy, 0, 255);
      }
    }
  }
  return out;
}

/** 九宫格拼接（3x3 repeat），用于接缝目检 */
export function makeNineGrid(src: ImageBuffer, cell = 0): ImageBuffer {
  const c = cell || Math.min(256, Math.floor(src.width / 2), Math.floor(src.height / 2));
  const out = ImageBuffer.create(c * 3, c * 3);
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      for (let y = 0; y < c; y++) {
        for (let x = 0; x < c; x++) {
          const sx = Math.floor((x / c) * src.width);
          const sy = Math.floor((y / c) * src.height);
          const si = (sy * src.width + sx) * 4;
          const di = ((gy * c + y) * c * 3 + (gx * c + x)) * 4;
          out.data[di] = src.data[si];
          out.data[di + 1] = src.data[si + 1];
          out.data[di + 2] = src.data[si + 2];
          out.data[di + 3] = 255;
        }
      }
    }
  }
  return out;
}

/** 下载工具 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
