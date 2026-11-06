// strategy-ui.js — 명조 툴즈 v5.0: 강화 전략 탭 화면 (목표 고르기 → 확률 · 가장 싼 강화 순서 · 그래프)
import { STAT_DATABASE, evaluateStepTier } from './data.js';
import { analyze, passProb, METRICS } from './strategy.js';

const $ = (id) => document.getElementById(id);
const KEY = 'echopago.strategy.v1';
const MAX = 5;
const KEYS = Object.keys(STAT_DATABASE);
const PRESETS = [
  { label: '크크', keys: ['크확', '크피'] },
  { label: '크크 공효', keys: ['크확', '크피', '공효'] },
  { label: '크크 공%', keys: ['크확', '크피', '공%'] },
  { label: '크크 공효 공%', keys: ['크확', '크피', '공효', '공%'] },
];
const METRIC_HINT = {
  tuner: '튜너가 가장 적게 드는 순서. 에코파고의 "튜너 아끼기"와 같은 기준이에요.',
  exp: '경험치(에코 재료)가 가장 적게 드는 순서예요.',
  echo: '에코를 가장 적게 버리는 순서예요. 성공할 수 있는 동안은 끝까지 열어요.',
};
const statIcon = (key) => `<i class="stat-icon" style="--icon:url('./icons/${STAT_DATABASE[key].icon}.png')" aria-hidden="true"></i>`;
const valText = (key, v) => `+${v}${STAT_DATABASE[key].isPercent ? '%' : ''}`;

// ───────── 저장 ─────────
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* 무시 */ }
  const targets = (Array.isArray(s?.targets) ? s.targets : [])
    .filter((t) => STAT_DATABASE[t?.key])
    .map((t) => ({ key: t.key, minStep: Math.min(Math.max(1, t.minStep | 0), STAT_DATABASE[t.key].values.length) }))
    .filter((t, i, a) => a.findIndex((x) => x.key === t.key) === i)
    .slice(0, MAX);
  return {
    targets: s ? targets : ['크확', '크피', '공효'].map((key) => ({ key, minStep: 1 })),
    metric: METRICS[s?.metric] ? s.metric : 'tuner',
  };
}
const state = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 무시 */ } };

// ───────── 숫자 표기 ─────────
const fmtInt = (n) => Math.round(n).toLocaleString('ko-KR');
function fmtCost(metric, n) {
  if (!Number.isFinite(n)) return '-';
  if (metric === 'exp') return n >= 10000 ? `${(n / 10000).toFixed(n >= 1e6 ? 0 : 1)}만` : fmtInt(n);
  if (metric === 'echo') return n < 100 ? n.toFixed(1) : fmtInt(n);
  return fmtInt(n);
}
const fmtPct = (p) => { const v = p * 100; return v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3); };
const perSuccess = (r, m) => r[m].net / r.p;

// ───────── 왼쪽: 목표 고르기 ─────────
function renderPresets() {
  $('sgPresets').innerHTML = PRESETS.map((p, i) => `<button type="button" class="pm-btn" data-preset="${i}">${p.label}</button>`).join('');
}
function renderChips() {
  const chosen = new Set(state.targets.map((t) => t.key));
  $('sgChips').innerHTML = KEYS.map((key) => `
    <label class="filter-chip"><input type="checkbox" value="${key}" ${chosen.has(key) ? 'checked' : ''} ${!chosen.has(key) && chosen.size >= MAX ? 'disabled' : ''}>
    ${statIcon(key)}${STAT_DATABASE[key].name}</label>`).join('');
}
function renderTargets() {
  const box = $('sgTargets');
  if (!state.targets.length) { box.innerHTML = '<p class="sg-empty">위에서 원하는 옵션을 골라 주세요. (최대 5개)</p>'; return; }
  box.innerHTML = state.targets.map((t, i) => {
    const d = STAT_DATABASE[t.key];
    const opts = d.values.map((v, s) => {
      const tier = evaluateStepTier(s + 1, d.values.length).label;
      const p = passProb(t.key, s + 1);
      return `<option value="${s + 1}" ${s + 1 === t.minStep ? 'selected' : ''}>${s === 0 ? '아무 수치' : `${valText(t.key, v)} 이상 · ${tier} · ${fmtPct(p)}%`}</option>`;
    }).join('');
    return `<div class="sg-target">
      <span class="sg-target-name">${statIcon(t.key)}${d.name}</span>
      <select class="cutoff-select" data-min="${i}" aria-label="${d.name} 최소 수치">${opts}</select>
      <button type="button" class="sg-x" data-remove="${i}" aria-label="${d.name} 빼기">✕</button>
    </div>`;
  }).join('');
}
function renderMetric() {
  for (const b of $('sgMetric').querySelectorAll('[data-metric]')) b.setAttribute('aria-pressed', b.dataset.metric === state.metric);
  $('sgMetricHint').textContent = METRIC_HINT[state.metric];
}

// ───────── 오른쪽: 결과 ─────────
let last = null;
function renderResult() {
  const res = state.targets.length ? analyze(state.targets, state.metric) : null;
  last = res;
  const out = $('sgResult');
  if (!res) {
    out.innerHTML = `<p class="sg-empty">${state.targets.length ? '이 목표는 나올 수 없어요.' : '원하는 옵션을 고르면 계산해 드려요.'}</p>`;
    $('sgCompare').innerHTML = ''; drawChart(); return;
  }
  const b = res.best;
  const names = state.targets.map((t) => STAT_DATABASE[t.key].name + (t.minStep > 1 ? ` ${valText(t.key, STAT_DATABASE[t.key].values[t.minStep - 1])}↑` : '')).join(' · ');
  out.innerHTML = `
    <div class="sg-goal">${names}</div>
    <div class="sg-big">
      <div><div class="sg-big-label">에코 1개가 성공할 확률</div><div class="sg-big-num">${fmtPct(b.p)}%</div>
        <div class="sg-sub">아래 순서대로 강화할 때 · 5칸을 다 열면 ${fmtPct(res.untilDead.p)}%</div></div>
    </div>
    <div class="sg-costs">
      ${['tuner', 'exp', 'echo'].map((m) => `<div class="sg-cost ${m === state.metric ? 'is-key' : ''}">
        <span>성공 1개당 ${METRICS[m].label}</span><b>${fmtCost(m, perSuccess(b, m))}${m === 'exp' ? '' : METRICS[m].unit}</b></div>`).join('')}
    </div>
    <p class="sg-note">평균값이에요. 버린 에코는 재료로 써서 튜너 30% · 경험치 75%를 돌려받는 걸로 계산했어요. 성공한 에코는 +25까지 다 연 비용이에요.</p>
    <h4 class="sg-h">가장 싼 강화 순서<span class="en">STRATEGY</span></h4>
    ${rulesTable(res)}
    <p class="sg-note">고른 옵션이 최소 수치보다 낮게 뜨면 그 에코는 바로 버려요. (같은 옵션은 다시 안 뜨니까)</p>`;
  renderCompare(res);
  drawChart();
}

function rulesTable(res) {
  const T = res.model.T;
  const head = Array.from({ length: T }, (_, c) => `<th>${c}개</th>`).join('');   // T개 다 뜨면 이미 성공이라 열이 필요 없음
  const rows = res.rules.map((cells, k) => {
    const label = k === 0 ? '처음 (0칸)' : `${k}칸 연 뒤`;
    const tds = Array.from({ length: T }, (_, c) => {
      const cell = cells[c];
      if (!cell) return '<td class="sg-na">-</td>';
      if (cell.kind === 'go') return '<td class="sg-go">계속</td>';
      if (cell.kind === 'stop') return '<td class="sg-stop">버림</td>';
      const which = cell.go.map((m) => state.targets.filter((_, i) => m & (1 << i)).map((t) => STAT_DATABASE[t.key].name).join('+')).join(' / ');
      return `<td class="sg-mixed" title="${which} 떴으면 계속">옵션 따라<small>${which} 떴으면 계속</small></td>`;
    }).join('');
    return `<tr><th>${label}</th>${tds}</tr>`;
  }).join('');
  return `<div class="sg-rules-wrap"><table class="sg-rules"><thead><tr><th>열린 칸 ＼ 뜬 옵션</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

const STRATS = [
  { id: 'best', label: '가장 싼 순서', desc: '위 표대로' },
  { id: 'untilDead', label: '끝까지 열기', desc: '성공할 수 있는 동안은 계속' },
  { id: 'openAll', label: '다 까기', desc: '실패해도 +25까지' },
];
function renderCompare(res) {
  $('sgCompare').innerHTML = `<table class="sg-cmp"><thead><tr><th>강화 방법</th><th>성공 확률</th><th>튜너</th><th>경험치</th><th>에코</th></tr></thead><tbody>
    ${STRATS.map((s) => { const r = res[s.id]; return `<tr class="${s.id === 'best' ? 'is-best' : ''}"><th>${s.label}<small>${s.desc}</small></th><td>${fmtPct(r.p)}%</td>
      ${['tuner', 'exp', 'echo'].map((m) => `<td class="${m === state.metric ? 'is-key' : ''}">${fmtCost(m, perSuccess(r, m))}</td>`).join('')}</tr>`; }).join('')}
  </tbody></table><p class="sg-note">튜너 · 경험치 · 에코는 성공 1개당 평균이에요.</p>`;
}

// ───────── 그래프: 쓴 양에 따라 1개 이상 얻을 확률 ─────────
function drawChart() {
  const canvas = $('sgChart');
  const wrap = canvas.parentElement;
  const W = wrap.clientWidth, H = Math.max(240, Math.min(360, Math.round(W * 0.42)));
  if (!W) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = `${H}px`;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const col = { text: v('--text'), muted: v('--muted'), dim: v('--dim'), line: v('--line'), accent: v('--cyan') };
  const font = (size, w = 500) => `${w} ${size}px 'Chakra Petch', 'IBM Plex Sans KR', sans-serif`;
  const res = last;
  if (!res) { $('sgLegend').innerHTML = ''; g.fillStyle = col.dim; g.font = font(13); g.textAlign = 'center'; g.fillText('옵션을 고르면 그래프가 나와요', W / 2, H / 2); return; }

  const m = state.metric;
  const L = 58, R = 16, Tp = 16, B = 42;
  const pw = W - L - R, ph = H - Tp - B;
  const per = (r) => r[m].net;                                  // 에코 1개당 평균 비용
  const costAt = (r, q) => per(r) * Math.log(1 - q) / Math.log(1 - r.p);   // 확률 q까지 드는 양
  const xmax = niceMax(costAt(res.best, 0.99));
  const X = (x) => L + (x / xmax) * pw, Y = (p) => Tp + (1 - p) * ph;

  // 눈금
  g.strokeStyle = col.line; g.lineWidth = 1; g.font = font(11); g.fillStyle = col.dim;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const p of [0, 0.25, 0.5, 0.75, 1]) { g.beginPath(); g.moveTo(L, Y(p) + 0.5); g.lineTo(L + pw, Y(p) + 0.5); g.stroke(); g.fillText(`${p * 100}%`, L - 8, Y(p)); }
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (let i = 0; i <= 4; i++) { const x = (xmax * i) / 4; g.fillText(fmtCost(m, x), X(x), Tp + ph + 8); }
  g.fillStyle = col.muted; g.fillText(`쓴 ${METRICS[m].label} (환급 후)`, L + pw / 2, Tp + ph + 25);

  // 곡선: 다 까기 → 끝까지 열기 → 가장 싼 순서 (위에 그릴수록 강조)
  const curve = (r, color, width, dash) => {
    g.save(); g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash); g.beginPath();
    for (let i = 0; i <= 200; i++) { const x = (xmax * i) / 200; const p = 1 - Math.pow(1 - r.p, x / per(r)); const px = X(x), py = Y(p); i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke(); g.restore();
  };
  curve(res.openAll, col.dim, 1.5, [2, 4]);
  curve(res.untilDead, col.muted, 1.5, [6, 5]);
  curve(res.best, col.accent, 2.5, []);

  // 50% · 90% 표시
  g.font = font(11.5, 600); g.textBaseline = 'bottom';
  for (const q of [0.5, 0.9]) {
    const x = costAt(res.best, q); if (x > xmax) continue;
    g.fillStyle = col.accent; g.beginPath(); g.arc(X(x), Y(q), 3.5, 0, Math.PI * 2); g.fill();
    g.textAlign = X(x) > L + pw - 120 ? 'right' : 'left';
    g.fillText(`${q * 100}% · ${fmtCost(m, x)}`, X(x) + (g.textAlign === 'left' ? 8 : -8), Y(q) - 4);
  }

  // 범례는 그래프 밖 HTML (좁은 화면에서 줄바꿈되게)
  $('sgLegend').innerHTML = [['best', ''], ['untilDead', 'is-dash'], ['openAll', 'is-dot']]
    .map(([id, cls]) => `<span class="${cls}"><i></i>${STRATS.find((s) => s.id === id).label}</span>`).join('');
}
function niceMax(x) {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * e >= x) return f * e;
  return 10 * e;
}

// ───────── 이벤트 ─────────
function update() { save(); renderChips(); renderTargets(); renderMetric(); renderResult(); }

$('sgPresets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]'); if (!b) return;
  state.targets = PRESETS[+b.dataset.preset].keys.map((key) => ({ key, minStep: 1 }));
  update();
});
$('sgChips').addEventListener('change', (e) => {
  const key = e.target.value;
  if (e.target.checked) { if (state.targets.length < MAX) state.targets.push({ key, minStep: 1 }); }
  else state.targets = state.targets.filter((t) => t.key !== key);
  update();
});
$('sgTargets').addEventListener('change', (e) => {
  const i = e.target.dataset.min; if (i === undefined) return;
  state.targets[+i].minStep = +e.target.value; update();
});
$('sgTargets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]'); if (!b) return;
  state.targets.splice(+b.dataset.remove, 1); update();
});
$('sgMetric').addEventListener('click', (e) => {
  const b = e.target.closest('[data-metric]'); if (!b) return;
  state.metric = b.dataset.metric; update();
});
// 탭을 열 때(공명자 테마 색이 바뀌었을 수 있음) · 창 크기가 바뀔 때 그래프를 다시 그린다
const redrawIfShown = () => { if (document.body.dataset.tab === 'strategy') drawChart(); };
window.addEventListener('hashchange', () => setTimeout(redrawIfShown));
window.addEventListener('popstate', () => setTimeout(redrawIfShown));
$('appTabs').addEventListener('click', () => setTimeout(redrawIfShown));
new ResizeObserver(redrawIfShown).observe($('sgChartWrap'));

renderPresets();
update();
