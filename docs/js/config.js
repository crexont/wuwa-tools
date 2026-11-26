// config.js — 명조 툴즈 v6.0: 여러 파일이 함께 쓰는 설정값
export const SLOT_COUNT = 5;         // 에코 부옵션 칸 수 (계산 · 화면 모두 이 값 하나만 쓴다)
export const SPLIT_X = 0.65;          // 슬롯 폭 중 옵션명 / 수치 경계
// ?debug 로 열면 OCR 과정을 콘솔에 출력 (Node 테스트에는 location이 없다)
export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
