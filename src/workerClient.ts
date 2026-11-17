import { ImageBuffer } from './core/image';
import type {
  Colorway,
  CorrectionParams,
  PBRParams,
  SeamStats,
  SynthesisParams
} from './types';
import type { WorkerResponse } from './worker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (msg: WorkerResponse) => void>();
let progressHandler: ((phase: string, ratio: number) => void) | null = null;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.kind === 'progress') {
        progressHandler?.(msg.phase, msg.ratio);
        return;
      }
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg);
      }
    };
    worker.onerror = (e) =>
      console.error('[workerClient] worker 运行错误', e.message);
  }
  return worker;
}

export function onProgress(cb: (phase: string, ratio: number) => void): void {
  progressHandler = cb;
}

function call(req: Record<string, unknown>): Promise<WorkerResponse> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => {
      if (msg.kind === 'error') reject(new Error(msg.message));
      else resolve(msg);
    });
    // 不传 transfer：输入缓冲主线程仍要保留，结构化克隆一份给 worker
    w.postMessage({ ...req, id });
  });
}

/** 把 worker 回传的普通对象重新包成 ImageBuffer */
function wrap(raw: unknown): ImageBuffer {
  const b = raw as ImageBuffer;
  return new ImageBuffer(b.width, b.height, new Uint8ClampedArray(b.data));
}

export interface SynthesisOutput {
  color: ImageBuffer;
  normal: ImageBuffer;
  roughness: ImageBuffer;
  specular: ImageBuffer;
  height: ImageBuffer;
  stats: SeamStats;
}

export interface BatchOutputItem {
  colorway: Colorway;
  color: ImageBuffer;
  normal: ImageBuffer;
  roughness: ImageBuffer;
  specular: ImageBuffer;
  stats: SeamStats;
}

export async function runCorrect(
  buf: ImageBuffer,
  params: CorrectionParams,
  outSize: number
): Promise<ImageBuffer> {
  const msg = await call({ kind: 'correct', buf, params, outSize });
  if (msg.kind !== 'correct') throw new Error('worker 响应类型错误');
  return wrap(msg.corrected);
}

export async function runSynthesize(
  source: ImageBuffer,
  params: SynthesisParams,
  pbr: PBRParams
): Promise<SynthesisOutput> {
  const msg = await call({ kind: 'synthesize', source, params, pbr });
  if (msg.kind !== 'synthesize') throw new Error('worker 响应类型错误');
  return {
    color: wrap(msg.color),
    normal: wrap(msg.normal),
    roughness: wrap(msg.roughness),
    specular: wrap(msg.specular),
    height: wrap(msg.height),
    stats: msg.stats
  };
}

export async function runRebake(
  color: ImageBuffer,
  pbr: PBRParams
): Promise<{ normal: ImageBuffer; roughness: ImageBuffer; specular: ImageBuffer; height: ImageBuffer }> {
  const msg = await call({ kind: 'rebake', color, pbr });
  if (msg.kind !== 'rebake') throw new Error('worker 响应类型错误');
  return {
    normal: wrap(msg.normal),
    roughness: wrap(msg.roughness),
    specular: wrap(msg.specular),
    height: wrap(msg.height)
  };
}

export async function runBatch(
  color: ImageBuffer,
  pbr: PBRParams,
  colorways: Colorway[]
): Promise<BatchOutputItem[]> {
  const msg = await call({ kind: 'batch', color, pbr, colorways });
  if (msg.kind !== 'batch') throw new Error('worker 响应类型错误');
  return msg.items.map((it) => ({
    colorway: it.colorway,
    color: wrap(it.color),
    normal: wrap(it.normal),
    roughness: wrap(it.roughness),
    specular: wrap(it.specular),
    stats: it.stats
  }));
}
