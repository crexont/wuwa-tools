// practice-ui.js — 명조 툴즈 v6.0: 튜닝 연습장 탭 화면
// 재화는 무제한. [강화]를 누르면 다음 칸이 실제 확률대로 열리고, 추천(강화 전략 최적 순서)을 옆에 보여준다.
// 목표는 강화 전략 탭 저장값(echopago.strategy.v1)을 그대로 쓴다 → 공명자를 고르거나 강화 전략 탭에서 고치면 같이 바뀜.
import { STAT_DATABASE, evaluateStepTier } from './data.js';
import { METRICS } from './strategy.js';
import { prepare, rollSlot, verdict, echoCost, expectedPerSuccess, SLOTS } from './practice.js';

const $ = (id) => document.getElementById(id);
const page = $('practicePage');
const GOAL_KEY = 'echopago.strategy.v1';
const KEY = 'echopago.practice.v1';
const KEPT_MAX = 12;
// 강화 전략 탭을 한 번도 안 열었을 때 기본 목표 (strategy-ui.js DEFAULT_GOAL과 같음)
const DEFAULT_GOAL = { targets: [{ key: '크확', minStep: 1, req: true }, { key: '크피', minStep: 1, req: true }, { key: '공효', minStep: 1, req: false }, { key: '공%', minStep: 1, req: false }], need: 3, metric: 'tuner' };

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 무시 */ } },
};
const statIcon = (key) => `<i class="stat-icon" style="--icon:url('./icons/${STAT_DATABASE[key].icon}.png')" aria-hidden="true"></i>`;
const valText = (key, step) => `+${STAT_DATABASE[key].values[step - 1]}${STAT_DATABASE[key].isPercent ? '%' : ''}`;
const fmtInt = (n) => Math.round(n).toLocaleString('ko-KR');
const fmtExp = (n) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 1e6 ? 0 : 1)}만` : fmtInt(n));

let plan = null;      // practice.js prepare 결과
let rec = null;       // 기록 { sig, done, echoes, tuner, exp, follow, decisions, kept: [[{key,step}]], cur: [{key,step}], hint }
let lastNew = -1;     // 방금 열린 칸 (깜빡임용)

// ───────── 목표 ─────────
function readGoal() {
  const s = store.get(GOAL_KEY);
  const targets = (Array.isArray(s?.targets) ? s.targets : []).filter((t) => STAT_DATABASE[t?.key])
    .map((t) => ({ key: t.key, minStep: Math.max(1, t.minStep | 0), req: !!t.req }));
  if (!s || !targets.length) return DEFAULT_GOAL;
  return { targets, need: 'need' in s ? s.need | 0 : targets.length, metric: METRICS[s.metric] ? s.metric : 'tuner' };
}
const sigOf = (g) => JSON.stringify([g.targets.map((t) => [t.key, t.minStep, t.req ? 1 : 0]), g.need, g.metric]);
const nameOf = (t) => STAT_DATABASE[t.key].name + (t.minStep > 1 ? ` ${valText(t.key, t.minStep)}↑` : '');
function goalText(g) {
  const req = g.targets.filter((t) => t.req), rest = g.targets.filter((t) => !t.req);
  const more = g.need - req.length;
  const parts = [];
  if (req.length) parts.push(`<b>${req.map(nameOf).join(' · ')}</b> 고정`);
  if (more > 0) parts.push(`${req.length ? '나머지 ' : ''}${rest.map(nameOf).join(' · ')} 중 <b>${more}개</b>${more === rest.length ? '' : ' 이상'}`);
  return parts.join(' + ');
}

function newRecord(sig) {
  return { sig, done: 0, echoes: 0, tuner: 0, exp: 0, follow: 0, decisions: 0, kept: [], cur: [], hint: rec?.hint ?? true };
}
const save = () => store.set(KEY, rec);

// 목표가 바뀌면(공명자 선택 · 강화 전략 탭 수정) 기록을 새로 시작한다
function syncGoal() {
  const g = readGoal();
  const sig = sigOf(g);
  if (plan && rec?.sig === sig) return;
  plan = prepare(g.targets, g.need, g.metric);
  $('prGoal').innerHTML = plan
    ? `목표 ${goalText(g)} <span class="pr-goal-src">· <a href="#strategy">강화 전략</a>에서 바꿀 수 있어요</span>`
    : `이 목표는 완성할 수 없어요. <a href="#strategy">강화 전략</a>에서 목표를 바꿔 주세요.`;
  if (!rec || rec.sig !== sig) {
    const changed = !!rec;
    rec = newRecord(sig);
    save();
    if (changed) flashNote('목표가 바뀌어서 기록을 새로 시작했어요.');
  }
  render();
}

let noteTimer = 0;
function flashNote(text) {
  const el = $('prNote');
  el.textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { el.textContent = ''; }, 3000);
}

// ───────── 동작 ─────────
const current = () => (plan ? verdict(plan, rec.cur) : 'dead');

function countDecision(choseGo) {
  const v = current();
  if (v !== 'go' && v !== 'stop') return;
  rec.decisions++;
  if ((v === 'go') === choseGo) rec.follow++;
}

function upgrade() {
  if (!plan) return;
  const v = current();
  if (v === 'done') { finishEcho(true); return; }
  if (rec.cur.length >= SLOTS) return;
  countDecision(true);
  rec.cur.push(rollSlot(rec.cur));
  lastNew = rec.cur.length - 1;
  // 완성되면 남은 칸도 마저 연다 (완성 에코는 +25까지 다 열어서 쓰니까 비용도 5칸)
  if (current() === 'done') while (rec.cur.length < SLOTS) rec.cur.push(rollSlot(rec.cur));
  save();
  render();
}

function drop() {
  if (!plan || current() === 'done' || !rec.cur.length) return;
  countDecision(false);
  finishEcho(false);
}

function finishEcho(kept) {
  const c = echoCost(rec.cur.length, kept);
  rec.tuner += c.tuner;
  rec.exp += c.exp;
  rec.echoes++;
  if (kept) {
    rec.done++;
    rec.kept.unshift(rec.cur);
    rec.kept.length = Math.min(rec.kept.length, KEPT_MAX);
  }
  rec.cur = [];
  lastNew = -1;
  save();
  render();
}

// ───────── 그리기 ─────────
function slotRow(s, i) {
  const t = plan?.targets.find((x) => x.key === s.key);
  const d = STAT_DATABASE[s.key];
  const tier = evaluateStepTier(s.step, d.values.length);
  const valid = t && s.step >= t.minStep;
  const low = t && !valid;
  return `<div class="stat-item${valid ? ' is-valid' : ''}${i === lastNew ? ' pr-new' : ''}">
    <div class="stat-name">${statIcon(s.key)}<span>${d.name}</span><span class="stat-val">${valText(s.key, s.step)}</span>
      ${valid ? '<span class="valid-mark">유효</span>' : ''}${low ? `<span class="stat-warn">기준 미달${t.req ? ' (고정)' : ''}</span>` : ''}</div>
    <div><span class="tier-badge ${tier.class}">${tier.label}</span></div></div>`;
}

const HINTS = {
  go: (k) => ({ cls: 'is-go', text: k ? '추천: <b>계속 강화</b>' : '추천: <b>강화</b>', sub: '' }),
  stop: () => ({ cls: 'is-stop', text: '추천: <b>버리기</b>', sub: '여기서 버리고 새 에코를 키우는 게 평균적으로 더 아껴요.' }),
  dead: (k) => ({ cls: 'is-stop', text: k >= SLOTS ? '다 열었지만 <b>완성 못 했어요</b>' : '더 열어도 <b>완성할 수 없어요</b>', sub: '버리고 재료로 쓰면 튜너 30% · 경험치 75%를 돌려받아요.' }),
  done: () => ({ cls: 'is-done', text: '<b>완성!</b>', sub: '완성 에코는 +25까지 다 연 것으로 계산해요.' }),
};

function render() {
  const cur = rec.cur;
  const v = current();
  $('prLevel').textContent = `+${cur.length * 5}`;
  const spent = echoCost(cur.length, true);
  $('prSpent').textContent = cur.length ? `이 에코: 튜너 ${spent.tuner} · 경험치 ${fmtExp(spent.exp)}` : '';
  let html = cur.map(slotRow).join('');
  for (let i = cur.length; i < SLOTS; i++) {
    html += `<div class="stat-item stat-item-blank${i === cur.length && v !== 'done' ? ' pr-next' : ''}"><div class="stat-name"><span class="blank-lock"></span><span class="blank-label">+${(i + 1) * 5}까지 강화 시 해금</span></div></div>`;
  }
  $('prSlots').innerHTML = html;

  // 추천 줄: 완성은 항상, 나머지는 [추천 보기]를 켰을 때만
  const hintBox = $('prHint');
  const showHint = plan && (v === 'done' || rec.hint);
  hintBox.hidden = !showHint;
  if (showHint) {
    const h = HINTS[v](cur.length);
    hintBox.className = `pr-hint ${h.cls}`;
    hintBox.innerHTML = `<span>${h.text}</span>${h.sub ? `<small>${h.sub}</small>` : ''}`;
  }
  $('prHintToggle').checked = rec.hint;

  const up = $('prUp'), dn = $('prDrop');
  up.textContent = v === 'done' ? '보관하고 새 에코' : cur.length ? `강화 +${(cur.length + 1) * 5}` : '강화 +5';
  up.disabled = !plan || (v !== 'done' && cur.length >= SLOTS);
  dn.disabled = !plan || v === 'done' || !cur.length;
  renderRecord();
}

function renderRecord() {
  const exp = plan ? expectedPerSuccess(plan) : null;
  const metricLabel = plan ? METRICS[plan.metric].label : '튜너';
  $('prStats').innerHTML = [
    ['완성', `${rec.done}<small>개</small>`],
    ['쓴 에코', `${rec.echoes}<small>개</small>`],
    ['튜너', fmtInt(rec.tuner)],
    ['경험치', fmtExp(rec.exp)],
  ].map(([k, v]) => `<div class="pr-stat"><span>${k}</span><b>${v}</b></div>`).join('');

  let cmp = '';
  if (exp) {
    const mine = rec.done ? rec.tuner / rec.done : null;
    let luck = '';
    if (mine != null) {
      const r = mine / exp.tuner - 1;
      luck = Math.abs(r) < 0.05 ? '<span>딱 평균이에요</span>'
        : r < 0 ? `<span class="is-good">평균보다 ${Math.round(-r * 100)}% 덜 썼어요 · 운 좋음</span>`
          : `<span class="is-bad">평균보다 ${Math.round(r * 100)}% 더 썼어요 · 운 나쁨</span>`;
    }
    cmp = `<table class="sg-cmp pr-cmp"><thead><tr><th></th><th>나</th><th>추천대로 한 평균</th></tr></thead><tbody>
      <tr><th>완성 1개당 튜너</th><td class="is-key">${mine != null ? fmtInt(mine) : '-'}</td><td>${fmtInt(exp.tuner)}</td></tr>
      <tr><th>완성 1개당 경험치</th><td class="is-key">${rec.done ? fmtExp(rec.exp / rec.done) : '-'}</td><td>${fmtExp(exp.exp)}</td></tr>
      <tr><th>완성 1개당 에코</th><td class="is-key">${rec.done ? (rec.echoes / rec.done).toFixed(1) : '-'}</td><td>${exp.echo.toFixed(1)}</td></tr>
      </tbody></table>
      <p class="pr-luck">${luck || `에코 하나가 완성될 확률은 <b>${(exp.p * 100).toFixed(2)}%</b>예요.`}</p>
      <p class="sg-note">추천 = 강화 전략 탭의 "${metricLabel} 아끼기" 순서. 추천과 같은 선택 ${rec.decisions ? `${Math.round((rec.follow / rec.decisions) * 100)}% (${rec.follow}/${rec.decisions})` : '-'}</p>`;
  }
  $('prCompare').innerHTML = cmp;

  $('prKept').innerHTML = rec.kept.length
    ? rec.kept.map((slots, i) => `<div class="pr-kept-row"><span class="pr-kept-no">#${rec.done - i}</span>${slots.map((s) => {
      const t = plan?.targets.find((x) => x.key === s.key);
      const valid = t && s.step >= t.minStep;
      return `<span class="pr-kept-stat${valid ? ' is-valid' : ''}" title="${STAT_DATABASE[s.key].name} ${valText(s.key, s.step)}">${statIcon(s.key)}${valText(s.key, s.step)}</span>`;
    }).join('')}</div>`).join('')
    : '<p class="pm-empty">아직 완성한 에코가 없어요.</p>';
}

// ───────── 시작 ─────────
function init() {
  rec = store.get(KEY);
  if (rec && !Array.isArray(rec.cur)) rec = null;
  syncGoal();

  $('prUp').addEventListener('click', upgrade);
  $('prDrop').addEventListener('click', drop);
  $('prHintToggle').addEventListener('change', (e) => { rec.hint = e.target.checked; save(); render(); });
  $('prReset').addEventListener('click', () => {
    if (!confirm('기록을 지울까요? (완성 개수 · 쓴 재화 · 보관한 에코)')) return;
    rec = newRecord(rec.sig);
    save();
    render();
  });
  // 공명자를 고르면 강화 전략 탭이 목표를 먼저 바꾸고 저장하니까, 그 다음에 다시 읽는다
  window.addEventListener('roleselect', () => setTimeout(syncGoal, 0));
  window.addEventListener('hashchange', () => { if (location.hash === '#practice') syncGoal(); });
  window.addEventListener('popstate', () => { if (location.hash === '#practice') syncGoal(); });
  $('appTabs').addEventListener('click', () => setTimeout(() => { if (document.body.dataset.tab === 'practice') syncGoal(); }, 0));

  // 단축키: Space · Enter = 강화, X = 버리기 (연습장 탭에서만)
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.tab !== 'practice' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, button, a, [contenteditable]') && e.target !== document.body) return;
    if (document.body.classList.contains('modal-lock')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!$('prUp').disabled) upgrade(); }
    else if (e.key === 'x' || e.key === 'X' || e.key === 'ㅌ') { e.preventDefault(); if (!$('prDrop').disabled) drop(); }
  });
}

if (page) init();
