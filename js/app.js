import { createStore } from './store.js';
import { createEngine } from './engine.js';
import { shortId, autoTitle, timeLabel, fmtTimer, fmtDateHeader, fmtIndexMeta, countWords, transition } from './helpers.js';

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
    if (currentId && store.getSession(currentId)?.status === 'listening') { engine.stop(); stopTick(); store.updateSession(currentId, { status: 'ready', elapsedMs: acc }); }
    currentId = null;
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

// ---------- Session 컨트롤러 ----------
const LANG_NAMES = { ko: 'KOREAN', en: 'ENGLISH', ja: 'JAPANESE', 'zh-CN': 'CHINESE', es: 'SPANISH' };
let currentId = null;
let acc = 0, since = null, tick = null;   // 타이머: acc=누적ms, since=listening 시작 시각
let needFreshStart = false;               // 소스 전환으로 스트림을 버린 뒤 resume 대신 start가 필요
let autoScroll = true;

export function queueChanged() {}         // Task 10에서 동기화 drain으로 구현

const elapsedNow = () => acc + (since ? Date.now() - since : 0);

const engine = createEngine({
  getKey: () => localStorage.getItem('gemini-key') || '',
  getLang: () => $('lang').value,
  onStatus: () => {},                     // 상태 표시는 앱 상태머신이 담당
  onPartial({ original, translated }) {
    $('cur-original').textContent = original;
    $('cur-translation').replaceChildren(document.createTextNode(translated), $('caret'));
    scrollBottom();
  },
  onSegment(g) {
    const seg = store.addSegment(currentId, {
      tsMs: elapsedNow(), timeLabel: timeLabel(new Date()), srcLang: null,
      originalText: g.originalText, translatedText: g.translatedText,
    });
    store.updateSession(currentId, { elapsedMs: elapsedNow() });
    appendSeg(seg);
    updateStats();
    $('saved-at').textContent = 'AUTO-SAVED ' + new Date().toTimeString().slice(0, 8);
    queueChanged();
    scrollBottom();
  },
  onError(msg) {
    if (msg === 'NO_KEY') { $('key-row').hidden = false; $('api-key').focus(); return; }
    if (msg === 'TRACK_ENDED') { doAction('pause'); return; }   // 사용자가 탭 공유 중단
    if (msg === 'NO_AUDIO_TRACK') { $('src-caption').textContent = 'TAB SHARE NEEDS "SHARE AUDIO" CHECKED'; return; }
    $('status-line').textContent = 'ERROR: ' + msg.toUpperCase().slice(0, 60);
  },
});

function renderSession(id) {
  currentId = id;
  const s = store.getSession(id);
  acc = s.elapsedMs; since = null; needFreshStart = false; autoScroll = true;
  // 레일 헤더
  $('s-title').replaceChildren(document.createTextNode(s.title || autoTitle(new Date(s.createdAt))), dot());
  const c = new Date(s.createdAt);
  $('s-meta').textContent = `${shortId(s.id)} · ${fmtDateHeader(c).split(' — ')[0]} ${timeLabel(c)}`;
  // 컨트롤 값 복원
  $('lang').value = s.targetLang;
  setSourceUI(s.source);
  // 전사 복원
  $('col-original').replaceChildren();
  $('col-translation').replaceChildren();
  store.getSegments(id).forEach(appendSeg);
  $('cur-original').textContent = '';
  $('cur-translation').replaceChildren($('caret'));
  updateStats();
  $('saved-at').textContent = '';
  renderStatus(s.status === 'listening' || s.status === 'paused' ? 'ready' : s.status); // 새로고침 복원 시 진행 중이던 세션은 ready로
  if (s.status === 'listening' || s.status === 'paused') store.updateSession(id, { status: 'ready' });
  scrollBottom();
}

function dot() { const d = document.createElement('span'); d.className = 'dot'; d.textContent = '.'; return d; }

function appendSeg(seg) {
  for (const [col, text] of [['col-original', seg.originalText], ['col-translation', seg.translatedText]]) {
    const p = document.createElement('p');
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = seg.timeLabel;
    p.append(ts, text);
    $(col).append(p);
  }
}

function updateStats() {
  const segs = store.getSegments(currentId);
  $('footer-stats').textContent = `${segs.length} SEGMENTS · ${countWords(segs)} WORDS`;
}

function scrollBottom() {
  if (autoScroll) $('scroll-region').scrollTop = $('scroll-region').scrollHeight;
}
$('scroll-region').addEventListener('scroll', () => {
  const el = $('scroll-region');
  autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
});

// ---------- 상태머신 ----------
async function doAction(action) {
  const s = store.getSession(currentId);
  const next = transition(s.status, action);
  if (!next) return;
  try {
    if (action === 'start') { await engine.start(s.source); startTick(); }
    else if (action === 'pause') { engine.pause(); stopTick(); }
    else if (action === 'resume') {
      if (needFreshStart) { await engine.start(s.source); needFreshStart = false; }
      else await engine.resume();
      startTick();
    }
    else if (action === 'end') { engine.stop(); stopTick(); }
  } catch (e) {
    if (e.message !== 'NO_KEY') $('status-line').textContent = 'ERROR: ' + e.message.toUpperCase().slice(0, 60);
    return; // 상태 전이 취소
  }
  store.updateSession(currentId, { status: next, elapsedMs: acc, ...(next === 'ended' ? { endedAt: Date.now() } : {}) });
  renderStatus(next);
  queueChanged();
}

function startTick() { since = Date.now(); tick = setInterval(() => { $('timer').textContent = fmtTimer(elapsedNow()); }, 500); }
function stopTick() { if (since) acc += Date.now() - since; since = null; clearInterval(tick); $('timer').textContent = fmtTimer(acc); }

function renderStatus(status) {
  const chip = $('status-chip'), wf = $('waveform'), tm = $('timer'), line = $('status-line');
  const langName = LANG_NAMES[$('lang').value] || $('lang').value.toUpperCase();
  wf.classList.toggle('live', status === 'listening');
  $('caret').hidden = status !== 'listening';
  tm.style.color = status === 'listening' ? 'var(--ink)' : 'var(--disabled-text)';
  chip.style.color = status === 'listening' ? 'var(--acc)' : 'var(--muted)';
  chip.textContent = { ready: '○ READY', listening: '● LISTENING', paused: '❚❚ PAUSED', ended: '— ENDED' }[status];
  line.style.color = status === 'listening' ? 'var(--acc)' : 'var(--muted)';
  line.textContent = status === 'listening' ? `● TRANSLATING TO ${langName}` : 'SOURCE LANGUAGE AUTO-DETECTED';
  $('hdr-target').textContent = langName;
  renderControls(status);
}

function renderControls(status) {
  const box = $('controls');
  box.replaceChildren();
  const mk = (label, cls, onclick, disabled = false) => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    if (disabled) b.disabled = true; else b.onclick = onclick;
    box.append(b);
  };
  if (status === 'ready') { mk('Start translation', 'btn-acc', () => doAction('start')); mk('End session', '', null, true); }
  else if (status === 'listening') { mk('❚❚ Pause', 'btn-ink-line', () => doAction('pause')); mk('End session', 'btn-acc-line', () => doAction('end')); }
  else if (status === 'paused') { mk('▶ Resume', 'btn-acc', () => doAction('resume')); mk('End session', 'btn-acc-line', () => doAction('end')); }
  else { const n = document.createElement('div'); n.className = 'mono'; n.style.cssText = 'grid-column:1/-1;font-size:10px;color:var(--faint)'; n.textContent = 'SESSION ENDED — READ ONLY'; box.append(n); }
}

// ---------- 레일 컨트롤 이벤트 ----------
$('lang').addEventListener('change', () => {
  store.updateSession(currentId, { targetLang: $('lang').value });
  engine.restartLanguage();               // listening 중이면 새 언어로 재연결, 아니면 no-op
  renderStatus(store.getSession(currentId).status);
  queueChanged();
});

function setSourceUI(source) {
  $('src-mic').classList.toggle('seg-on', source === 'mic');
  $('src-tab').classList.toggle('seg-on', source === 'tab');
  $('src-caption').textContent = source === 'mic' ? 'INPUT: MICROPHONE' : 'INPUT: BROWSER TAB AUDIO';
}
async function switchSource(source) {
  const s = store.getSession(currentId);
  if (s.source === source) return;
  if (s.status === 'listening') await doAction('pause'); // 디자인 명세: 전환은 일시정지 후 재시작
  if (s.status !== 'ready') { engine.stop(); needFreshStart = true; } // 이전 소스 스트림 폐기
  store.updateSession(currentId, { source });
  setSourceUI(source);
  queueChanged();
}
$('src-mic').onclick = () => switchSource('mic');
$('src-tab').onclick = () => switchSource('tab');

$('playback').addEventListener('change', e => engine.setPlayback(e.target.checked));

$('api-key').addEventListener('change', e => {
  localStorage.setItem('gemini-key', e.target.value.trim());
  $('key-row').hidden = true;
});

$('back-link').onclick = () => { location.hash = '#/'; };

route();
