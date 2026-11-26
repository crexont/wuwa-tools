// util.js — 명조 툴즈 v6.0: 여러 탭이 같이 쓰는 작은 도우미 (저장 · 글자 이스케이프 · 숫자 표기)

// localStorage: 막혀 있거나(사생활 보호 모드) 값이 깨져 있어도 예외 없이
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 무시 */ } },
  getJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  setJSON(k, v) { store.set(k, JSON.stringify(v)); },
};

export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const fmtInt = (n) => Math.round(n).toLocaleString('ko-KR');
export const fmtExp = (n) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 1e6 ? 0 : 1)}만` : fmtInt(n));
