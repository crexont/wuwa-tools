// guide.js — 명조 툴즈 v6.0: 에코 가이드 탭
// 공명자별 에코 세트 · 메인 에코 · 주옵 · 유효옵 (데이터는 guide-data.js, 아카라이브 "공명자별 에코 정리글"을 옮긴 것).
// 공명자 선택은 사이트 전체에서 하나: 위 얼굴 줄(roles.js renderStrip)이나 아래 목록에서 고르면 roles.js selectRole이
// 테마 · 에코파고 유효옵 · 강화 전략 목표를 같이 바꾸고, 여기서는 "roleselect" 이벤트를 받아 큰 카드를 다시 그린다.
import { ROLES, ELEMENTS, faceUrl, selectRole } from './roles.js';
import { GUIDE, GUIDE_SOURCE, GUIDE_VERSION } from './guide-data.js';

const ROLE_KEY = 'echopago.role.v1';
const FILTER_KEY = 'echopago.guideFilter.v1';
const BASE_COST = '43311';
// 글과 같은 속성 순서
const ORDER = ['응결', '용융', '전도', '기류', '회절', '인멸'];

const $ = (id) => document.getElementById(id);
const featured = $('gdFeatured');
const list = $('gdList');
const tabs = $('gdTabs');


const roleOf = (id) => ROLES.find((r) => r.id === id) || null;
const elementOf = (id) => ELEMENTS.find((e) => e.id === id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const elIcon = (el) => `<i class="el-icon" style="--el:${elementOf(el)?.color};--icon:url('./icons/elements/${elementOf(el)?.icon}.png')" aria-hidden="true"></i>`;

// 글 순서(guide-data.js 키 순서)대로, 속성별로 묶는다
const groups = ORDER.map((el) => ({
  el,
  ids: Object.keys(GUIDE).filter((id) => roleOf(id)?.elements[0] === el),
}));

let currentId = null;
let filter = '';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
};

// 카드 한 장: 머리(얼굴 · 이름 · 코스트) → 역할/조건별 세트 + 메인 에코 → 주옵 / 유효옵
function cardHtml(id, big) {
  const role = roleOf(id);
  const g = GUIDE[id];
  const el = role.elements[0];
  const head = `
    <div class="gd-card-head">
      <span class="role-face gd-face"><img src="${faceUrl(role)}" alt="" loading="lazy" decoding="async"></span>
      <div class="gd-card-title">
        <strong>${esc(role.name)}</strong>
        <span class="gd-card-el">${elIcon(el)}${el}</span>
      </div>
      ${g ? `<span class="gd-cost${g.cost !== BASE_COST ? ' is-diff' : ''}" title="코스트 배치 (기본 43311)"><small>코스트</small>${esc(g.cost)}</span>` : ''}
    </div>`;
  if (!g) {
    return `${head}<p class="gd-empty">출시 전이라 아직 정리된 정보가 없어요.</p>`;
  }
  const builds = g.builds.map((b) => `
    <div class="gd-build">
      <div class="gd-when">${esc(b.when)}</div>
      <div class="gd-set">
        <b>${esc(b.set)}</b>
        <div class="gd-echo"><span>메인 에코</span><strong>${esc(b.echo)}</strong></div>
        ${b.note ? `<p class="gd-memo">${esc(b.note)}</p>` : ''}
      </div>
    </div>`).join('');
  return `${head}
    <div class="gd-builds">${builds}</div>
    <dl class="gd-stats${big ? ' is-big' : ''}">
      <dt>주옵</dt><dd>${esc(g.main)}</dd>
      <dt>유효옵</dt><dd>${esc(g.subs)}</dd>
    </dl>`;
}

function renderFeatured() {
  const role = roleOf(currentId);
  if (!role) {
    featured.innerHTML = `<p class="gd-pick">위에서 공명자를 고르거나 아래 목록에서 눌러 보세요.</p>`;
    featured.style.removeProperty('--el');
    return;
  }
  featured.style.setProperty('--el', elementOf(role.elements[0])?.color);
  featured.innerHTML = `<article class="gd-card is-big">${cardHtml(role.id, true)}</article>`;
}

function renderTabs() {
  const items = [{ id: '', label: '전체', n: Object.keys(GUIDE).length },
    ...groups.map((g) => ({ id: g.el, label: g.el, n: g.ids.length, color: elementOf(g.el)?.color }))];
  tabs.replaceChildren(...items.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'role-tab' + (t.id === filter ? ' is-on' : '');
    b.setAttribute('aria-pressed', String(t.id === filter));
    if (t.color) b.style.setProperty('--el', t.color);
    b.innerHTML = `${t.color ? elIcon(t.id) : ''}${t.label}<span>${t.n}</span>`;
    b.addEventListener('click', () => { filter = t.id; store.set(FILTER_KEY, filter); renderTabs(); renderList(); });
    return b;
  }));
}

// 아래 목록: 속성별로 카드를 모두 펼쳐서 훑어볼 수 있게 (글과 같은 모양). 카드 머리를 누르면 그 공명자를 고른다
function renderList() {
  list.innerHTML = groups.filter((g) => !filter || g.el === filter).map((g) => `
    <section class="gd-group" style="--el:${elementOf(g.el)?.color}">
      <h4 class="role-group-head">${elIcon(g.el)}${g.el}<span>${g.ids.length}</span></h4>
      <div class="gd-cards">
        ${g.ids.map((id) => `
          <article class="gd-card${id === currentId ? ' is-on' : ''}" data-id="${id}">
            <button type="button" class="gd-card-pick" data-pick="${id}" aria-label="${esc(roleOf(id).name)} 고르기"></button>
            ${cardHtml(id, false)}
          </article>`).join('')}
      </div>
    </section>`).join('');
}

function setCurrent(id) {
  currentId = roleOf(id) ? id : null;
  renderFeatured();
  for (const c of list.querySelectorAll('.gd-card')) c.classList.toggle('is-on', c.dataset.id === currentId);
}

function init() {
  const saved = store.get(FILTER_KEY);
  filter = ORDER.includes(saved) ? saved : '';
  currentId = roleOf(store.get(ROLE_KEY))?.id ?? null;
  renderTabs();
  renderList();
  renderFeatured();
  $('gdSource').innerHTML = `출처: <a href="${GUIDE_SOURCE}" target="_blank" rel="noopener">아카라이브 「명조 공명자별 에코 정리글」</a> (${GUIDE_VERSION}버전 기준) · 나무위키 각 공명자 문서의 「에코」 항목을 요약 (CC BY-NC-SA 2.0 KR)`;

  // 다른 탭(에코파고 · 강화 전략)이나 얼굴 줄에서 고르면 큰 카드를 바꾼다
  window.addEventListener('roleselect', (e) => setCurrent(e.detail?.id ?? null));

  list.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (!pick) return;
    selectRole(pick.dataset.pick);   // roleselect 이벤트로 setCurrent가 불린다
    // 휴대폰처럼 큰 카드가 위에 있으면 거기로 올려준다
    const box = featured.closest('.panel');
    if (box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: 'start' });
  });
}

if (featured && list && tabs) init();
