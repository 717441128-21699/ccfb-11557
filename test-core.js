// 核心算法验证:节距序列模拟退火 + 阶次谱
const lengths = [26, 30, 34];   // mm
const counts  = [24, 24, 24];
const maxRun = 4, maxRatio = 1.30;
const N = counts.reduce((a, b) => a + b, 0);
const C = lengths.reduce((s, l, i) => s + l * counts[i], 0); // 周长 mm
const K = N;

// 三角函数查表:角度总是 2π*m/C
const cosT = new Float64Array(C), sinT = new Float64Array(C);
for (let m = 0; m < C; m++) { cosT[m] = Math.cos(2 * Math.PI * m / C); sinT[m] = Math.sin(2 * Math.PI * m / C); }

const cum = new Int32Array(N);
function spectrumMax(seq) {
  let s = 0;
  for (let i = 0; i < N; i++) { cum[i] = s; s += lengths[seq[i]]; }
  let maxA = 0, sum = 0;
  for (let k = 1; k <= K; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) { const idx = (k * cum[i]) % C; re += cosT[idx]; im += sinT[idx]; }
    const a = Math.sqrt(re * re + im * im) / N;
    if (a > maxA) maxA = a;
    sum += a;
  }
  return { maxA, par: maxA / (sum / K) };
}
function violations(seq) {
  let v = 0;
  for (let i = 0; i < N; i++) {
    const a = lengths[seq[i]], b = lengths[seq[(i + 1) % N]];
    const r = a > b ? a / b : b / a;
    if (r > maxRatio + 1e-9) v++;
  }
  for (let i = 0; i < N; i++) {
    if (seq[i] !== seq[(i - 1 + N) % N]) {
      let rl = 1;
      while (rl < N && seq[(i + rl) % N] === seq[i]) rl++;
      if (rl > maxRun) v += rl - maxRun;
    }
  }
  return v;
}
function cost(seq) {
  const { maxA, par } = spectrumMax(seq);
  return maxA + 0.05 * par + 3 * violations(seq);
}
function randomSeq() {
  const a = [];
  counts.forEach((c, t) => { for (let i = 0; i < c; i++) a.push(t); });
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 对照:纯随机
const rnd = randomSeq();
const rs = spectrumMax(rnd);
console.log(`随机序列: maxA=${rs.maxA.toFixed(4)} PAR=${rs.par.toFixed(2)} 违规=${violations(rnd)}`);

// 模拟退火
const iters = 30000, T0 = 0.06, T1 = 2e-4;
const t0 = Date.now();
let cur = randomSeq(), curCost = cost(cur);
let best = cur.slice(), bestCost = curCost;
for (let it = 0; it < iters; it++) {
  const T = T0 * Math.pow(T1 / T0, it / iters);
  let i = (Math.random() * N) | 0, j = (Math.random() * N) | 0;
  if (i === j) continue;
  [cur[i], cur[j]] = [cur[j], cur[i]];
  const c = cost(cur);
  if (c < curCost || Math.random() < Math.exp((curCost - c) / T)) {
    curCost = c;
    if (c < bestCost) { bestCost = c; best = cur.slice(); }
  } else [cur[i], cur[j]] = [cur[j], cur[i]];
}
const ms = Date.now() - t0;
const bs = spectrumMax(best);
console.log(`优化序列: maxA=${bs.maxA.toFixed(4)} PAR=${bs.par.toFixed(2)} 违规=${violations(best)} 耗时=${ms}ms (${iters}次迭代)`);
console.log(`峰值降低: ${(20 * Math.log10(rs.maxA / bs.maxA)).toFixed(1)} dB`);
console.log(`序列: ${best.map(t => 'ABC'[t]).join('')}`);

// 单次评估耗时
const t1 = process.hrtime.bigint();
for (let r = 0; r < 100; r++) spectrumMax(best);
console.log(`单次频谱评估: ${Number(process.hrtime.bigint() - t1) / 1e8} ms/次`);
