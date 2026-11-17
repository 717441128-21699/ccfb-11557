import { store } from '../store';
import { h } from '../ui/dom';
import { slider, segmented, toast } from '../ui/widgets';
import { bufferToCanvas } from '../core/image';
import { runRebake } from '../workerClient';
import type { ImageBuffer } from '../core/image';

type MapKey = 'color' | 'normal' | 'roughness' | 'specular' | 'height';

const MAP_LABELS: { key: MapKey; label: string; linear?: boolean }[] = [
  { key: 'color', label: '颜色 Albedo' },
  { key: 'normal', label: '法线 Normal', linear: true },
  { key: 'roughness', label: '粗糙度 Roughness', linear: true },
  { key: 'specular', label: '高光 Specular', linear: true },
  { key: 'height', label: '高度 Height', linear: true }
];

export function renderBakePage(): HTMLElement {
  const s = store.get();
  if (!s.result) {
    return h(
      'div',
      { class: 'panel' },
      h('h2', {}, '③ PBR 贴图烘焙'),
      h('p', { class: 'hint' }, '请先在「去接缝合成」页生成可平铺的颜色贴图。')
    );
  }

  let current: MapKey = 'color';
  const stage = h('div', { class: 'canvas-stage' });

  function showMap(): void {
    const r = store.get().result;
    if (!r) return;
    const buf: ImageBuffer = r[current];
    const c = document.createElement('canvas');
    bufferToCanvas(buf, c);
    stage.replaceChildren(c);
  }

  const tabBar = h('div', { class: 'map-tabs' });
  function buildTabs(): void {
    tabBar.replaceChildren(
      ...MAP_LABELS.map((m) =>
        h(
          'button',
          {
            class: 'map-tab' + (current === m.key ? ' active' : ''),
            onclick: () => {
              current = m.key;
              buildTabs();
              showMap();
            }
          },
          m.label
        )
      )
    );
  }

  let rebakeTimer = 0;
  function scheduleRebake(): void {
    window.clearTimeout(rebakeTimer);
    rebakeTimer = window.setTimeout(async () => {
      const st = store.get();
      if (!st.tiled) return;
      store.setBusy(true, '重新烘焙 PBR 贴图…', 0.3);
      try {
        const maps = await runRebake(st.tiled, st.pbr);
        const prev = st.result!;
        store.update({
          result: {
            color: prev.color,
            normal: maps.normal,
            roughness: maps.roughness,
            specular: maps.specular,
            height: maps.height,
            stats: prev.stats
          }
        });
        showMap();
      } catch (err) {
        toast((err as Error).message, true);
      } finally {
        store.setBusy(false);
      }
    }, 250);
  }

  const p = s.pbr;
  const controls = h(
    'div',
    { class: 'panel' },
    h('h2', {}, '③ PBR 贴图烘焙'),
    slider('法线强度', p.normalStrength, 0.1, 4, 0.05, (v) => {
      store.patchPBR({ normalStrength: v });
      scheduleRebake();
    }),
    slider('粗糙度基准', p.roughnessBase, 0.05, 0.95, 0.01, (v) => {
      store.patchPBR({ roughnessBase: v });
      scheduleRebake();
    }),
    slider('粗糙度对比', p.roughnessContrast, 0, 0.6, 0.01, (v) => {
      store.patchPBR({ roughnessContrast: v });
      scheduleRebake();
    }),
    slider('高光强度', p.specularLevel, 0, 1, 0.02, (v) => {
      store.patchPBR({ specularLevel: v });
      scheduleRebake();
    }),
    slider('釉面清漆 Clearcoat', p.clearcoat, 0, 1, 0.02, (v) => {
      store.patchPBR({ clearcoat: v });
      scheduleRebake();
    }),
    h(
      'div',
      { class: 'field', style: 'margin-top:8px' },
      h('label', {}, '工作流'),
      segmented(
        [
          { value: 'metal', label: 'PBR（金属度工作流）' },
          { value: 'spec', label: 'PBR（高光工作流）' }
        ],
        'metal',
        () => toast('本工具输出粗糙度+高光贴图，两套工作流均可直接使用')
      )
    ),
    h(
      'p',
      { class: 'hint', style: 'margin-top:12px' },
      '高度图由亮度经环形高斯滤波得到；法线用环形 Sobel 求梯度，粗糙度/高光同样环形处理，四边与颜色图保持一致的可平铺性。调参后自动防抖重烘焙。'
    )
  );

  buildTabs();
  showMap();

  return h(
    'div',
    { class: 'layout-2col' },
    controls,
    h('div', { class: 'panel' }, h('h2', {}, '贴图预览（全部四方连续）'), tabBar, stage)
  );
}
