import type { Preset } from '../types';

const KEY = 'tile-texture-studio:presets:v1';

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Preset[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function savePresets(presets: Preset[]): void {
  localStorage.setItem(KEY, JSON.stringify(presets));
}

export function upsertPreset(preset: Preset): Preset[] {
  const all = loadPresets();
  const i = all.findIndex((p) => p.id === preset.id);
  if (i >= 0) all[i] = preset;
  else all.unshift(preset);
  savePresets(all);
  return all;
}

export function deletePreset(id: string): Preset[] {
  const all = loadPresets().filter((p) => p.id !== id);
  savePresets(all);
  return all;
}

export function newPresetId(): string {
  return 'preset_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
}
