import { store } from '../store';
import type { BatchResultItem } from '../store';
import { h } from '../ui/dom';
import { slider, badge, toast } from '../ui/widgets';
import { bufferToBlob, bufferToDataURL, downloadBlob } from '../core/image';
import { encodeKTX2, ktx2Blob } from '../core/ktx2';
import { runBatch } from '../workerClient';
import { meanLab } from '../core/colorways';
import type { Colorway } from '../types';

function cwId(): string {
  return 'cw_' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
}

export function renderBatchPage(): HTMLElement {
  const s = store.get();
  if (!s.result) {
    return h(
      'div',
      { class: 'panel' },
      h('h2', {}, '⑤ 批量处理与导出'),
      h('p', { class: 'hint' }, '请先完成纹理合成与贴图烘焙。')
    );
  }

  // —— 色号编辑卡片 ——
  function colorwayCard(cw: Colorway, index: number): HTMLElement {
    const useLab = cw.lab !== null;

    function update(patch: Partial<Colorway>): void {
      const list = structuredClone(store.get().colorways);
      list[index] = { ...list[index], ...patch };
      store.setColorways(list);
    }

    const head = h(
      'div',
      { class: 'head' },
      h('input', {
        type: 'text',
        value: cw.name,
        oninput: (ev: Event) => update({ name: (ev.target as HTMLInputElement).value })
      }),
      h(
        'button',
        {
          class: 'btn danger',
          onclick: () => {
            const list = store.get().colorways.filter((_, i) => i !== index);
            store.setColorways(list);
          }
        },
        '删除'
      )
    );

    const modeSeg = h('div', { class: 'seg' });
    modeSeg.replaceChildren(
      h(
        'button',
        {
          class: useLab ? 'active' : '',
          onclick: () => update({ lab: useLab ? cw.lab : { l: 70, a: 0, b: 0 } })
        },
        'Lab 目标色'
      ),
      h(
        'button',
        {
          class: !useLab ? 'active' : '',
          onclick: () => update({ lab: null })
        },
        'HSL 调整'
      )
    );

    const body: HTMLElement[] = [head, modeSeg];

    if (useLab && cw.lab) {
      const lab = cw.lab;
      body.push(
        slider('L 明度', lab.l, 0, 100, 1, (v) => update({ lab: { ...lab, l: v } }), (v) => v.toFixed(0)),
        slider('a 红绿', lab.a, -60, 60, 0.5, (v) => update({ lab: { ...lab, a: v } }), (v) => v.toFixed(1)),
        slider('b 黄蓝', lab.b, -60, 60, 0.5, (v) => update({ lab: { ...lab, b: v } }), (v) => v.toFixed(1)),
        h(
          'button',
          {
            class: 'btn ghost',
            style: 'width:100%',
            onclick: () => {
              const tiled = store.get().tiled!;
              update({ lab: meanLab(tiled) });
              toast('已取当前贴图平均 Lab');
            }
          },
          '取当前贴图平均色'
        )
      );
    } else {
      body.push(
        slider('色相旋转', cw.hueShift, -180, 180, 1, (v) => update({ hueShift: v }), (v) => v.toFixed(0) + '°'),
        slider('饱和度倍率', cw.satScale, 0, 2, 0.05, (v) => update({ satScale: v })),
        slider('明度倍率', cw.lightScale, 0.4, 1.6, 0.02, (v) => update({ lightScale: v }))
      );
    }

    return h('div', { class: 'cw-card' }, ...body);
  }

  const colorwayHost = h('div', {});
  function drawColorways(): void {
    const list = store.get().colorways;
    colorwayHost.replaceChildren(...list.map((cw, i) => colorwayCard(cw, i)));
  }
  drawColorways();

  // —— 批量处理 ——
  async function doBatch(): Promise<void> {
    const st = store.get();
    if (!st.tiled) return;
    store.setBusy(true, '批量处理色号…', 0.02);
    try {
      const items = await runBatch(st.tiled, st.pbr, st.colorways);
      store.update({ batch: items });
      toast(`已生成 ${items.length} 个色号`);
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      store.setBusy(false);
    }
  }

  // —— 导出 ——
  async function exportItem(item: BatchResultItem, fmt: 'png' | 'ktx2'): Promise<void> {
    const maps = [
      { key: 'color', buf: item.color, linear: false },
      { key: 'normal', buf: item.normal, linear: true },
      { key: 'roughness', buf: item.roughness, linear: true },
      { key: 'specular', buf: item.specular, linear: true }
    ] as const;
    const safe = item.colorway.name.replace(/[\\/:*?"<>|\s]+/g, '_');
    for (const m of maps) {
      if (fmt === 'png') {
        const blob = await bufferToBlob(m.buf, 'image/png');
        downloadBlob(blob, `${safe}_${m.key}_${m.buf.width}.png`);
      } else {
        const bytes = encodeKTX2(m.buf, { linear: m.linear, mipmaps: true });
        downloadBlob(ktx2Blob(bytes), `${safe}_${m.key}_${m.buf.width}.ktx2`);
      }
    }
  }

  async function exportAll(fmt: 'png' | 'ktx2'): Promise<void> {
    const items = store.get().batch;
    if (!items.length) {
      toast('请先执行批量处理', true);
      return;
    }
    store.setBusy(true, `导出 ${fmt.toUpperCase()}…`, 0.1);
    try {
      for (let i = 0; i < items.length; i++) {
        store.setProgress((i + 1) / items.length, `导出 ${i + 1}/${items.length}：${items[i].colorway.name}`);
        await exportItem(items[i], fmt);
        // 给浏览器一点时间安排下载，避免一次性触发被拦截
        await new Promise((r) => setTimeout(r, 250));
      }
      toast(`全部 ${fmt.toUpperCase()} 已开始下载`);
    } finally {
      store.setBusy(false);
    }
  }

  // —— 结果表 ——
  const resultHost = h('div', {});
  function drawResults(): void {
    const items = store.get().batch;
    if (!items.length) {
      resultHost.replaceChildren(h('p', { class: 'hint' }, '点击「批量处理全部色号」生成结果。'));
      return;
    }
    resultHost.replaceChildren(
      h(
        'table',
        { class: 'table' },
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, '色号'), h('th', {}, '颜色图'), h('th', {}, 'TOST p'), h('th', {}, '检验'), h('th', {}, '操作'))
        ),
        h(
          'tbody',
          {},
          ...items.map((it) => {
            const thumb = document.createElement('img');
            thumb.className = 'thumb';
            thumb.src = bufferToDataURL(it.color);
            return h(
              'tr',
              {},
              h('td', {}, it.colorway.name),
              h('td', {}, thumb),
              h('td', {}, it.stats.pEquivalence.toFixed(4)),
              h('td', {}, it.stats.pass ? badge('等效通过', 'pass') : badge('未通过', 'fail')),
              h(
                'td',
                {},
                h(
                  'button',
                  { class: 'btn', style: 'margin-right:6px', onclick: () => exportItem(it, 'png') },
                  'PNG×4'
                ),
                h('button', { class: 'btn', onclick: () => exportItem(it, 'ktx2') }, 'KTX2×4')
              )
            );
          })
        )
      )
    );
  }
  drawResults();

  // —— 预设 ——
  const presetHost = h('div', {});
  function drawPresets(): void {
    const presets = store.get().presets;
    if (!presets.length) {
      presetHost.replaceChildren(h('p', { class: 'hint' }, '暂无预设。保存后参数（校正/合成/PBR/色号）会存到浏览器本地。'));
      return;
    }
    presetHost.replaceChildren(
      ...presets.map((p) =>
        h(
          'div',
          { class: 'preset-item' },
          h(
            'div',
            {},
            h('div', {}, p.name),
            h('div', { class: 'meta' }, new Date(p.createdAt).toLocaleString() + ` · ${p.colorways.length} 个色号`)
          ),
          h(
            'div',
            {},
            h(
              'button',
              {
                class: 'btn',
                style: 'margin-right:6px',
                onclick: () => {
                  store.applyPreset(p);
                  drawColorways();
                  toast(`已应用预设「${p.name}」`);
                }
              },
              '应用'
            ),
            h('button', { class: 'btn danger', onclick: () => { store.removePreset(p.id); drawPresets(); } }, '删除')
          )
        )
      )
    );
  }
  drawPresets();

  const presetName = h('input', { type: 'text', placeholder: '预设名称，如：柔光釉-800砖' }) as HTMLInputElement;

  const controls = h(
    'div',
    { class: 'panel' },
    h('h2', {}, '色号清单'),
    colorwayHost,
    h(
      'button',
      {
        class: 'btn ghost',
        style: 'width:100%',
        onclick: () => {
          const list = [...store.get().colorways];
          list.push({ id: cwId(), name: `新色号 ${list.length + 1}`, lab: { l: 70, a: 0, b: 0 }, hueShift: 0, satScale: 1, lightScale: 1 });
          store.setColorways(list);
          drawColorways();
        }
      },
      '+ 新增色号'
    ),
    h('div', { style: 'height:18px' }),
    h(
      'button',
      { class: 'btn primary', style: 'width:100%', disabled: s.busy, onclick: doBatch },
      '批量处理全部色号'
    ),
    h('p', { class: 'hint', style: 'margin-top:10px' }, 'Lab 模式做整体目标色迁移并保留纹理明暗；HSL 模式做色相/饱和/明度调整。每个色号都会重新烘焙法线/粗糙度/高光并跑接缝检验。')
  );

  const exportPanel = h(
    'div',
    { class: 'panel', style: 'margin-top:18px' },
    h('h2', {}, '批量导出'),
    h('p', { class: 'hint' }, '每个色号导出 4 张贴图（color / normal / roughness / specular），KTX2 为 RGBA8 未压缩格式并带完整 mipmap 链，线性数据使用线性传输函数标记。'),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', disabled: s.busy, onclick: () => exportAll('png') }, '全部导出 PNG'),
      h('button', { class: 'btn primary', disabled: s.busy, onclick: () => exportAll('ktx2') }, '全部导出 KTX2')
    ),
    h('div', { style: 'height:14px' }),
    resultHost
  );

  const presetPanel = h(
    'div',
    { class: 'panel', style: 'margin-top:18px' },
    h('h2', {}, '参数预设'),
    h('div', { class: 'swatch-row', style: 'margin-bottom:10px' }, presetName),
    h(
      'button',
      {
        class: 'btn primary',
        style: 'width:100%',
        onclick: () => {
          const name = presetName.value.trim();
          if (!name) {
            toast('请填写预设名称', true);
            return;
          }
          store.savePreset(name);
          presetName.value = '';
          drawPresets();
          toast('预设已保存');
        }
      },
      '保存当前全部参数为预设'
    ),
    h('div', { style: 'height:12px' }),
    presetHost,
    h(
      'button',
      {
        class: 'btn ghost',
        style: 'width:100%;margin-top:8px',
        onclick: () => {
          store.resetParams();
          drawColorways();
          toast('参数已恢复默认');
        }
      },
      '恢复默认参数'
    )
  );

  return h('div', { class: 'layout-2col' }, controls, h('div', {}, exportPanel, presetPanel));
}
