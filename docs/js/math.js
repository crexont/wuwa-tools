// math.js — 명조 툴즈 v6.0: 에코 강화 비용 (튜너 · 경험치 · 환급)
// 확률 · 최적 강화 순서 계산은 strategy.js 하나로 한다 (에코파고 · 강화 전략 · 튜닝 연습장이 같이 쓴다).
import { SLOT_COUNT } from './config.js';

// 5성 에코: 레벨 5·10·15·20·25에서 부옵션 칸이 하나씩 열리고, 칸마다 튜너 10개가 든다 (게임 데이터 PhantomQuality).
// 칸을 열기 전에 올려야 하는 경험치는 PhantomLevel 5성 그룹. 재료로 쓰면 튜너 30%, 경험치 75%를 돌려받는다.
export const ECHO_COST = {
  tunerPerSlot: 10,
  tunerRefund: 0.3,
  expPerSlot: [4400, 12100, 23100, 39500, 63500],
  expRefund: 0.75,
};

// 지금 버리면 잃는 양 (환급 후): 열린 칸 수 기준
export function discardLoss(openedCount) {
  const n = Math.max(0, Math.min(SLOT_COUNT, openedCount));
  const exp = ECHO_COST.expPerSlot.slice(0, n).reduce((a, b) => a + b, 0);
  return { tuners: n * (ECHO_COST.tunerPerSlot * (1 - ECHO_COST.tunerRefund)), exp: Math.round(exp * (1 - ECHO_COST.expRefund)) };
}
