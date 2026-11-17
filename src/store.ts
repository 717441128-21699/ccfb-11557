import type {
  Colorway,
  CorrectionParams,
  PBRParams,
  PageId,
  Preset,
  SeamStats,
  SynthesisParams
} from './types';
import { ImageBuffer } from './core/image';
import { defaultCorners } from './core/correction';
import { loadPresets, upsertPreset, deletePreset, newPresetId } from './core/presets';

export interface ProcessResult {
  color: ImageBuffer;
  normal: ImageBuffer;
  roughness: ImageBuffer;
  specular: ImageBuffer;
  height: ImageBuffer;
  stats: SeamStats;
}

export interface BatchResultItem {
  colorway: Colorway;
  color: ImageBuffer;
  normal: ImageBuffer;
  roughness: ImageBuffer;
  specular: ImageBuffer;
  stats: SeamStats;
}

interface AppState {
  page: PageId;
  sourceName: string;
  source: ImageBuffer | null;
  corrected: ImageBuffer | null;
  tiled: ImageBuffer | null;
  result: ProcessResult | null;
  batch: BatchResultItem[];
  correction: CorrectionParams;
  synthesis: SynthesisParams;
  pbr: PBRParams;
  colorways: Colorway[];
  presets: Preset[];
  busy: boolean;
  busyText: string;
  progress: number;
}

type Listener = (s: AppState) => void;
type ProgressListener = (busy: boolean, text: string, ratio: number) => void;

export const defaultCorrection: CorrectionParams = {
  corners: defaultCorners(),
  flatfield: true,
  flatfieldStrength: 0.8,
  flatfieldRadius: 0.22
};

export const defaultSynthesis: SynthesisParams = {
  outSize: 1024,
  patchSize: 64,
  overlap: 16,
  candidates: 8,
  mode: 'quilting',
  seed: 20261117
};

export const defaultPBR: PBRParams = {
  normalStrength: 1.0,
  roughnessBase: 0.45,
  roughnessContrast: 0.25,
  specularLevel: 0.5,
  clearcoat: 0.65
};

export function defaultColorways(): Colorway[] {
  return [
    { id: 'cw_1', name: '原色', lab: null, hueShift: 0, satScale: 1, lightScale: 1 },
    { id: 'cw_2', name: '暖米白', lab: { l: 82, a: 4, b: 14 }, hueShift: 0, satScale: 1, lightScale: 1 },
    { id: 'cw_3', name: '高级灰', lab: { l: 62, a: 0, b: -2 }, hueShift: 0, satScale: 1, lightScale: 1 },
    { id: 'cw_4', name: '深空蓝', lab: { l: 38, a: -4, b: -18 }, hueShift: 0, satScale: 1, lightScale: 1 }
  ];
}

class Store {
  private state: AppState = {
    page: 'import',
    sourceName: '',
    source: null,
    corrected: null,
    tiled: null,
    result: null,
    batch: [],
    correction: structuredClone(defaultCorrection),
    synthesis: structuredClone(defaultSynthesis),
    pbr: structuredClone(defaultPBR),
    colorways: defaultColorways(),
    presets: loadPresets(),
    busy: false,
    busyText: '',
    progress: 0
  };

  private listeners = new Set<Listener>();
  private progressListeners = new Set<ProgressListener>();

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  subscribeProgress(fn: ProgressListener): () => void {
    this.progressListeners.add(fn);
    return () => this.progressListeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  private emitProgress(): void {
    for (const fn of this.progressListeners)
      fn(this.state.busy, this.state.busyText, this.state.progress);
  }

  update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  setPage(page: PageId): void {
    this.update({ page });
  }

  /** 忙碌状态切换：同步更新 state 并通知进度通道（不重建页面） */
  setBusy(busy: boolean, busyText = '', progress = 0): void {
    this.state = { ...this.state, busy, busyText, progress };
    this.emitProgress();
    // 从忙碌→空闲时，结果通常已通过 update 写入；这里补一次轻量通知刷新页面
    if (!busy) this.emit();
  }

  /** 高频进度：只走进度通道，绝不触发整页重渲染 */
  setProgress(progress: number, busyText?: string): void {
    this.state = {
      ...this.state,
      progress,
      busyText: busyText ?? this.state.busyText
    };
    this.emitProgress();
  }

  // —— 参数局部更新 ——
  patchCorrection(p: Partial<CorrectionParams>): void {
    this.update({ correction: { ...this.state.correction, ...p } });
  }
  patchSynthesis(p: Partial<SynthesisParams>): void {
    this.update({ synthesis: { ...this.state.synthesis, ...p } });
  }
  patchPBR(p: Partial<PBRParams>): void {
    this.update({ pbr: { ...this.state.pbr, ...p } });
  }
  setColorways(list: Colorway[]): void {
    this.update({ colorways: list });
  }

  // —— 预设 ——
  savePreset(name: string): void {
    const s = this.state;
    const preset: Preset = {
      id: newPresetId(),
      name,
      createdAt: Date.now(),
      correction: structuredClone(s.correction),
      synthesis: structuredClone(s.synthesis),
      pbr: structuredClone(s.pbr),
      colorways: structuredClone(s.colorways)
    };
    this.update({ presets: upsertPreset(preset) });
  }

  applyPreset(p: Preset): void {
    this.update({
      correction: structuredClone(p.correction),
      synthesis: structuredClone(p.synthesis),
      pbr: structuredClone(p.pbr),
      colorways: structuredClone(p.colorways)
    });
  }

  removePreset(id: string): void {
    this.update({ presets: deletePreset(id) });
  }

  resetParams(): void {
    this.update({
      correction: structuredClone(defaultCorrection),
      synthesis: structuredClone(defaultSynthesis),
      pbr: structuredClone(defaultPBR),
      colorways: defaultColorways()
    });
  }
}

export const store = new Store();
