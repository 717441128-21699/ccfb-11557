import { store } from '../store';
import { h } from '../ui/dom';
import { slider, toast } from '../ui/widgets';
import { imageElementToBuffer, loadImageFile, bufferToCanvas } from '../core/image';
import { runCorrect } from '../workerClient';
import type { Pt } from '../types';

export function renderImportPage(): HTMLElement {
  const s = store.get();

  const stage = h('div', { class: 'canvas-stage' });
  const canvas = document.createElement('canvas');
  canvas.className = 'corner-canvas';

  function drawSource(): void {
    if (!s.source) {
      stage.replaceChildren(
        h('div', { class: 'hint', style: 'padding:40px' }, '导入照片后在此框选瓷砖样片的四个角点')
      );
      return;
    }
    bufferToCanvas(s.source, canvas);
    stage.replaceChildren(canvas);
    requestAnimationFrame(drawCorners);
  }

  let dragIndex = -1;

  function drawCorners(): void {
    if (!s.source) return;
    const ctx = canvas.getContext('2d')!;
    const corners = store.get().correction.corners;
    const pts = corners.map((p) => ({ x: p.x * canvas.width, y: p.y * canvas.height }));
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(79,156,249,0.12)';
    ctx.strokeStyle = '#4f9cf9';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = i === dragIndex ? '#fff' : '#4f9cf9';
      ctx.fill();
      ctx.strokeStyle = '#0b1626';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#0b1626';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), p.x, p.y);
    });
    ctx.restore();
  }

  function eventPos(ev: PointerEvent): Pt {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height))
    };
  }

  canvas.addEventListener('pointerdown', (ev) => {
    const p = eventPos(ev);
    const corners = store.get().correction.corners;
    let best = 0;
    let bestD = Infinity;
    corners.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (bestD < 0.08) {
      dragIndex = best;
      canvas.setPointerCapture(ev.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (dragIndex < 0) return;
    const p = eventPos(ev);
    const corners = structuredClone(store.get().correction.corners) as [Pt, Pt, Pt, Pt];
    corners[dragIndex] = p;
    store.patchCorrection({ corners });
    drawCorners();
  });

  const endDrag = (): void => {
    dragIndex = -1;
    drawCorners();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (f) await ingest(f);
    fileInput.value = '';
  });

  async function ingest(file: File): Promise<void> {
    try {
      store.setBusy(true, '加载照片…', 0.2);
      const img = await loadImageFile(file);
      const buf = imageElementToBuffer(img, 2048);
      store.update({
        source: buf,
        sourceName: file.name,
        corrected: null,
        tiled: null,
        result: null,
        batch: []
      });
      toast(`已导入 ${file.name}（${buf.width}×${buf.height}）`);
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      store.setBusy(false);
    }
  }

  const dz = h(
    'div',
    {
      class: 'dropzone',
      onclick: () => fileInput.click()
    },
    h('div', { class: 'big' }, '📷'),
    h('div', {}, '点击选择或拖入瓷砖样片照片'),
    h('div', { class: 'hint', style: 'margin-top:8px' }, '支持 JPG / PNG / WebP，长边自动限制到 2048px')
  );
  dz.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    dz.classList.add('drag');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (ev) => {
    ev.preventDefault();
    dz.classList.remove('drag');
    const f = ev.dataTransfer?.files?.[0];
    if (f) ingest(f);
  });

  const c = s.correction;
  const controls = h(
    'div',
    { class: 'panel' },
    h('h2', {}, '① 透视与光照校正'),
    dz,
    fileInput,
    h(
      'div',
      { class: 'field', style: 'margin-top:16px' },
      h(
        'label',
        {},
        '透视校正（在右侧图上拖动 1–4 角点，框选砖面）',
        h('span', { class: 'val' }, s.source ? '可拖拽' : '未导入')
      )
    ),
    slider(
      '光照不均校正强度',
      c.flatfieldStrength,
      0,
      1,
      0.05,
      (v) => store.patchCorrection({ flatfieldStrength: v })
    ),
    slider(
      '照度估计半径（越大越平滑）',
      c.flatfieldRadius,
      0.05,
      0.5,
      0.01,
      (v) => store.patchCorrection({ flatfieldRadius: v }),
      (v) => v.toFixed(2)
    ),
    h(
      'div',
      { class: 'field' },
      h(
        'label',
        {},
        '启用光照校正',
        h('input', {
          type: 'checkbox',
          ...(c.flatfield ? { checked: true } : {}),
          onchange: (ev: Event) =>
            store.patchCorrection({ flatfield: (ev.target as HTMLInputElement).checked })
        })
      )
    ),
    h(
      'div',
      { class: 'btn-row' },
      h(
        'button',
        {
          class: 'btn primary',
          disabled: !s.source || s.busy,
          onclick: async () => {
            if (!s.source) return;
            store.setBusy(true, '透视/光照校正…', 0.05);
            try {
              const corrected = await runCorrect(s.source, store.get().correction, 1024);
              store.update({ corrected });
              toast('校正完成，可进入「去接缝合成」');
            } finally {
              store.setBusy(false);
            }
          }
        },
        '执行校正'
      ),
      h(
        'button',
        {
          class: 'btn ghost',
          disabled: !s.source,
          onclick: () => {
            store.patchCorrection({
              corners: [
                { x: 0.06, y: 0.06 },
                { x: 0.94, y: 0.06 },
                { x: 0.94, y: 0.94 },
                { x: 0.06, y: 0.94 }
              ]
            });
            drawCorners();
          }
        },
        '重置角点'
      )
    ),
    h(
      'p',
      { class: 'hint', style: 'margin-top:14px' },
      '校正输出为 1024×1024 正方形标准样片。光照校正采用大半径高斯照度场做除法匀光，保留釉面本身的纹理细节。'
    )
  );

  // 校正后对比图
  const resultPanel = h('div', { class: 'panel' }, h('h2', {}, '校正结果'));
  if (s.corrected) {
    const cc = document.createElement('canvas');
    bufferToCanvas(s.corrected, cc);
    cc.style.maxWidth = '100%';
    resultPanel.append(cc, h('p', { class: 'hint' }, '标准样片 1024×1024，下一步基于它做四方连续合成。'));
  } else {
    resultPanel.append(h('p', { class: 'hint' }, '尚未执行校正。'));
  }

  drawSource();

  return h(
    'div',
    { class: 'layout-2col' },
    h('div', {}, controls),
    h(
      'div',
      {},
      h('div', { class: 'panel', style: 'margin-bottom:18px' }, h('h2', {}, '原图与角点'), stage),
      resultPanel
    )
  );
}
