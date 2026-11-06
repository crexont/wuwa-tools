// strategy.js — 명조 툴즈 v6.0: 강화 전략 계산 (유효옵 + 최소 수치 + 꼭 필요한 옵션 + N개 이상 → 성공 확률 · 최적 강화 순서)
//
// 모델: 부옵션은 13종 중에서 중복 없이 균등하게 5칸이 열린다 (에코파고 확률 계산과 같음).
// 목표: "꼭" 옵션은 전부 최소 수치 이상으로 떠야 하고, 유효옵(꼭 포함)이 최소 수치 이상으로 N개 이상 뜨면 성공.
//   꼭 옵션이 최소 수치 미만으로 뜨면 실패 확정. 꼭이 아닌 유효옵이 미만으로 뜨면 그냥 꽝 한 칸.
// 성공한 에코도 결국 +25까지 다 열어야 쓰니까, 성공 비용은 5칸 전부. 버린 에코는 재료로 써서 환급을 받는다.
import { STAT_DATABASE } from './data.js';
import { ECHO_COST } from './math.js';

const POOL = 13, SLOTS = 5;
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
 * 목표 모델. 같은 종류(꼭 여부 · 기준 이상 확률)의 옵션은 서로 바꿔도 결과가 같으니 묶어서 센다.
 * 상태 = { k: 연 칸 수, u: 묶음별 아직 안 뜬 개수, P: 기준 이상으로 뜬 유효옵 수 }
 * @param targets [{ key, minStep, req }]  유효옵 (req = 꼭 필요)
 * @param need 유효옵 몇 개 이상이면 성공인지
 */
export function makeModel(targets, need) {
  const map = new Map();
  const gi = [];                                           // 옵션별 묶음 번호 (테스트용)
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
      if (g.q < 1) out.push({ p: (n * (1 - g.q)) / left, s: g.req ? null : { k: s.k + 1, u, P: s.P } });   // 꼭 옵션이 기준 미만이면 실패
    });
    return out;
  }
  const reqPassed = (s) => reqSize - reqUnseen(s);
  return { groups, gi, V, N, reqSize, start, key, success, feasible, next, reqPassed };
}

// 정책(policy(s) = 계속?)을 따라 에코 1개를 강화할 때: 성공 확률, 기준별 기대 비용(환급 전 · 후)
export function evaluate(model, policy) {
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
  let layer = new Map([[model.key(model.start), { s: model.start, prob: 1 }]]);
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

/** 기준(metric)으로 성공 1개당 비용이 가장 적은 정책. 반환 { policy, states: Map(key → { s, go }) } 또는 null(불가능) */
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
  for (const [kk, { s, cont }] of solve(hi).memo) states.set(kk, { s, go: cont >= M.refund * M.spent(s.k) - 1e-9 });
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
 * 한 번에 계산: 최적 전략 + 비교용 두 전략
 * @param targets [{ key, minStep, req }], need 유효 몇 개 이상
 * @returns null(불가능) 또는 { model, best, untilDead, openAll, rules }
 */
export function analyze(targets, need, metric) {
  if (!targets.length) return null;
  const model = makeModel(targets, need);
  if (model.N > SLOTS || model.N > model.V || model.groups.some((g) => g.req && g.q <= 0)) return null;
  const opt = optimalPolicy(model, metric);
  if (!opt) return null;
  const best = evaluate(model, opt.policy);
  if (!(best.p > 0)) return null;
  return { model, best, untilDead: evaluate(model, () => true), openAll: evaluateOpenAll(model), rules: rulesOf(model, opt) };
}

// 사람이 읽을 전략표: rows[k][P] = null(나올 수 없음) | { kind: 'go' | 'stop' | 'mixed', byReq: Map(꼭 뜬 수 → 'go'|'stop'|'mixed') }
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
