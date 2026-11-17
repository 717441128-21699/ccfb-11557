/** 生成一张带渐变+纹理的测试照片 PNG（无第三方依赖，仅用 zlib） */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function makePNG(width, height, painter) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = painter(x, y, width, height);
      raw[o++] = Math.max(0, Math.min(255, r | 0));
      raw[o++] = Math.max(0, Math.min(255, g | 0));
      raw[o++] = Math.max(0, Math.min(255, b | 0));
      raw[o++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const out = process.argv[2] || 'tests/.build/sample.png';
  mkdirSync(dirname(out), { recursive: true });
  const png = makePNG(480, 360, (x, y, w, h) => {
    const u = x / w;
    const v = y / h;
    // 模拟釉面：多频纹理 + 左亮右暗的光照不均
    const light = 1.25 - 0.5 * u;
    const r = (150 + 40 * Math.sin(u * 20) + 22 * Math.cos(v * 26) + 16 * Math.sin((u + v) * 33)) * light;
    const g = (132 + 34 * Math.cos(u * 15) + 20 * Math.sin(v * 29)) * light;
    const b = (112 + 28 * Math.sin(u * 10 + v * 12)) * light;
    return [r, g, b];
  });
  writeFileSync(out, png);
  console.log('written', out, png.length, 'bytes');
}
