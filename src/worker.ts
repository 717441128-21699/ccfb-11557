/// <reference lib="webworker" />
import { ImageBuffer } from './core/image';
import { runCorrection } from './core/correction';
import { synthesize } from './core/synthesis';
import { bakePBR } from './core/pbr';
import { analyzeSeam } from './core/seamstats';
import { applyColorway } from './core/colorways';
import type {
  Colorway,
  CorrectionParams,
  PBRParams,
  ProgressMsg,
  SeamStats,
  SynthesisParams
} from './types';

interface CorrectReq {
  kind: 'correct';
  id: number;
  buf: ImageBuffer;
  params: CorrectionParams;
  outSize: number;
}
interface SynthesizeReq {
  kind: 'synthesize';
  id: number;
  source: ImageBuffer;
  pbr: PBRParams;
  params: SynthesisParams;
}
interface RebakeReq {
  kind: 'rebake';
  id: number;
  color: ImageBuffer;
  pbr: PBRParams;
}
interface BatchReq {
  kind: 'batch';
  id: number;
  color: ImageBuffer;
  pbr: PBRParams;
  colorways: Colorway[];
}

export type WorkerRequest = CorrectReq | SynthesizeReq | RebakeReq | BatchReq;

export type WorkerResponse =
  | { id: number; kind: 'correct'; corrected: ImageBuffer }
  | {
      id: number;
      kind: 'synthesize';
      color: ImageBuffer;
      normal: ImageBuffer;
      roughness: ImageBuffer;
      specular: ImageBuffer;
      height: ImageBuffer;
      stats: SeamStats;
    }
  | {
      id: number;
      kind: 'rebake';
      normal: ImageBuffer;
      roughness: ImageBuffer;
      specular: ImageBuffer;
      height: ImageBuffer;
    }
  | {
      id: number;
      kind: 'batch';
      items: Array<{
        colorway: Colorway;
        color: ImageBuffer;
        normal: ImageBuffer;
        roughness: ImageBuffer;
        specular: ImageBuffer;
        stats: SeamStats;
      }>;
    }
  | { id: number; kind: 'error'; message: string }
  | ({ id: number; kind: 'progress' } & ProgressMsg);

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  try {
    ctx.postMessage(msg, transfer);
  } catch (e) {
    ctx.postMessage({ id: msg.id, kind: 'error', message: 'postMessage 失败: ' + (e as Error).message });
  }
}

function transfers(...bufs: ImageBuffer[]): Transferable[] {
  return bufs.map((b) => b.data.buffer);
}

/** 入站 ImageBuffer 只是结构化克隆出来的普通对象，重新挂回类方法容器 */
function asBuffer(raw: ImageBuffer): ImageBuffer {
  return new ImageBuffer(raw.width, raw.height, new Uint8ClampedArray(raw.data));
}

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.kind === 'correct') {
      const src = asBuffer(req.buf);
      const corrected = runCorrection(src, req.params, req.outSize, (ratio) =>
        post({ id: req.id, kind: 'progress', phase: '透视/光照校正', ratio })
      );
      post({ id: req.id, kind: 'correct', corrected }, transfers(corrected));
      return;
    }

    if (req.kind === 'synthesize') {
      const source = asBuffer(req.source);
      const color = synthesize(source, req.params, (p) =>
        post({ id: req.id, kind: 'progress', ...p })
      );
      post({ id: req.id, kind: 'progress', phase: '烘焙 PBR 贴图', ratio: 0.98 });
      const maps = bakePBR(color, req.pbr);
      const stats = analyzeSeam(color.data, color.width, color.height);
      post(
        {
          id: req.id,
          kind: 'synthesize',
          color,
          normal: maps.normal,
          roughness: maps.roughness,
          specular: maps.specular,
          height: maps.height,
          stats
        },
        transfers(color, maps.normal, maps.roughness, maps.specular, maps.height)
      );
      return;
    }

    if (req.kind === 'rebake') {
      const color = asBuffer(req.color);
      const maps = bakePBR(color, req.pbr);
      post(
        {
          id: req.id,
          kind: 'rebake',
          normal: maps.normal,
          roughness: maps.roughness,
          specular: maps.specular,
          height: maps.height
        },
        transfers(maps.normal, maps.roughness, maps.specular, maps.height)
      );
      return;
    }

    if (req.kind === 'batch') {
      const base = asBuffer(req.color);
      const items = [];
      for (let i = 0; i < req.colorways.length; i++) {
        const cw = req.colorways[i];
        post({
          id: req.id,
          kind: 'progress',
          phase: `批量处理色号 ${i + 1}/${req.colorways.length}：${cw.name}`,
          ratio: i / req.colorways.length
        });
        const color = applyColorway(base, cw);
        const maps = bakePBR(color, req.pbr);
        const stats = analyzeSeam(color.data, color.width, color.height);
        items.push({
          colorway: cw,
          color,
          normal: maps.normal,
          roughness: maps.roughness,
          specular: maps.specular,
          stats
        });
      }
      post(
        { id: req.id, kind: 'batch', items },
        items.flatMap((it) => transfers(it.color, it.normal, it.roughness, it.specular))
      );
      return;
    }
  } catch (err) {
    post({ id: req.id, kind: 'error', message: (err as Error).message });
  }
};
