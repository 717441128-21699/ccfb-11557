/**
 * 浏览器端冒烟测试（playwright-core + 本机缓存的 Chromium）
 * 走完整用户流程并校验真实产物。
 */
import { chromium } from 'playwright-core';
import { makePNG } from './make-png.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const CHROME =
  process.env.CHROME_PATH ||
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:5199';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

mkdirSync('tests/.build', { recursive: true });
rmSync('tests/.build/downloads', { recursive: true, force: true });
writeFileSync(
  'tests/.build/sample.png',
  makePNG(480, 360, (x, y, w, h) => {
    const u = x / w,
      v = y / h,
      light = 1.25 - 0.5 * u;
    return [
      (150 + 40 * Math.sin(u * 20) + 22 * Math.cos(v * 26)) * light,
      (132 + 34 * Math.cos(u * 15) + 20 * Math.sin(v * 29)) * light,
      (112 + 28 * Math.sin(u * 10 + v * 12)) * light
    ];
  })
);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text());
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitIdle(timeout = 60000) {
  await page.waitForSelector('.progress-wrap', { state: 'detached', timeout });
}

// —— 1. 加载 ——
await page.goto(BASE, { waitUntil: 'networkidle' });
check('应用标题渲染', (await page.title()).includes('瓷砖纹理'));
check('五个页签存在', (await page.locator('.tab-btn').count()) === 5);

// —— 2. 导入照片 ——
await page.setInputFiles('input[type=file]', 'tests/.build/sample.png');
await page.waitForFunction(() =>
  document.getElementById('header-status').textContent.includes('sample')
);
check('导入后状态栏显示文件名', true);

// —— 3. 校正 ——
await page.getByRole('button', { name: '执行校正' }).click();
await waitIdle();
await sleep(300);
check('校正结果画布出现', (await page.locator('#page canvas').count()) >= 2);

// —— 4. 去接缝合成（用默认 1024 参数，验证真实生产路径）——
await page.locator('.tab-btn', { hasText: '去接缝合成' }).click();
await page.waitForSelector('button:has-text("开始合成")');
await page.locator('button', { hasText: '开始合成' }).click();
await page.waitForSelector('.stat-grid', { timeout: 60000 });
await waitIdle();
const statsText = await page.locator('.stat-grid').innerText();
check('统计面板显示 TOST 指标', statsText.includes('TOST'));
const badgeText = await page.locator('.badge').first().innerText();
check('接缝检验通过徽标', badgeText.includes('通过'), badgeText);
check('单块+九宫格两个画布', (await page.locator('#page canvas').count()) >= 2);

// —— 5. 烘焙页 ——
await page.locator('.tab-btn', { hasText: '贴图烘焙' }).click();
await page.waitForSelector('.map-tab');
check('五张贴图页签', (await page.locator('.map-tab').count()) === 5);
for (const name of ['法线 Normal', '粗糙度 Roughness', '高光 Specular', '高度 Height', '颜色 Albedo']) {
  await page.locator('.map-tab', { hasText: name }).click();
  await sleep(120);
}
check('可切换查看全部 PBR 贴图', true);

// —— 6. 实时预览 ——
await page.locator('.tab-btn', { hasText: '铺贴预览' }).click();
await sleep(1800);
const gl = await page.locator('#page canvas').last().evaluate((c) => {
  return !!(c.getContext('webgl2') || c.getContext('webgl'));
});
check('Three.js WebGL 画布初始化', gl);
await page.getByRole('button', { name: '墙面' }).click();
await sleep(150);
await page.getByRole('button', { name: '地面' }).click();
await sleep(150);
await page.getByRole('button', { name: '墙+地' }).click();
await sleep(150);
check('墙/地铺贴面可切换', true);

// —— 7. 批量处理 ——
await page.locator('.tab-btn', { hasText: '批量导出' }).click();
await page.waitForSelector('button:has-text("批量处理全部色号")');
await page.locator('button', { hasText: '批量处理全部色号' }).click();
await page.waitForSelector('tbody tr', { timeout: 60000 });
await waitIdle();
await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 4, null, {
  timeout: 30000
});
const rows = await page.locator('tbody tr').count();
check('默认 4 个色号全部产出', rows === 4, `rows=${rows}`);
const allPass = await page.locator('.badge.pass').count();
check('每个色号接缝检验均通过', allPass >= 4, `pass=${allPass}`);

// —— 8. KTX2 导出并校验魔数 ——
await page.evaluate(() => {
  window.__dl = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.href && this.href.startsWith('blob:')) window.__dl.push(this.href);
    else orig.call(this);
  };
});
await page.locator('tbody tr').first().getByRole('button', { name: 'KTX2×4' }).click();
await page.waitForFunction(() => window.__dl.length === 4, null, { timeout: 15000 });
const blobUrls = await page.evaluate(() => window.__dl);
const magic = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
let ktxOk = true;
for (const u of blobUrls) {
  const b = await page.evaluate(
    async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer()),
    u
  );
  if (!magic.every((m, i) => b[i] === m)) ktxOk = false;
}
check('触发 4 个 KTX2 下载且魔数合法', ktxOk && blobUrls.length === 4);

// —— 9. PNG 导出 ——
await page.evaluate(() => (window.__dl = []));
await page.locator('tbody tr').first().getByRole('button', { name: 'PNG×4' }).click();
await page.waitForFunction(() => window.__dl.length === 4, null, { timeout: 15000 });
const pngUrls = await page.evaluate(() => window.__dl);
const pngHeader = await page.evaluate(
  async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer()),
  pngUrls[0]
);
check(
  '触发 4 个 PNG 下载且 PNG 头合法',
  pngUrls.length === 4 && pngHeader[0] === 0x89 && pngHeader[1] === 0x50
);

// —— 10. 预设 ——
await page.locator('input[placeholder*="预设名称"]').fill('冒烟测试预设');
await page.getByRole('button', { name: '保存当前全部参数为预设' }).click();
await page.waitForSelector('.preset-item');
check('预设出现在列表', (await page.locator('.preset-item').count()) >= 1);
const ls = await page.evaluate(() =>
  localStorage.getItem('tile-texture-studio:presets:v1')
);
check('预设持久化到 localStorage', ls.includes('冒烟测试预设'));

await page.screenshot({ path: 'tests/.build/batch-page.png', fullPage: false });
check('全程无 JS 错误', errors.length === 0, errors.join(' | '));
await browser.close();

console.log(`\n冒烟测试：${passed} 通过，${failed} 失败\n`);
if (failed) process.exit(1);
