// strategy.js — 명조 툴즈 v6.0: 강화 전략 계산 (유효옵 + 최소 수치 + 고정 옵션 + N개 이상 → 성공 확률 · 최적 강화 순서)
//
// 모델: 부옵션은 13종 중에서 중복 없이 균등하게 5칸이 열린다 (에코파고 확률 계산과 같음).
// 목표: "고정" 옵션은 전부 최소 수치 이상으로 떠야 하고, 유효옵(고정 포함)이 최소 수치 이상으로 N개 이상 뜨면 성공.
//   고정 옵션이 최소 수치 미만으로 뜨면 실패 확정. 고정이 아닌 유효옵이 미만으로 뜨면 그냥 꽝 한 칸.
// 성공한 에코도 결국 +25까지 다 열어야 쓰니까, 성공 비용은 5칸 전부. 버린 에코는 재료로 써서 환급을 받는다.
import { STAT_DATABASE, evaluateStepTier, valText } from './data.js';
import { ECHO_COST } from './math.js';
import { SLOT_COUNT as SLOTS } from './config.js';
import { store } from './util.js';

const POOL = Object.keys(STAT_DATABASE).length;
const EXP_CUM = [0];
for (const e of ECHO_COST.expPerSlot) EXP_CUM.push(EXP_CUM[EXP_CUM.length - 1] + e);

// 기준별 비용: open(k) = k칸 연 상태에서 다음 칸을 열 때 드는 양, spent(k) = k칸까지 쓴 양, refund = 버릴 때 돌려받는 비율, echo = 에코 1개 값
export const METRICS = {
  tuner: { label: '튜너', unit: '개', open: () => ECHO_COST.tunerPerSlot, spent: (k) => k * ECHO_COST.tunerPerSlot, refund: ECHO_COST.tunerRefund, echo: 0 },
  exp:   { label: '경험치', unit: '', open: (k) => ECHO_COST.expPerSlot[k], spent: (k) => EXP_CUM[k], refund: ECHO_COST.expRefund, echo: 0 },
  echo:  { label: '에코', unit: '개', open: () => 0, spent: () => 0, refund: 0, echo: 1 },
};

/** 최소 단계(1부터) 이상이 뜰 확률 */
export function passProb(key, minStep) {
  if (minStep <= 1) return 1;                               // 아무 수치 = 정확히 1 (더하면 0.9999…가 돼서 없는 상태가 생김)
  const probs = STAT_DATABASE[key].probs;
  return Math.min(1, probs.slice(minStep - 1).reduce((a, b) => a + b, 0));
}

/**
 * 목표 모델. 같은 종류(고정 여부 · 기준 이상 확률)의 옵션은 서로 바꿔도 결과가 같으니 묶어서 센다.
 * 상태 = { k: 연 칸 수, u: 묶음별 아직 안 뜬 개수, P: 기준 이상으로 뜬 유효옵 수 }
 * @param targets [{ key, minStep, req }]  유효옵 (req = 고정)
 * @param need 유효옵 몇 개 이상이면 성공인지
 */
export function makeModel(targets, need) {
  const map = new Map();
  const gi = [];                                           // 옵션별 묶음 번호 (stateOf에서 씀)
  for (const t of targets) {
    const q = passProb(t.key, t.minStep);
    const id = `${t.req ? 1 : 0}|${q}`;
    const g = map.get(id);
    if (g) g.size++; else map.set(id, { req: !!t.req, q, size: 1 });
    gi.push([...map.keys()].indexOf(id));
  }
  const groups = [...map.values()];
  const V = targets.length;
  const reqSize = groups.reduce((a, g) => a + (g.req ? g.size : 0), 0);
  const N = Math.max(need, reqSize);
  const start = { k: 0, u: groups.map((g) => g.size), P: 0 };
  const key = (s) => `${s.k}|${s.u.join(',')}|${s.P}`;
  const reqUnseen = (s) => s.u.reduce((a, n, i) => a + (groups[i].req ? n : 0), 0);
  const validUnseen = (s) => s.u.reduce((a, n) => a + n, 0);
  const success = (s) => reqUnseen(s) === 0 && s.P >= N;
  const feasible = (s) => Math.max(reqUnseen(s), N - s.P) <= SLOTS - s.k && N - s.P <= validUnseen(s);
  // 다음 칸 결과: [{ p, s }] (s = null 이면 실패 확정)
  function next(s) {
    const left = POOL - s.k;
    const seenValid = V - validUnseen(s);
    const other = (POOL - V) - (s.k - seenValid);          // 아직 안 뜬 "유효옵이 아닌 옵션" 수
    const out = [];
    if (other > 0) out.push({ p: other / left, s: { k: s.k + 1, u: s.u, P: s.P } });
    groups.forEach((g, i) => {
      const n = s.u[i]; if (!n) return;
      const u = s.u.slice(); u[i]--;
      if (g.q > 0) out.push({ p: (n * g.q) / left, s: { k: s.k + 1, u, P: s.P + 1 } });
      if (g.q < 1) out.push({ p: (n * (1 - g.q)) / left, s: g.req ? null : { k: s.k + 1, u, P: s.P } });   // 고정 옵션이 기준 미만이면 실패
    });
    return out;
  }
  const reqPassed = (s) => reqSize - reqUnseen(s);
  return { groups, gi, V, N, reqSize, start, key, success, feasible, next, reqPassed };
}

// 정책(policy(s) = 계속?)을 따라 에코 1개를 강화할 때: 성공 확률, 기준별 기대 비용(환급 전 · 후)
// start = 이미 몇 칸 연 상태에서 시작할 때 (에코파고). 비용은 처음부터 쓴 양 기준
export function evaluate(model, policy, start = model.start) {
  const res = { p: 0 };
  for (const m of Object.keys(METRICS)) res[m] = { gross: 0, net: 0 };
  const add = (prob, k, ok) => {
    for (const [m, M] of Object.entries(METRICS)) {
      const spent = ok ? M.spent(SLOTS) : M.spent(k);
      res[m].gross += prob * (spent + M.echo);
      res[m].net += prob * ((ok ? spent : spent * (1 - M.refund)) + M.echo);
    }
    if (ok) res.p += prob;
  };
  // 같은 상태로 가는 길을 합쳐서 한 번만 펼친다 (칸 수별로 차례대로)
  let layer = new Map([[model.key(start), { s: start, prob: 1 }]]);
  while (layer.size) {
    const nextLayer = new Map();
    for (const { s, prob } of layer.values()) {
      if (model.success(s)) { add(prob, s.k, true); continue; }
      if (s.k === SLOTS || !model.feasible(s) || !policy(s)) { add(prob, s.k, false); continue; }
      for (const n of model.next(s)) {
        if (!n.s) { add(prob * n.p, s.k + 1, false); continue; }
        const kk = model.key(n.s); const e = nextLayer.get(kk);
        if (e) e.prob += prob * n.p; else nextLayer.set(kk, { s: n.s, prob: prob * n.p });
      }
    }
    layer = nextLayer;
  }
  return res;
}

/**
 * 기준(metric)으로 성공 1개당 비용이 가장 적은 정책. 불가능하면 null
 * 반환 { policy, states: Map(key → { s, go, gain }), lambda }
 *   gain = 다음 칸을 열 때의 기대 손익 (지금 버리는 것 대비, 0보다 크면 계속), lambda = 성공 1개의 값 (= 성공 1개당 평균 비용)
 */
export function optimalPolicy(model, metric) {
  const M = METRICS[metric];
  // λ = 성공 1개의 가치. V = 지금 상태의 가치(이미 쓴 비용은 빼고, 버리면 환급만 받음)
  const solve = (L) => {
    const memo = new Map();
    const V = (s) => {
      if (model.success(s)) return L - (M.spent(SLOTS) - M.spent(s.k));
      const stop = M.refund * M.spent(s.k);
      if (s.k === SLOTS || !model.feasible(s)) return stop;
      const kk = model.key(s);
      let e = memo.get(kk);
      if (!e) {
        let cont = -M.open(s.k);
        for (const n of model.next(s)) cont += n.p * (n.s ? V(n.s) : M.refund * M.spent(s.k + 1));
        e = { s, cont }; memo.set(kk, e);
      }
      return Math.max(stop, e.cont);
    };
    return { start: V(model.start) - M.echo, memo };   // 새 에코 하나를 쓰는 비용(에코 기준)까지 빼고 0보다 크면 λ가 충분
  };
  let hi = 1;
  while (solve(hi).start <= 0) { hi *= 4; if (hi > 1e15) return null; }
  let lo = 0;
  for (let it = 0; it < 80; it++) { const mid = (lo + hi) / 2; if (solve(mid).start > 0) hi = mid; else lo = mid; }
  const states = new Map();
  for (const [kk, { s, cont }] of solve(hi).memo) {
    const gain = cont - M.refund * M.spent(s.k);
    states.set(kk, { s, go: gain >= -1e-9, gain });
  }
  // 에코 기준은 칸을 여는 게 공짜라 "불가능해질 때까지 연다"와 같다
  return { policy: (s) => states.get(model.key(s))?.go ?? true, states, lambda: hi };
}

/** 다 까기: 실패 확정이어도 +25까지 다 연다 */
function evaluateOpenAll(model) {
  const p = evaluate(model, () => true).p;      // 성공 확률은 "불가능하면 버림"과 같다
  const res = { p };
  for (const [m, M] of Object.entries(METRICS)) {
    const spent = M.spent(SLOTS);
    res[m] = { gross: spent + M.echo, net: p * spent + (1 - p) * spent * (1 - M.refund) + M.echo };
  }
  return res;
}

/**
 * 목표 준비: 모델 + 최적 정책 + 그 정책의 평균값. 불가능한 목표면 null (강화 전략 · 튜닝 연습장 · 에코파고가 같이 쓴다)
 * @param targets [{ key, minStep, req }], need 유효 몇 개 이상, metric 'tuner' | 'exp' | 'echo'
 */
export function makePlan(targets, need, metric = 'tuner') {
  if (!targets?.length) return null;
  const model = makeModel(targets, need);
  if (model.N > SLOTS || model.N > model.V || model.groups.some((g) => g.req && g.q <= 0)) return null;
  const opt = optimalPolicy(model, metric);
  if (!opt) return null;
  const best = evaluate(model, opt.policy);
  if (!(best.p > 0)) return null;
  return { targets, need, metric, model, opt, policy: opt.policy, best };
}

/**
 * 강화 전략 탭: 최적 전략 + 비교용 두 전략
 * @returns null(불가능) 또는 { model, best, untilDead, openAll, rules }
 */
export function analyze(targets, need, metric) {
  const p = makePlan(targets, need, metric);
  if (!p) return null;
  return { model: p.model, best: p.best, untilDead: evaluate(p.model, () => true), openAll: evaluateOpenAll(p.model), rules: rulesOf(p.model, p.opt) };
}

/** 지금 에코 상태 opened = [{ key, step }] → 모델 상태. 고정 옵션이 기준 미만이면 null(실패 확정) */
export function stateOf(plan, opened) {
  const { model, targets } = plan;
  const u = model.groups.map((g) => g.size);
  let P = 0;
  for (const s of opened) {
    const i = targets.findIndex((t) => t.key === s.key);
    if (i < 0) continue;
    u[model.gi[i]]--;
    if (s.step >= targets[i].minStep) P++;
    else if (targets[i].req) return null;
  }
  return { k: opened.length, u, P };
}

// ───────── 에코파고 목표 → 이 모델 ─────────
/** 등급 컷(1 하옵 · 2 중옵 · 3 상옵) 이상이 되는 가장 낮은 단계 */
export function cutStep(key, cutScore) {
  const n = STAT_DATABASE[key].values.length;
  let step = 1;
  while (step < n && evaluateStepTier(step, n).score < cutScore) step++;
  return step;
}
/** 크크 + N유효 = 크확 · 크피 고정 + 유효 2+N개 이상, 서포터 N유효 = 고정 없이 N개 이상 */
export function echoGoal(goal, keys, cutScore) {
  const crit = goal.type === 'crit';
  return {
    targets: keys.map((key) => ({ key, minStep: cutStep(key, cutScore), req: crit && (key === '크확' || key === '크피') })),
    need: crit ? 2 + goal.req : goal.req,
  };
}

// 사람이 읽을 전략표: rows[k][P] = null(나올 수 없음) | { kind: 'go' | 'stop' | 'mixed', byReq: Map(고정 뜬 수 → 'go'|'stop'|'mixed') }
//   k = 연 칸 수(0~4), P = 기준 이상으로 뜬 유효옵 수(0 ~ N-1)
export function rulesOf(model, opt) {
  const rows = Array.from({ length: SLOTS }, () => Array(model.N).fill(null));
  for (const { s, go } of opt.states.values()) {
    if (s.k >= SLOTS || s.P >= model.N || !model.feasible(s)) continue;
    const cell = rows[s.k][s.P] ??= { byReq: new Map() };
    const r = model.reqPassed(s);
    const prev = cell.byReq.get(r);
    cell.byReq.set(r, prev === undefined ? (go ? 'go' : 'stop') : prev === (go ? 'go' : 'stop') ? prev : 'mixed');
  }
  for (const row of rows) for (const cell of row) {
    if (!cell) continue;
    const kinds = new Set(cell.byReq.values());
    cell.kind = kinds.size === 1 ? [...kinds][0] : 'mixed';
  }
  return rows;
}

// ───────── 목표 문장 (강화 전략 탭 · 튜닝 연습장) ─────────
export const nameOf = (t) => STAT_DATABASE[t.key].name + (t.minStep > 1 ? ` ${valText(t.key, t.minStep)}↑` : '');
/** "크리티컬 확률 · 크리티컬 피해 고정 + 나머지 2개(공명 효율 · 공격력%) 중 1개 이상". em = 강조할 부분을 감쌀 함수 */
export function goalText({ targets, need }, em = (t) => t) {
  const req = targets.filter((t) => t.req), rest = targets.filter((t) => !t.req);
  const more = need - req.length;
  const reqPart = req.length ? `${em(req.map(nameOf).join(' · '))} 고정` : '';
  if (more <= 0) return req.length === targets.length ? `${reqPart} (전부)` : reqPart;
  const restPart = `${req.length ? '나머지 ' : ''}${rest.length}개(${rest.map(nameOf).join(' · ')}) 중 ${em(`${more}개`)}${more === rest.length ? ' (전부)' : ' 이상'}`;
  return req.length ? `${reqPart} + ${restPart}` : restPart;
}

// ───────── 목표 저장값 (강화 전략 탭 · 튜닝 연습장이 같이 읽는다) ─────────
export const GOAL_KEY = 'echopago.strategy.v1';
// 처음 열었을 때 기본 목표: 크크 고정 + 공효 · 공% 중 1
const DEFAULT_GOAL = { keys: ['크확', '크피', '공효', '공%'], req: ['크확', '크피'], need: 3 };

/** 저장된 목표 { targets, need, metric } (없거나 깨졌으면 기본 목표) */
export function loadGoal() {
  const s = store.getJSON(GOAL_KEY);
  const oldFormat = s && !('need' in s);                     // 예전 저장(전부 고정)은 그대로 살린다
  const targets = (Array.isArray(s?.targets) ? s.targets : [])
    .filter((t) => STAT_DATABASE[t?.key])
    .map((t) => ({ key: t.key, minStep: Math.min(Math.max(1, t.minStep | 0), STAT_DATABASE[t.key].values.length), req: oldFormat ? true : !!t.req }))
    .filter((t, i, a) => a.findIndex((x) => x.key === t.key) === i);
  const st = s ? { targets, need: oldFormat ? targets.length : s.need | 0 }
    : { targets: DEFAULT_GOAL.keys.map((key) => ({ key, minStep: 1, req: DEFAULT_GOAL.req.includes(key) })), need: DEFAULT_GOAL.need };
  st.metric = METRICS[s?.metric] ? s.metric : 'tuner';
  clampNeed(st);
  return st;
}
// 고정 옵션은 5개까지, 몇 개 이상은 [고정 개수(최소 1) ~ min(5, 유효 개수)]
export function clampNeed(st) {
  let req = st.targets.filter((t) => t.req);
  while (req.length > SLOTS) { req.at(-1).req = false; req = st.targets.filter((t) => t.req); }
  const lo = Math.max(1, req.length), hi = Math.min(SLOTS, st.targets.length);
  st.need = Math.min(Math.max(st.need || hi, lo), Math.max(lo, hi));
}
