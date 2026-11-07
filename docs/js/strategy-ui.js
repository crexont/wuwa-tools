// strategy-ui.js — 명조 툴즈 v6.0: 강화 전략 탭 화면 (유효옵 · 고정 옵션 · N개 이상 → 확률 · 가장 싼 강화 순서 · 그래프)
import { STAT_DATABASE, evaluateStepTier } from './data.js';
import { analyze, passProb, METRICS } from './strategy.js';

const $ = (id) => document.getElementById(id);
const KEY = 'echopago.strategy.v1';
const SLOTS = 5;
const KEYS = Object.keys(STAT_DATABASE);
// 처음 열었을 때 기본 목표: 크크 고정 + 공효 · 공% 중 1
const DEFAULT_GOAL = { keys: ['크확', '크피', '공효', '공%'], req: ['크확', '크피'], need: 3 };
const METRIC_HINT = {
  tuner: '튜너가 가장 적게 드는 순서. 에코파고의 "튜너 아끼기"와 같은 기준이에요.',
  exp: '경험치(에코 재료)가 가장 적게 드는 순서예요.',
  echo: '에코를 가장 적게 버리는 순서예요. 성공할 수 있는 동안은 끝까지 열어요.',
};
const statIcon = (key) => `<i class="stat-icon" style="--icon:url('./icons/${STAT_DATABASE[key].icon}.png')" aria-hidden="true"></i>`;
const valText = (key, v) => `+${v}${STAT_DATABASE[key].isPercent ? '%' : ''}`;
const nameOf = (t) => STAT_DATABASE[t.key].name + (t.minStep > 1 ? ` ${valText(t.key, STAT_DATABASE[t.key].values[t.minStep - 1])}↑` : '');

// ───────── 저장 ─────────
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* 무시 */ }
  const oldFormat = s && !('need' in s);                     // 예전 저장(전부 고정)은 그대로 살린다
  const targets = (Array.isArray(s?.targets) ? s.targets : [])
    .filter((t) => STAT_DATABASE[t?.key])
    .map((t) => ({ key: t.key, minStep: Math.min(Math.max(1, t.minStep | 0), STAT_DATABASE[t.key].values.length), req: oldFormat ? true : !!t.req }))
    .filter((t, i, a) => a.findIndex((x) => x.key === t.key) === i);
  const st = s ? { targets, need: oldFormat ? targets.length : s.need | 0 } : { ...presetState(DEFAULT_GOAL) };
  st.metric = METRICS[s?.metric] ? s.metric : 'tuner';
  clampNeed(st);
  return st;
}
function presetState(p) {
  return { targets: p.keys.map((key) => ({ key, minStep: 1, req: p.req.includes(key) })), need: p.need };
}
// 고정 옵션은 5개까지, 몇 개 이상은 [고정 개수(최소 1) ~ min(5, 유효 개수)]
function clampNeed(st) {
  let req = st.targets.filter((t) => t.req);
  while (req.length > SLOTS) { req.at(-1).req = false; req = st.targets.filter((t) => t.req); }
  const lo = Math.max(1, req.length), hi = Math.min(SLOTS, st.targets.length);
  st.need = Math.min(Math.max(st.need || hi, lo), Math.max(lo, hi));
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

// 목표를 한 줄 문장으로: "크리티컬 확률 · 크리티컬 피해 고정 + 나머지 2개(공명 효율 · 공격력%) 중 1개"
function goalText() {
  const req = state.targets.filter((t) => t.req), rest = state.targets.filter((t) => !t.req);
  const more = state.need - req.length;
  const reqPart = req.length ? `${req.map(nameOf).join(' · ')} 고정` : '';
  if (more <= 0) return req.length === state.targets.length ? `${reqPart} (전부)` : reqPart;
  const restPart = `${req.length ? '나머지 ' : ''}${rest.length}개(${rest.map(nameOf).join(' · ')}) 중 ${more}개${more === rest.length ? ' (전부)' : ' 이상'}`;
  return req.length ? `${reqPart} + ${restPart}` : restPart;
}

// ───────── 왼쪽: 목표 고르기 ─────────
function renderChips() {
  const chosen = new Set(state.targets.map((t) => t.key));
  $('sgChips').innerHTML = KEYS.map((key) => `
    <label class="filter-chip"><input type="checkbox" value="${key}" ${chosen.has(key) ? 'checked' : ''}>
    ${statIcon(key)}${STAT_DATABASE[key].name}</label>`).join('');
}
function renderTargets() {
  const box = $('sgTargets');
  if (!state.targets.length) { box.innerHTML = '<p class="sg-empty">위에서 유효옵을 골라 주세요.</p>'; $('sgNeedRow').hidden = true; return; }
  const reqCount = state.targets.filter((t) => t.req).length;
  box.innerHTML = `<div class="sg-target sg-target-head"><span>유효옵</span><span>최소 수치</span><span title="반드시 떠야 하는 옵션">고정</span><span></span></div>` + state.targets.map((t, i) => {
    const d = STAT_DATABASE[t.key];
    const opts = d.values.map((v, s) => {
      const tier = evaluateStepTier(s + 1, d.values.length).label;
      return `<option value="${s + 1}" ${s + 1 === t.minStep ? 'selected' : ''}>${s === 0 ? '아무 수치' : `${valText(t.key, v)} 이상 · ${tier} · ${fmtPct(passProb(t.key, s + 1))}%`}</option>`;
    }).join('');
    return `<div class="sg-target ${t.req ? 'is-req' : ''}">
      <span class="sg-target-name">${statIcon(t.key)}${d.name}</span>
      <select class="cutoff-select" data-min="${i}" aria-label="${d.name} 최소 수치">${opts}</select>
      <button type="button" class="sg-req" data-req="${i}" aria-pressed="${t.req}" ${!t.req && reqCount >= SLOTS ? 'disabled' : ''} title="반드시 떠야 하는 옵션">고정</button>
      <button type="button" class="sg-x" data-remove="${i}" aria-label="${d.name} 빼기">✕</button>
    </div>`;
  }).join('');
  // 몇 개 이상
  const lo = Math.max(1, reqCount), hi = Math.min(SLOTS, state.targets.length);
  $('sgNeedRow').hidden = false;
  $('sgNeed').innerHTML = Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i).map((n) => `<option value="${n}" ${n === state.need ? 'selected' : ''}>${n}개 이상</option>`).join('') || `<option>${lo}개 이상</option>`;
  $('sgNeed').disabled = hi <= lo;
  $('sgGoalText').textContent = goalText();
}
function renderMetric() {
  for (const b of $('sgMetric').querySelectorAll('[data-metric]')) b.setAttribute('aria-pressed', b.dataset.metric === state.metric);
  $('sgMetricHint').textContent = METRIC_HINT[state.metric];
}

// ───────── 오른쪽: 결과 ─────────
let last = null;
function renderResult() {
  const res = state.targets.length ? analyze(state.targets, state.need, state.metric) : null;
  last = res;
  const out = $('sgResult');
  if (!res) {
    out.innerHTML = `<p class="sg-empty">${state.targets.length ? '이 목표는 나올 수 없어요. (5칸에 다 들어가지 않아요)' : '유효옵을 고르면 계산해 드려요.'}</p>`;
    $('sgCompare').innerHTML = ''; drawChart(); return;
  }
  const b = res.best;
  out.innerHTML = `
    <div class="sg-goal">${goalText()}</div>
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
    <p class="sg-note">유효옵은 최소 수치 이상으로 뜬 것만 세요. ${res.model.reqSize ? '고정 옵션이 최소 수치보다 낮게 뜨면 그 에코는 바로 버려요. (같은 옵션은 다시 안 뜨니까) ' : ''}고정이 아닌 유효옵이 낮게 뜨면 꽝 한 칸으로 쳐요.</p>`;
  renderCompare(res);
  drawChart();
}

// 순서표: 행 = 연 칸 수, 열 = 기준 이상으로 뜬 유효옵 수. 고정 옵션이 몇 개냐에 따라 갈리면 그걸 적는다
function rulesTable(res) {
  const N = res.model.N, hasReq = res.model.reqSize > 0;
  const word = { go: '계속', stop: '버림', mixed: '옵션 따라' };
  const head = Array.from({ length: N }, (_, c) => `<th>${c}개</th>`).join('');   // N개 다 뜨면 이미 성공이라 열이 필요 없음
  const rows = res.rules.map((cells, k) => {
    const label = k === 0 ? '처음 (0칸)' : `${k}칸 연 뒤`;
    const tds = cells.map((cell, c) => {
      if (!cell) return '<td class="sg-na">-</td>';
      if (cell.kind !== 'mixed') return `<td class="sg-${cell.kind}">${word[cell.kind]}</td>`;
      const td = (main, sub) => `<td class="sg-mixed" title="${main} · ${sub}">${main}<small>${sub}</small></td>`;
      if (!hasReq || cell.byReq.size === 1) return td('옵션 따라', '어떤 옵션이 몇 수치로 떴는지에 따라 달라요');
      const sorted = [...cell.byReq].sort((a, b) => a[0] - b[0]);
      // 고정 옵션이 x개 이상이면 계속, 미만이면 버림 → 뜬 개수(c)에 맞는 말로
      const cut = sorted.findIndex(([, kd]) => kd === 'go');
      const simple = cut > 0 && sorted.slice(0, cut).every(([, kd]) => kd === 'stop') && sorted.slice(cut).every(([, kd]) => kd === 'go');
      if (simple) {
        const x = sorted[cut][0];
        if (x === c) return td(c === 1 ? '고정 옵션이면 계속' : '전부 고정 옵션이면 계속', '아니면 버림');
        if (x === 1) return td('고정 옵션이 있으면 계속', '없으면 버림');
        return td(`고정 옵션 ${x}개 이상이면 계속`, '아니면 버림');
      }
      return td('고정 옵션 개수 따라', sorted.reverse().map(([r, kd]) => `고정 ${r}개: ${word[kd]}`).join(' · '));
    }).join('');
    return `<tr><th>${label}</th>${tds}</tr>`;
  }).join('');
  return `<div class="sg-rules-wrap"><table class="sg-rules"><thead><tr><th>열린 칸 ＼ 뜬 유효옵</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}


const STRATS = [
  { id: 'best', label: '추천 순서', desc: '위 순서표대로 강화' },
  { id: 'untilDead', label: '될 때까지 강화', desc: '성공할 가능성이 남아 있으면 계속' },
  { id: 'openAll', label: '무조건 +25', desc: '실패가 정해져도 끝까지 강화' },
];
function renderCompare(res) {
  $('sgCompare').innerHTML = `<table class="sg-cmp"><thead><tr><th>강화 방법</th><th>성공 확률</th><th>튜너</th><th>경험치</th><th>에코 수</th></tr></thead><tbody>
    ${STRATS.map((s) => { const r = res[s.id]; return `<tr class="${s.id === 'best' ? 'is-best' : ''}"><th>${s.label}<small>${s.desc}</small></th><td>${fmtPct(r.p)}%</td>
      ${['tuner', 'exp', 'echo'].map((m) => `<td class="${m === state.metric ? 'is-key' : ''}">${fmtCost(m, perSuccess(r, m))}</td>`).join('')}</tr>`; }).join('')}
  </tbody></table><p class="sg-note">성공 확률은 에코 1개 기준, 튜너 · 경험치 · 에코 수는 성공 1개를 얻을 때까지 드는 평균이에요.</p>`;
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

  // 곡선: 무조건 +25 → 될 때까지 강화 → 추천 순서 (위에 그릴수록 강조)
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
function update() { clampNeed(state); save(); renderChips(); renderTargets(); renderMetric(); renderResult(); }

// 공명자를 고르면(에코파고 · 강화 전략 어느 탭에서든) 그 공명자 추천 유효옵으로 목표를 채운다
//   딜러(크확 · 크피 둘 다 유효) = 크크 고정 + 유효 3개 이상(크크 + 1유효), 서포터 = 고정 없이 2개 이상(서포터 2유효)
window.addEventListener('roleselect', (e) => {
  const role = e.detail;
  if (!role) { setRoleNote(''); return; }
  const dealer = role.targets.includes('크확') && role.targets.includes('크피');
  state.targets = role.targets.filter((key) => STAT_DATABASE[key]).map((key) => ({ key, minStep: 1, req: dealer && (key === '크확' || key === '크피') }));
  state.need = dealer ? 3 : 2;
  update();
  setRoleNote(`${role.name} 추천 유효옵으로 채웠어요 (${dealer ? '크크 고정 + 1유효' : '서포터 2유효'}). 아래에서 더 고칠 수 있어요.`);
});
function setRoleNote(text) { $('sgRoleNote').textContent = text || ''; }
// 목표를 직접 고치면 안내 문구를 지운다
for (const id of ['sgChips', 'sgTargets', 'sgNeed']) $(id).addEventListener('change', () => setRoleNote(''));
$('sgTargets').addEventListener('click', (e) => { if (e.target.closest('[data-remove], [data-req]')) setRoleNote(''); });
$('sgChips').addEventListener('change', (e) => {
  const key = e.target.value;
  if (e.target.checked) state.targets.push({ key, minStep: 1, req: false });
  else state.targets = state.targets.filter((t) => t.key !== key);
  update();
});
$('sgTargets').addEventListener('change', (e) => {
  const i = e.target.dataset.min; if (i === undefined) return;
  state.targets[+i].minStep = +e.target.value; update();
});
$('sgTargets').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) { state.targets.splice(+rm.dataset.remove, 1); update(); return; }
  const rq = e.target.closest('[data-req]');
  if (rq) { const t = state.targets[+rq.dataset.req]; t.req = !t.req; if (t.req) state.need = Math.max(state.need, state.targets.filter((x) => x.req).length); update(); }
});
$('sgNeed').addEventListener('change', (e) => { state.need = +e.target.value; update(); });
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

update();
