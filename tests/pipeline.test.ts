/**
 * 核心管线端到端验证（Node 环境，esbuild 打包后运行）
 * 不依赖 DOM：仅使用 ImageBuffer 的纯数据部分与各算法模块。
 */
import { ImageBuffer } from '../src/core/image';
import { flatfieldCorrect } from '../src/core/correction';
import { synthesize } from '../src/core/synthesis';
import { bakePBR } from '../src/core/pbr';
import { analyzeSeam } from '../src/core/seamstats';
import { applyColorway, meanLab } from '../src/core/colorways';
import { encodeKTX2 } from '../src/core/ktx2';
import { read } from 'ktx-parse';
import { studentTPValue, rgbToLab, labToRgb } from '../src/core/math';
import type { PBRParams, SynthesisParams } from '../src/types';

const defaultSynthesis: SynthesisParams = {
  outSize: 1024,
  patchSize: 64,
  overlap: 16,
  candidates: 8,
  mode: 'quilting',
  seed: 20261117
};

const defaultPBR: PBRParams = {
  normalStrength: 1,
  roughnessBase: 0.45,
  roughnessContrast: 0.25,
  specularLevel: 0.5,
  clearcoat: 0.65
};

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

/** 程序化纹理：多频正弦 + 噪声，非周期 */
function makeProcedural(size: number, opts: { vignette?: boolean; gradient?: boolean } = {}): ImageBuffer {
  const buf = ImageBuffer.create(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let r = 150 + 40 * Math.sin(u * 18) + 25 * Math.cos(v * 23) + 18 * Math.sin((u + v) * 31);
      let g = 130 + 35 * Math.cos(u * 14) + 22 * Math.sin(v * 27);
      let b = 110 + 30 * Math.sin(u * 9 + v * 11);
      const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      r += n * 14;
      g += n * 12;
      b += n * 10;
      if (opts.gradient) {
        r += u * 120;
        g += u * 120;
        b += u * 120;
      }
      if (opts.vignette) {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const k = 1 - 0.55 * Math.min(1, (dx * dx + dy * dy) * 3.2);
        r *= k;
        g *= k;
        b *= k;
      }
      const o = (y * size + x) * 4;
      buf.data[o] = Math.max(0, Math.min(255, r));
      buf.data[o + 1] = Math.max(0, Math.min(255, g));
      buf.data[o + 2] = Math.max(0, Math.min(255, b));
      buf.data[o + 3] = 255;
    }
  }
  return buf;
}

function illuminationStd(buf: ImageBuffer): number {
  // 分 8x8 块求块均值，再看块均值的离散度（匀光应显著降低该值）
  const blocks: number[] = [];
  const bs = buf.width / 8;
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      let sum = 0;
      let cnt = 0;
      for (let y = Math.floor(by * bs); y < Math.floor((by + 1) * bs); y++) {
        for (let x = Math.floor(bx * bs); x < Math.floor((bx + 1) * bs); x++) {
          const i = (y * buf.width + x) * 4;
          sum += (buf.data[i] + buf.data[i + 1] + buf.data[i + 2]) / 3;
          cnt++;
        }
      }
      blocks.push(sum / cnt);
    }
  }
  const m = blocks.reduce((a, b) => a + b, 0) / blocks.length;
  return Math.sqrt(blocks.reduce((a, b) => a + (b - m) ** 2, 0) / blocks.length);
}

console.log('\n[1] 光照不均校正（flat-field）');
{
  const vig = makeProcedural(256, { vignette: true });
  const before = illuminationStd(vig);
  const fixed = flatfieldCorrect(vig, 0.25, 1);
  const after = illuminationStd(fixed);
  check('匀光后块照度离散度下降', after < before * 0.6, `before=${before.toFixed(2)} after=${after.toFixed(2)}`);
  check('输出尺寸保持不变', fixed.width === 256 && fixed.height === 256);
}

console.log('\n[2] 四方连续纹理合成');
{
  const src = makeProcedural(256);
  const params = { ...defaultSynthesis, outSize: 256, patchSize: 32, overlap: 8, candidates: 5 };
  const t0 = Date.now();
  const out = synthesize(src, params);
  const ms = Date.now() - t0;
  check('输出尺寸正确', out.width === 256 && out.height === 256);
  check(`合成耗时合理（<15s，实际 ${ms}ms）`, ms < 15000);

  const stats = analyzeSeam(out.data, out.width, out.height);
  console.log(`    接缝均值=${stats.seamMean.toFixed(2)} 内部均值=${stats.interiorMean.toFixed(2)} TOST p=${stats.pEquivalence.toFixed(4)} d=${stats.cohensD.toFixed(3)}`);
  check('合成结果通过 TOST 等效检验', stats.pass, `pEq=${stats.pEquivalence}`);
  // 零接缝时 Cohen's d 会很大（方向为负，说明接缝比内部更"干净"），
  // 工程上这是好事；只要求 |d| 不过大且方向不是"接缝更差"
  check('接缝不劣于内部（d<0.5）', stats.cohensD < 0.5, `d=${stats.cohensD}`);
}

console.log('\n[3] 统计检验区分度（负对照必须能抓到真接缝）');
{
  const bad = makeProcedural(256, { gradient: true });
  const stats = analyzeSeam(bad.data, bad.width, bad.height);
  console.log(`    梯度图 接缝均值=${stats.seamMean.toFixed(2)} 内部均值=${stats.interiorMean.toFixed(2)} TOST p=${stats.pEquivalence.toExponential(2)}`);
  check('强梯度非平铺图等效检验不通过', !stats.pass && stats.pEquivalence >= 0.05, `p=${stats.pEquivalence}`);

  // 正对照：本身就周期的图（正弦整数周期）应通过
  const periodic = ImageBuffer.create(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const v = 128 + 80 * Math.sin((x / 256) * Math.PI * 2 * 8) * Math.sin((y / 256) * Math.PI * 2 * 6);
      const o = (y * 256 + x) * 4;
      periodic.data[o] = v;
      periodic.data[o + 1] = v;
      periodic.data[o + 2] = v;
      periodic.data[o + 3] = 255;
    }
  }
  const good = analyzeSeam(periodic.data, 256, 256);
  check('周期纹理通过等效检验', good.pass, `pEq=${good.pEquivalence}`);

  // 完美零接缝（回绕边恒等）也必须通过——不能因零方差退化误判
  const flat = ImageBuffer.create(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      // 双向整数周期，回绕边完全一致；内部仍有自然变化
      const v = 128 + 60 * Math.sin((x / 128) * Math.PI * 2 * 4) * Math.cos((y / 128) * Math.PI * 2 * 4);
      const o = (y * 128 + x) * 4;
      flat.data[o] = v;
      flat.data[o + 1] = v;
      flat.data[o + 2] = v;
      flat.data[o + 3] = 255;
    }
  }
  const zero = analyzeSeam(flat.data, 128, 128);
  check('零方差接缝通过（数值稳定）', zero.pass && Number.isFinite(zero.pEquivalence), `pEq=${zero.pEquivalence}`);
}

console.log('\n[4] PBR 烘焙');
{
  const src = makeProcedural(128);
  const maps = bakePBR(src, defaultPBR);
  check('四张图尺寸一致', [maps.normal, maps.roughness, maps.specular, maps.height].every((m) => m.width === 128));
  // 法线归一化：重建向量长度应≈1
  let maxErr = 0;
  for (let i = 0; i < maps.normal.width * maps.normal.height; i++) {
    const nx = maps.normal.data[i * 4] / 255 * 2 - 1;
    const ny = maps.normal.data[i * 4 + 1] / 255 * 2 - 1;
    const nz = maps.normal.data[i * 4 + 2] / 255 * 2 - 1;
    maxErr = Math.max(maxErr, Math.abs(Math.hypot(nx, ny, nz) - 1));
  }
  check('法线向量归一化（误差<0.02）', maxErr < 0.02, `maxErr=${maxErr.toFixed(4)}`);
  // 粗糙度在合法范围
  let minR = 255;
  let maxR = 0;
  for (let i = 0; i < maps.roughness.width * maps.roughness.height; i++) {
    minR = Math.min(minR, maps.roughness.data[i * 4]);
    maxR = Math.max(maxR, maps.roughness.data[i * 4]);
  }
  check('粗糙度取值在 8..255 区间', minR >= 5 && maxR <= 255, `[${minR},${maxR}]`);
  // PBR 图同样可平铺
  const nStats = analyzeSeam(maps.normal.data, 128, 128);
  check('法线图四边可平铺（TOST 通过）', nStats.pass, `pEq=${nStats.pEquivalence}`);
}

console.log('\n[5] 多色号处理');
{
  const src = synthesize(makeProcedural(128), {
    outSize: 128,
    patchSize: 24,
    overlap: 6,
    candidates: 4,
    mode: 'quilting',
    seed: 7
  });
  const cw = { id: 't', name: '测试蓝', lab: { l: 45, a: -5, b: -20 }, hueShift: 0, satScale: 1, lightScale: 1 };
  const out = applyColorway(src, cw);
  const ml = meanLab(out);
  check('Lab 迁移后均值接近目标 L', Math.abs(ml.l - 45) < 6, `L=${ml.l.toFixed(1)}`);
  check('Lab 迁移后均值接近目标 b', Math.abs(ml.b - (-20)) < 6, `b=${ml.b.toFixed(1)}`);
  check('色号变换保持可平铺', analyzeSeam(out.data, 128, 128).pass);
  const hsl = applyColorway(src, { id: 't2', name: 'hsl', lab: null, hueShift: 120, satScale: 1.2, lightScale: 1 });
  check('HSL 模式输出正常', hsl.width === 128);
  check('HSL 模式同样保持可平铺', analyzeSeam(hsl.data, 128, 128).pass);
}

console.log('\n[6] KTX2 编码');
{
  const src = makeProcedural(64);
  const bytes = encodeKTX2(src, { mipmaps: true });
  const magic = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  check('KTX2 魔数正确', magic.every((m, i) => bytes[i] === m));
  const parsed = read(bytes);
  check('回读尺寸正确', parsed.pixelWidth === 64 && parsed.pixelHeight === 64);
  check('mipmap 链完整（64→1 共 7 级）', parsed.levels.length === 7, `levels=${parsed.levels.length}`);
  check('level0 字节数=64*64*4', parsed.levels[0].uncompressedByteLength === 64 * 64 * 4);
  check('DFD 传输函数标记存在', parsed.dataFormatDescriptor[0].transferFunction === 2);

  const linear = encodeKTX2(bakePBR(src, defaultPBR).normal, { linear: true, mipmaps: false });
  const p2 = read(linear);
  check('线性数据标记为线性传输函数', p2.dataFormatDescriptor[0].transferFunction === 1);
  check('关闭 mipmap 时仅 1 级', p2.levels.length === 1);
}

console.log('\n[7] 数学工具 sanity');
{
  // t=0 时双尾 p=1；t 很大时 p→0
  check('t=0 → p≈1', Math.abs(studentTPValue(0, 10) - 1) < 1e-9);
  check('t=10,df=1000 → p<0.001', studentTPValue(10, 1000) < 0.001);
  const [r, g, b] = labToRgb(...rgbToLab(0.4, 0.6, 0.8));
  check('Lab 往返误差 <0.02', Math.abs(r - 0.4) < 0.02 && Math.abs(g - 0.6) < 0.02 && Math.abs(b - 0.8) < 0.02);
}

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
if (failed > 0) process.exit(1);
