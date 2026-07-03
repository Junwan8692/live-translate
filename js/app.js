import { createStore } from './store.js';
import { shortId, autoTitle, fmtDateHeader, fmtIndexMeta, countWords } from './helpers.js';

const $ = id => document.getElementById(id);
export const store = createStore(localStorage);

// ---------- 라우터 ----------
function route() {
  const m = location.hash.match(/^#\/s\/([0-9a-f-]{36})$/);
  if (m && store.getSession(m[1])) {
    $('view-main').hidden = true;
    $('view-session').hidden = false;
    renderSession(m[1]);
  } else {
    $('view-session').hidden = true;
    $('view-main').hidden = false;
    renderMain();
  }
}
window.addEventListener('hashchange', route);

// ---------- Main ----------
function renderMain() {
  $('hdr-date').textContent = fmtDateHeader(new Date());
  const rows = $('idx-rows');
  rows.replaceChildren();
  store.listSessions().forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'idx-row';
    const num = document.createElement('span');
    num.className = 'idx-num';
    num.textContent = String(i + 1).padStart(2, '0');
    const title = document.createElement('span');
    title.className = 'idx-title' + (s.title ? '' : ' idx-title-auto');
    title.textContent = s.title || autoTitle(new Date(s.createdAt));
    const meta = document.createElement('span');
    meta.className = 'mono idx-meta';
    meta.textContent = fmtIndexMeta(s);
    row.append(num, title, meta);
    row.onclick = () => { location.hash = `#/s/${s.id}`; };
    rows.append(row);
  });
}

$('btn-create').onclick = () => {
  const s = store.createSession();           // 중간 설정 화면 없이 즉시 세션 진입 (디자인 명세)
  location.hash = `#/s/${s.id}`;
};

// ---------- Session (Task 7에서 확장) ----------
function renderSession(id) {
  const s = store.getSession(id);
  $('s-title').innerHTML = '';
  $('s-title').append(s.title || autoTitle(new Date(s.createdAt)));
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.textContent = '.';
  $('s-title').append(dot);
  const c = new Date(s.createdAt);
  $('s-meta').textContent = `${shortId(s.id)} · ${fmtDateHeader(c).split(' — ')[0]} ${String(c.getHours()).padStart(2, '0')}:${String(c.getMinutes()).padStart(2, '0')}`;
}

$('back-link').onclick = () => { location.hash = '#/'; };

route();
