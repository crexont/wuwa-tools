// practice.js — 명조 툴즈 v6.0: 튜닝 연습장 계산 (화면 없음, 테스트에서도 그대로 쓴다)
// 에코를 실제 확률대로 한 칸씩 열어 보고, 강화 전략(strategy.js)의 최적 순서로 "계속 / 버림"을 알려준다.
// 칸 뽑기: 13종 중 아직 안 뜬 옵션에서 균등하게, 수치 단계는 data.js 확률표대로 (에코파고 · 강화 전략과 같은 모델).
import { STAT_DATABASE } from './data.js';
import { ECHO_COST } from './math.js';
import { makeModel, optimalPolicy, evaluate } from './strategy.js';

export const SLOTS = 5;
const KEYS = Object.keys(STAT_DATABASE);
const EXP_CUM = [0];
for (const e of ECHO_COST.expPerSlot) EXP_CUM.push(EXP_CUM[EXP_CUM.length - 1] + e);

/** 다음 칸 하나 뽑기. opened = [{ key, step }] (step은 1부터), rng = () => [0, 1) */
export function rollSlot(opened, rng = Math.random) {
  const left = KEYS.filter((k) => !opened.some((s) => s.key === k));
  const key = left[Math.min(left.length - 1, Math.floor(rng() * left.length))];
  const probs = STAT_DATABASE[key].probs;
  let r = rng(), step = probs.length;
  for (let i = 0; i < probs.length; i++) { r -= probs[i]; if (r < 0) { step = i + 1; break; } }
  return { key, step };
}

/**
 * 목표 준비: 모델 + 최적 정책 + 그 정책의 평균값. 불가능한 목표면 null
 * @param targets [{ key, minStep, req }], need 유효 몇 개 이상, metric 'tuner' | 'exp' | 'echo'
 */
export function prepare(targets, need, metric = 'tuner') {
  if (!targets?.length) return null;
  const model = makeModel(targets, need);
  if (model.N > SLOTS || model.N > model.V || model.groups.some((g) => g.req && g.q <= 0)) return null;
  const opt = optimalPolicy(model, metric);
  if (!opt) return null;
  const best = evaluate(model, opt.policy);
  if (!(best.p > 0)) return null;
  return { targets, need, metric, model, policy: opt.policy, best };
}

/** 지금 에코 상태 → strategy.js 모델 상태. 고정 옵션이 기준 미만이면 null(실패 확정) */
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

/**
 * 판정: 'done' 완성 / 'dead' 더 열어도 완성 못 함 / 'go' 추천 = 계속 / 'stop' 추천 = 버리기
 */
export function verdict(plan, opened) {
  const s = stateOf(plan, opened);
  if (!s) return 'dead';
  if (plan.model.success(s)) return 'done';
  if (s.k >= SLOTS || !plan.model.feasible(s)) return 'dead';
  return plan.policy(s) ? 'go' : 'stop';
}

/** 칸을 k개 연 에코의 비용. kept = 완성해서 가지는지(환급 없음), 아니면 재료로 써서 환급 */
export function echoCost(k, kept) {
  const tuner = k * ECHO_COST.tunerPerSlot, exp = EXP_CUM[k];
  return kept
    ? { tuner, exp }
    : { tuner: tuner * (1 - ECHO_COST.tunerRefund), exp: exp * (1 - ECHO_COST.expRefund) };
}

/** 평균(추천 순서대로 했을 때) 완성 1개당 비용 */
export const expectedPerSuccess = (plan) => ({
  tuner: plan.best.tuner.net / plan.best.p,
  exp: plan.best.exp.net / plan.best.p,
  echo: plan.best.echo.net / plan.best.p,
  p: plan.best.p,
});
