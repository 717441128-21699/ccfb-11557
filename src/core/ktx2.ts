import { KTX2Container, write } from 'ktx-parse';
import type { KTX2BasicFormatSample } from 'ktx-parse';
import { ImageBuffer } from './image';

// ktx-parse 常量（按 KTX2 规范固定值）
const VK_FORMAT_R8G8B8A8_UNORM = 37;
const KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT = 0;
const KHR_DF_MODEL_RGBSDA = 1;
const KHR_DF_PRIMARIES_BT709 = 1;
const KHR_DF_TRANSFER_SRGB = 2;
const KHR_DF_TRANSFER_LINEAR = 1;

export interface KTX2Options {
  /** 法线/粗糙度等线性数据应使用线性传输函数 */
  linear?: boolean;
  /** 是否生成完整 mipmap 链 */
  mipmaps?: boolean;
}

/**
 * 将 RGBA 贴图编码为 KTX2（未压缩 VK_FORMAT_R8G8B8A8_UNORM，带 mipmap 链）。
 * 未压缩 KTX2 可被 three.js 等直接加载；如需 Basis/UASTC GPU 压缩，
 * 可用 toktx / basisu 等工具在此文件基础上再压缩。
 */
export function encodeKTX2(src: ImageBuffer, options: KTX2Options = {}): Uint8Array {
  const { linear = false, mipmaps = true } = options;

  const container = new KTX2Container();
  container.vkFormat = VK_FORMAT_R8G8B8A8_UNORM;
  container.typeSize = 1;
  container.pixelWidth = src.width;
  container.pixelHeight = src.height;
  container.pixelDepth = 0;
  container.layerCount = 0;
  container.faceCount = 1;
  container.supercompressionScheme = 0;

  // 数据格式描述符（DFD），4 个 8bit 通道 RGBA
  const channels: KTX2BasicFormatSample[] = [
    { bitOffset: 0, bitLength: 8, channelType: 0, samplePosition: [0, 0, 0], sampleLower: 0, sampleUpper: 255 },
    { bitOffset: 8, bitLength: 8, channelType: 1, samplePosition: [0, 0, 0], sampleLower: 0, sampleUpper: 255 },
    { bitOffset: 16, bitLength: 8, channelType: 2, samplePosition: [0, 0, 0], sampleLower: 0, sampleUpper: 255 },
    { bitOffset: 24, bitLength: 8, channelType: 15, samplePosition: [0, 0, 0], sampleLower: 0, sampleUpper: 255 }
  ];
  container.dataFormatDescriptor = [
    {
      vendorId: 0,
      descriptorType: KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT,
      versionNumber: 2,
      descriptorBlockSize: 0,
      colorModel: KHR_DF_MODEL_RGBSDA,
      colorPrimaries: KHR_DF_PRIMARIES_BT709,
      transferFunction: linear ? KHR_DF_TRANSFER_LINEAR : KHR_DF_TRANSFER_SRGB,
      flags: 0,
      texelBlockDimension: [0, 0, 0, 0],
      bytesPlane: [4, 0, 0, 0, 0, 0, 0, 0],
      samples: channels
    }
  ];
  container.keyValue = {
    KTXwriter: 'TileTextureStudio/1.0'
  };
  container.globalData = null;

  container.levels = [];
  let level: ImageBuffer | null = src;
  let w = src.width;
  let h = src.height;
  while (true) {
    container.levels.push({
      levelData: new Uint8Array(level.data.buffer.slice(level.data.byteOffset, level.data.byteOffset + level.data.byteLength)),
      uncompressedByteLength: level.data.byteLength
    });
    if (!mipmaps || (w === 1 && h === 1)) break;
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
    level = downsample(level!, w, h);
  }

  return write(container);
}

/** 2x2 box 下采样（用于 mipmap） */
function downsample(src: ImageBuffer, w: number, h: number): ImageBuffer {
  const out = ImageBuffer.create(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x * 2;
      const sy = y * 2;
      const sx1 = Math.min(sx + 1, src.width - 1);
      const sy1 = Math.min(sy + 1, src.height - 1);
      const i00 = (sy * src.width + sx) * 4;
      const i01 = (sy * src.width + sx1) * 4;
      const i10 = (sy1 * src.width + sx) * 4;
      const i11 = (sy1 * src.width + sx1) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        out.data[o + c] = (src.data[i00 + c] + src.data[i01 + c] + src.data[i10 + c] + src.data[i11 + c]) / 4;
      }
    }
  }
  return out;
}

export function ktx2Blob(bytes: Uint8Array): Blob {
  // 复制一份确保底层是精确大小的 ArrayBuffer（而非 SharedArrayBuffer/大缓冲视图）
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'image/ktx2' });
}
