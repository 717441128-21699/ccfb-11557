import { store } from './store';
import { onProgress } from './workerClient';
import { h, mount } from './ui/dom';
import { renderImportPage } from './pages/importPage';
import { renderSeamPage } from './pages/seamPage';
import { renderBakePage } from './pages/bakePage';
import { renderPreviewPage } from './pages/previewPage';
import { renderBatchPage } from './pages/batchPage';
import type { PageId } from './types';
import './styles.css';

const TABS: { id: PageId; label: string }[] = [
  { id: 'import', label: '样片导入与校正' },
  { id: 'seam', label: '去接缝合成' },
  { id: 'bake', label: '贴图烘焙' },
  { id: 'preview', label: '铺贴预览' },
  { id: 'batch', label: '批量导出' }
];

function renderTabbar(): void {
  const bar = document.getElementById('tabbar')!;
  const s = store.get();
  mount(
    h(
      'nav',
      { style: 'display:contents' },
      ...TABS.map((t, i) =>
        h(
          'button',
          {
            class: 'tab-btn' + (s.page === t.id ? ' active' : ''),
            onclick: () => store.setPage(t.id)
          },
          h('span', { class: 'step' }, String(i + 1)),
          t.label
        )
      )
    ),
    bar
  );
}

function renderHeaderStatus(): void {
  const s = store.get();
  const el = document.getElementById('header-status')!;
  const parts: string[] = [];
  if (s.sourceName) parts.push(s.sourceName);
  if (s.tiled) parts.push(`${s.tiled.width}×${s.tiled.height}`);
  if (s.result) parts.push(s.result.stats.pass ? '接缝检验通过' : '接缝需调整');
  el.textContent = parts.length ? parts.join(' · ') : '未导入样片';
}

let currentCleanup: (() => void) | null = null;

function renderPage(): void {
  currentCleanup?.();
  currentCleanup = null;
  const s = store.get();
  const page = document.getElementById('page')!;
  const builders: Record<PageId, () => HTMLElement> = {
    import: renderImportPage,
    seam: renderSeamPage,
    bake: renderBakePage,
    preview: renderPreviewPage,
    batch: renderBatchPage
  };
  const el = builders[s.page]();
  mount(el, page);
  currentCleanup = (el as HTMLElement & { __cleanup?: () => void }).__cleanup ?? null;
}

/** 状态变更：刷新页签、头部状态与页面（不含高频进度条） */
function refreshChrome(): void {
  renderTabbar();
  renderHeaderStatus();
  renderPage();
}

// —— 进度条：独立通道，直接增量更新 DOM，绝不重建页面 ——
let progressHost: HTMLDivElement | null = null;
let progressLabel: HTMLSpanElement | null = null;
let progressPct: HTMLSpanElement | null = null;
let progressBar: HTMLElement | null = null;

function ensureProgressEl(): void {
  if (progressHost) return;
  progressHost = document.createElement('div');
  progressHost.className = 'progress-wrap';
  progressHost.id = 'progress-host';
  progressLabel = document.createElement('span');
  progressPct = document.createElement('span');
  const pt = document.createElement('div');
  pt.className = 'pt';
  pt.append(progressLabel, progressPct);
  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  progressBar = document.createElement('i');
  bar.append(progressBar);
  progressHost.append(pt, bar);
  document.body.appendChild(progressHost);
}

function renderProgress(busy: boolean, text: string, ratio: number): void {
  if (!busy) {
    progressHost?.remove();
    progressHost = null;
    progressLabel = progressPct = null;
    progressBar = null;
    return;
  }
  ensureProgressEl();
  if (progressLabel) progressLabel.textContent = text || '处理中…';
  if (progressPct) progressPct.textContent = Math.round(ratio * 100) + '%';
  if (progressBar) progressBar.style.width = Math.round(ratio * 100) + '%';
}

function boot(): void {
  // 普通状态变更才重建页面
  store.subscribe(() => refreshChrome());
  // 高频进度只更新进度条
  store.subscribeProgress((busy, text, ratio) => renderProgress(busy, text, ratio));
  onProgress((phase, r) => store.setProgress(r, phase));
  refreshChrome();
  renderProgress(store.get().busy, store.get().busyText, store.get().progress);
}

boot();

// 全局错误提示
window.addEventListener('unhandledrejection', (ev) => {
  store.setBusy(false);
  const msg = ev.reason?.message ?? String(ev.reason);
  const el = document.getElementById('toast')!;
  el.textContent = '处理失败：' + msg;
  el.className = 'toast err';
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 5000);
});
