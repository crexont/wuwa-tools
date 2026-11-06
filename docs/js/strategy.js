// strategy.js — 명조 툴즈 v5.0: 강화 전략 계산 (원하는 부옵션 + 최소 수치 → 성공 확률 · 최적 강화 순서)
//
// 모델: 부옵션은 13종 중에서 중복 없이 균등하게 5칸이 열린다 (에코파고 확률 계산과 같음).
// 목표: 고른 옵션이 "전부" 최소 수치 이상으로 떠야 성공. 고른 옵션이 최소 수치 미만으로 뜨면 그 에코는 실패 확정.
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
  const probs = STAT_DATABASE[key].probs;
  return probs.slice(Math.max(0, minStep - 1)).reduce((a, b) => a + b, 0);
}

const bits = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };

/**
 * 목표 모델을 만든다.
 * @param targets [{ key, minStep }] 1~5개
 */
export function makeModel(targets) {
  const T = targets.length;
  const q = targets.map((t) => passProb(t.key, t.minStep));
  const full = (1 << T) - 1;
  // 다음 칸 결과: [{ p, mask }] (mask = -1 이면 실패 확정)
  function next(k, mask) {
    const left = POOL - k;
    const seenOther = k - bits(mask);                       // 지금까지 뜬 "원하지 않는 옵션" 수
    const out = [];
    const other = (POOL - T) - seenOther;
    if (other > 0) out.push({ p: other / left, mask });
    for (let i = 0; i < T; i++) {
      if (mask & (1 << i)) continue;
      if (q[i] > 0) out.push({ p: q[i] / left, mask: mask | (1 << i) });
      if (q[i] < 1) out.push({ p: (1 - q[i]) / left, mask: -1 });
    }
    return out;
  }
  const feasible = (k, mask) => mask >= 0 && T - bits(mask) <= SLOTS - k;
  return { T, q, full, next, feasible };
}

// 정책을 따라 에코 1개를 강화할 때: 성공 확률, 기준별 기대 비용(환급 전 · 후), 몇 칸에서 끝나는지 분포
export function evaluate(model, policy) {
  const res = { p: 0, end: Array(SLOTS + 1).fill(0) };
  for (const m of Object.keys(METRICS)) res[m] = { gross: 0, net: 0 };
  const add = (prob, k, success) => {
    res.end[k] += prob;
    for (const [m, M] of Object.entries(METRICS)) {
      const spent = success ? M.spent(SLOTS) : M.spent(k);
      res[m].gross += prob * (spent + M.echo);
      res[m].net += prob * ((success ? spent : spent * (1 - M.refund)) + M.echo);
    }
    if (success) res.p += prob;
  };
  const walk = (k, mask, prob) => {
    if (mask === model.full) return add(prob, k, true);
    if (k === SLOTS || !model.feasible(k, mask) || !policy(k, mask)) return add(prob, k, false);
    for (const n of model.next(k, mask)) {
      if (n.mask < 0) add(prob * n.p, k + 1, false);          // 실패 확정: 바로 버림
      else walk(k + 1, n.mask, prob * n.p);
    }
  };
  walk(0, 0, 1);
  return res;
}

/** 기준(metric)으로 성공 1개당 비용이 가장 적은 정책. 반환 { policy, decisions: Map("k,mask" → 계속?) } */
export function optimalPolicy(model, metric) {
  const M = METRICS[metric];
  // λ = 성공 1개의 가치. V = 지금 상태의 가치(이미 쓴 비용은 빼고, 버리면 환급만 받음)
  const solve = (L) => {
    const memo = new Map();
    const V = (k, mask) => {
      if (mask === model.full) return L - (M.spent(SLOTS) - M.spent(k));
      const stop = M.refund * M.spent(k);
      if (k === SLOTS || !model.feasible(k, mask)) return stop;
      const key = k * 64 + mask;
      if (memo.has(key)) return Math.max(stop, memo.get(key));
      let cont = -M.open(k);
      for (const n of model.next(k, mask)) cont += n.p * (n.mask < 0 ? M.refund * M.spent(k + 1) : V(k + 1, n.mask));
      memo.set(key, cont);
      return Math.max(stop, cont);
    };
    return { start: V(0, 0) - M.echo, memo };       // 새 에코 하나를 쓰는 비용(에코 기준)까지 빼고 0보다 크면 λ가 충분
  };
  let hi = 1;
  while (solve(hi).start <= 0) { hi *= 4; if (hi > 1e15) return null; }   // 불가능한 목표
  let lo = 0;
  for (let it = 0; it < 80; it++) { const mid = (lo + hi) / 2; if (solve(mid).start > 0) hi = mid; else lo = mid; }
  const { memo } = solve(hi);
  const decisions = new Map();
  for (const [key, cont] of memo) {
    const k = Math.floor(key / 64), mask = key % 64;
    decisions.set(key, cont >= M.refund * M.spent(k) - 1e-9);
  }
  // 에코 기준은 칸을 여는 게 공짜라 "불가능해질 때까지 연다"와 같다
  const policy = (k, mask) => decisions.get(k * 64 + mask) ?? true;
  return { policy, decisions, lambda: hi };
}

export const POLICIES = {
  untilDead: () => true,             // 불가능해질 때만 버림
};

/** 다 까기: 실패 확정이어도 +25까지 다 연다 */
export function evaluateOpenAll(model) {
  const pAll = evaluate(model, () => true).p;     // 성공 확률은 "불가능하면 버림"과 같다
  const res = { p: pAll, end: Array(SLOTS + 1).fill(0) };
  res.end[SLOTS] = 1;
  for (const [m, M] of Object.entries(METRICS)) {
    const spent = M.spent(SLOTS);
    res[m] = { gross: spent + M.echo, net: pAll * spent + (1 - pAll) * spent * (1 - M.refund) + M.echo };
  }
  return res;
}

/**
 * 한 번에 계산: 최적 전략 + 비교용 두 전략
 * @returns null(불가능) 또는 { model, best, untilDead, openAll, rules }
 */
export function analyze(targets, metric) {
  if (!targets.length || targets.length > SLOTS) return null;
  const model = makeModel(targets);
  if (model.q.some((x) => x <= 0)) return null;
  const opt = optimalPolicy(model, metric);
  if (!opt) return null;
  const best = evaluate(model, opt.policy);
  const untilDead = evaluate(model, POLICIES.untilDead);
  const openAll = evaluateOpenAll(model);
  return { model, best, untilDead, openAll, rules: rulesOf(model, opt.policy) };
}

// 사람이 읽을 전략표: k칸 열었을 때(1~4), 원하는 옵션이 c개 떴다면 → 'go' | 'stop' | 'mixed'(어떤 옵션이냐에 따라) | null(나올 수 없음/이미 불가능)
export function rulesOf(model, policy) {
  const rows = [];
  for (let k = 0; k < SLOTS; k++) {
    const cells = [];
    for (let c = 0; c <= Math.min(k, model.T); c++) {
      const masks = [];
      for (let m = 0; m <= model.full; m++) if (bits(m) === c && model.feasible(k, m) && m !== model.full) masks.push(m);
      if (!masks.length) { cells.push(null); continue; }
      const go = masks.filter((m) => policy(k, m));
      cells.push(go.length === masks.length ? { kind: 'go' } : !go.length ? { kind: 'stop' } : { kind: 'mixed', go });
    }
    rows.push(cells);
  }
  return rows;
}
