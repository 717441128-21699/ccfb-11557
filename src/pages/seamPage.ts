import { store } from '../store';
import { h } from '../ui/dom';
import { slider, numberField, segmented, statCard, badge, toast } from '../ui/widgets';
import { bufferToCanvas, makeNineGrid } from '../core/image';
import { runSynthesize } from '../workerClient';

export function renderSeamPage(): HTMLElement {
  const s = store.get();
  const sy = s.synthesis;

  if (!s.corrected) {
    return h(
      'div',
      { class: 'panel' },
      h('h2', {}, '② 去接缝 · 四方连续合成'),
      h('p', { class: 'hint' }, '请先在「样片导入与校正」页导入照片并执行校正。')
    );
  }

  const view = h('div', { class: 'canvas-stage' });

  function showTiled(): void {
    if (!s.tiled) {
      view.replaceChildren(h('div', { class: 'hint' }, '调整参数后点击「开始合成」'));
      return;
    }
    const c = document.createElement('canvas');
    bufferToCanvas(s.tiled, c);
    view.replaceChildren(c);
  }

  let gridCanvas: HTMLCanvasElement | null = null;
  const gridHost = h('div', { class: 'canvas-stage', style: 'min-height:220px' });
  function showGrid(): void {
    gridHost.replaceChildren();
    if (!s.tiled) {
      gridHost.append(h('div', { class: 'hint' }, '合成后在此查看 3×3 拼贴接缝'));
      return;
    }
    const grid = makeNineGrid(s.tiled);
    gridCanvas = document.createElement('canvas');
    bufferToCanvas(grid, gridCanvas);
    gridCanvas.style.maxHeight = '52vh';
    gridHost.append(gridCanvas);
  }

  const statsPanel = h('div', { class: 'panel', style: 'margin-top:18px' }, h('h2', {}, '四方连续接缝统计检验'));
  function showStats(): void {
    const r = store.get().result;
    if (!r) {
      statsPanel.replaceChildren(
        h('h2', {}, '四方连续接缝统计检验'),
        h('p', { class: 'hint' }, '合成完成后自动执行 Welch t 检验。')
      );
      return;
    }
    const st = r.stats;
    statsPanel.replaceChildren(
      h('h2', {}, '四方连续接缝统计检验', ' ', st.pass ? badge('通过：接缝与内部统计等效', 'pass') : badge('未通过：建议加大重叠/候选数重合成', 'fail')),
      h(
        'p',
        { class: 'hint' },
        'TOST 双单侧等效性检验：H₀ 为"接缝色差与内部相邻色差的均值差超出等效界值"，两个单侧检验同时被拒绝（p<0.05）即判定统计上无显著区别。采样对 n=' +
          st.n +
          '，等效界值 margin=' +
          st.margin.toFixed(2) +
          '（色差值）。另附 Welch 差异性检验与 Cohen\'s d 效应量供参考。'
      ),
      h(
        'div',
        { class: 'stat-grid' },
        statCard('接缝色差均值', st.seamMean.toFixed(2)),
        statCard('内部色差均值', st.interiorMean.toFixed(2)),
        statCard('TOST 等效 p', st.pEquivalence.toFixed(4)),
        statCard("Cohen's d", st.cohensD.toFixed(3)),
        statCard('Welch p（参考）', st.pValue.toFixed(4)),
        statCard('自由度', st.dof.toFixed(0))
      )
    );
  }

  const controls = h(
    'div',
    { class: 'panel' },
    h('h2', {}, '② 去接缝 · 四方连续合成'),
    numberField('输出贴图边长（px）', sy.outSize, 256, 4096, 64, (v) =>
      store.patchSynthesis({ outSize: Math.round(v) })
    ),
    numberField('合成块尺寸 patch（px）', sy.patchSize, 16, 256, 8, (v) =>
      store.patchSynthesis({ patchSize: Math.round(v) })
    ),
    numberField('重叠宽度 overlap（px）', sy.overlap, 4, 64, 2, (v) =>
      store.patchSynthesis({ overlap: Math.round(v) })
    ),
    slider('候选块数量（越大越自然，越慢）', sy.candidates, 2, 24, 1, (v) =>
      store.patchSynthesis({ candidates: Math.round(v) }),
      (v) => String(Math.round(v))
    ),
    h(
      'div',
      { class: 'field' },
      h('label', {}, '合成算法'),
      segmented(
        [
          { value: 'quilting', label: 'Min-Cut 高质量' },
          { value: 'feather', label: '羽化快速' }
        ],
        sy.mode,
        (v) => store.patchSynthesis({ mode: v })
      )
    ),
    numberField('随机种子（同参数可复现）', sy.seed, 1, 99999999, 1, (v) =>
      store.patchSynthesis({ seed: Math.round(v) })
    ),
    h(
      'div',
      { class: 'btn-row' },
      h(
        'button',
        {
          class: 'btn primary',
          disabled: s.busy,
          onclick: async () => {
            const st = store.get();
            if (!st.corrected) return;
            if (st.synthesis.patchSize >= st.corrected.width) {
              toast('合成块必须小于样片尺寸（1024）', true);
              return;
            }
            if (st.synthesis.overlap >= st.synthesis.patchSize) {
              toast('重叠宽度必须小于合成块尺寸', true);
              return;
            }
            store.setBusy(true, '纹理合成中…', 0.02);
            try {
              const out = await runSynthesize(st.corrected, st.synthesis, st.pbr);
              store.update({
                tiled: out.color,
                result: {
                  color: out.color,
                  normal: out.normal,
                  roughness: out.roughness,
                  specular: out.specular,
                  height: out.height,
                  stats: out.stats
                }
              });
              toast(out.stats.pass ? '合成完成，接缝检验通过' : '合成完成，但接缝检验未通过，请调参重试');
            } finally {
              store.setBusy(false);
            }
          }
        },
        '开始合成'
      ),
      h(
        'button',
        {
          class: 'btn ghost',
          disabled: s.busy,
          onclick: () => store.patchSynthesis({ seed: Math.floor(Math.random() * 1e8) })
        },
        '换一个种子'
      )
    ),
    h(
      'p',
      { class: 'hint', style: 'margin-top:14px' },
      '环形 Image Quilting：在环面画布上蛇形扫描两遍，重叠区按 SSD 选块、动态规划 Min-Cut 切缝，四边天然可平铺。检验不通过时，优先增大 overlap 与候选数。'
    )
  );

  showTiled();
  showGrid();
  showStats();

  return h(
    'div',
    { class: 'layout-2col' },
    controls,
    h(
      'div',
      {},
      h('div', { class: 'panel' }, h('h2', {}, '合成贴图（单块）'), view),
      h('div', { class: 'panel', style: 'margin-top:18px' }, h('h2', {}, '九宫格平铺目检（看横竖接缝）'), gridHost),
      statsPanel
    )
  );
}
