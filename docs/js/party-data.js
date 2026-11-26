// party-data.js — 명조 툴즈 v6.0: 파티 메이커 저장값 읽기 (화면 없음, 테스트에서도 그대로 쓴다)
// 저장된 값에서 모르는 캐릭터 · 무기는 빼고, 옛 무기 id(WEAPON_ID_ALIAS)는 새 id로 옮긴다.
import { findRole } from './roles.js';
import { WEAPONS, ROLE_WEAPON, WEAPON_ID_ALIAS } from './weapons.js';

export const PARTY_KEY = 'echopago.party.v1';
export const PARTY_SIZE = 3;
export const PARTY_MAX = 20;   // 역경의 탑 · 홀로그램 등 한 번에 10파티 넘게 짜는 경우도 있어서 넉넉히
export const NAME_MAX = 20;

export const findWeapon = (id) => WEAPONS.find((w) => w.id === id) || null;
export const emptyParty = (n) => ({ name: `파티 ${n}`, ids: Array(PARTY_SIZE).fill(null) });

/** 저장값(JSON.parse 결과, 깨졌으면 아무 값) → { owned, uses, build, parties } */
export function parseParty(s) {
  const owned = Array.isArray(s?.owned) ? s.owned.filter(findRole) : [];
  const parties = (Array.isArray(s?.parties) ? s.parties : []).slice(0, PARTY_MAX).map((p, i) => ({
    name: typeof p?.name === 'string' ? p.name.slice(0, NAME_MAX) : `파티 ${i + 1}`,
    ids: Array.from({ length: PARTY_SIZE }, (_, k) => (owned.includes(p?.ids?.[k]) ? p.ids[k] : null)),
  }));
  // 사용 횟수: 서포터 등 두 파티에 넣을 수 있는 캐릭터만 2를 적어 둔다 (없으면 1회)
  const uses = {};
  for (const id of owned) if (s?.uses?.[id] === 2) uses[id] = 2;
  // 돌파(0~6) · 무기 재련(1~5) · 무기(id). 기본값(0돌 · R1 · 무기 안 정함)이면 적지 않는다
  const build = {};
  for (const id of owned) {
    const b = s?.build?.[id];
    const seq = Number.isInteger(b?.s) && b.s >= 0 && b.s <= 6 ? b.s : 0;
    const ref = Number.isInteger(b?.r) && b.r >= 1 && b.r <= 5 ? b.r : 1;
    const wid = WEAPON_ID_ALIAS[b?.w] ?? b?.w;
    const w = findWeapon(wid)?.type === ROLE_WEAPON[id] ? wid : null;
    if (seq || ref > 1 || w) build[id] = { s: seq, r: ref, w };
  }
  return { owned, uses, build, parties: parties.length ? parties : [emptyParty(1)] };
}
