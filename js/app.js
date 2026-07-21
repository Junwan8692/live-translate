import { createStore } from './store.js';
import { createEngine } from './engine.js';
import { createSync } from './sync.js';
import { createRecorder, recExt } from './recorder.js';
import { transcribeAudio } from './transcribe.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { shortId, autoTitle, timeLabel, fmtTimer, fmtDateHeader, fmtIndexMeta, countWords, transition, toTxt, fmtCost, findPart, transcriptToSegments } from './helpers.js';

const $ = id => document.getElementById(id);
export const store = createStore(localStorage);

// Gemini API 키 우선순위: env.local.js > Supabase app_secrets(로그인 후) > localStorage(키 입력창).
let envKey = '';
import('./env.local.js').then(m => { envKey = m.GEMINI_KEY || ''; }).catch(() => {});

let remoteKey = '';
async function loadRemoteKey() {
  if (remoteKey || !sb) return;
  // allowlist RLS: 명단에 없는 사용자는 빈 결과 → 키 입력창 폴백
  const { data, error } = await sb.from('app_secrets').select('value').eq('name', 'gemini_key').maybeSingle();
  if (error) { console.error('app_secrets 조회 실패:', error); return; }
  remoteKey = data?.value || '';
}

// ---------- Supabase Auth + 동기화 ----------
// 클라이언트 초기화는 route() 이후 모듈 하단에서 비동기로 수행 —
// CDN(esm.run) 지연/행이 로컬 우선 기능(라우팅·번역·저장)을 막지 않게 한다.
export let sb = null;
let supabaseInitError = null;
let currentUser = null;
const isOAuthCallback = new URLSearchParams(location.search).has('code'); // PKCE 콜백 로드에서만 해시 복원 허용
const GATED = !!(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY); // Supabase 설정 시 로그인해야 앱 진입 (LOCAL ONLY 개발 모드는 게이트 없음)
let gateBypass = false;                    // Supabase 초기화 실패(오프라인 등) 시 로컬 열람용 우회

function onSyncSessionsChanged() {
  if (!currentId && /^#\/s\/[0-9a-f-]{36}$/.test(location.hash)) route();
  else if (!location.hash || location.hash === '#/') renderMain();
}

function onSyncState({ pending, error, signedIn = true }) {
  if (!currentId) return;
  if (!signedIn) $('saved-at').textContent = pending ? `LOCAL SAVED · ${pending} PENDING — SIGN IN TO SYNC` : '';
  else if (error) $('saved-at').textContent = `LOCAL SAVED · SYNC ERROR (${pending} PENDING)`;
  else if (pending) $('saved-at').textContent = `LOCAL SAVED · ${pending} SYNC PENDING`;
  else $('saved-at').textContent = 'SYNCED ' + new Date().toTimeString().slice(0, 8);
}

let sync = createSync({ client: null, store, onSessionsChanged: onSyncSessionsChanged, onState: onSyncState });

export function queueChanged() {
  sync.queueChanged();
}

function paintAuth(user) {
  $('login-btn').disabled = !sb;
  $('login-skip').hidden = !supabaseInitError;
  const button = $('btn-signin');
  if (!sb) {
    button.textContent = supabaseInitError ? 'SYNC UNAVAILABLE' : 'LOCAL ONLY';
    button.disabled = true;
    button.title = supabaseInitError?.message || 'Supabase URL과 publishable key를 설정하면 Google 로그인을 사용할 수 있습니다.';
    return;
  }
  button.disabled = false;
  button.textContent = user ? `${(user.email || 'SIGNED IN').toUpperCase()} — SIGN OUT` : 'SIGN IN WITH GOOGLE';
}

async function renderAuth() {
  if (!sb) {
    paintAuth(null);
    return null;
  }
  const { data, error } = await sb.auth.getSession();
  currentUser = error ? null : data.session?.user ?? null;
  paintAuth(currentUser);
  return currentUser;
}

function restoreOAuthRoute() {
  const returnHash = sessionStorage.getItem('relay.authReturnHash');
  if (!returnHash) return;
  sessionStorage.removeItem('relay.authReturnHash');
  if (!isOAuthCallback) return; // 중단된 로그인 시도의 잔여 해시 — 소비만 하고 이동하지 않음 (교차 탭 SIGNED_IN 하이재킹 방지)
  history.replaceState(null, '', `${location.pathname}${returnHash}`);
  route();
}

let syncedUserId = null;
async function syncForUser(user) {
  if (!user || syncedUserId === user.id) return;
  const lastUserId = localStorage.getItem('relay.lastUserId');
  if (lastUserId && lastUserId !== user.id) {
    store.clearLocal();                    // 다른 계정: 이전 계정 데이터 혼입/유출 방지
    route();
  }
  localStorage.setItem('relay.lastUserId', user.id);
  syncedUserId = user.id;
  void loadRemoteKey();                    // 로그인 확정 시 원격 키 1회 조회 (실패해도 번역 시작 시 키 입력창 폴백)
  try {
    if (!await sync.fullSync()) syncedUserId = null;
  } catch (error) {
    syncedUserId = null;                   // 래치 해제 — 다음 auth 이벤트에서 재시도
    console.error('sync: fullSync 실패', error);
  }
}

$('btn-signin').onclick = async () => {
  if (!sb) return;
  if (currentUser) {
    const { error } = await sb.auth.signOut({ scope: 'local' }); // 이 기기만 로그아웃 — 다른 기기 세션 유지
    if (error) alert('로그아웃 실패: ' + error.message);
    else { currentUser = null; paintAuth(null); route(); } // currentUser를 선반영하므로 SIGNED_OUT 이벤트의 변화 감지가 못 잡음 — 여기서 직접 게이트 복귀
    return;
  }

  sessionStorage.setItem('relay.authReturnHash', location.hash || '#/');
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}${location.pathname}` },
  });
  if (error) {
    sessionStorage.removeItem('relay.authReturnHash');
    alert('Google 로그인 시작 실패: ' + error.message);
  }
};

$('login-btn').onclick = () => $('btn-signin').onclick();
$('login-skip').onclick = () => { gateBypass = true; route(); };

function handleAuthChange(_event, session) {
  // Auth 콜백 내부에서 다른 Supabase 호출을 직접 await하지 않고 다음 task로 넘긴다.
  setTimeout(async () => {
    const prevUserId = currentUser?.id ?? null;
    currentUser = session?.user ?? null;
    paintAuth(currentUser);
    if ((currentUser?.id ?? null) !== prevUserId) route(); // 게이트 개폐는 유저가 바뀔 때만 — TOKEN_REFRESHED 등이 라이브 세션을 끊지 않게
    if (!currentUser) {
      syncedUserId = null;
      return;
    }
    restoreOAuthRoute();
    await syncForUser(currentUser);
  }, 0);
}

// ---------- 라우터 ----------
function route() {
  const outgoing = currentId && store.getSession(currentId);
  if (outgoing && (outgoing.status === 'listening' || outgoing.status === 'paused')) {
    engine.stop();                         // paused도 스트림을 보존하므로 화면 이탈 시 반드시 해제
    stopRecording();
    void keepAwake(false);
    stopTick();
    store.updateSession(currentId, { status: 'ready', elapsedMs: acc });
    queueChanged();
  }
  currentId = null;
  if (GATED && !currentUser && !gateBypass) { // 로그인 게이트 — 해시는 보존되어 로그인 후 원래 화면으로 이동
    $('view-main').hidden = true;
    $('view-session').hidden = true;
    $('view-login').hidden = false;
    return;
  }
  $('view-login').hidden = true;
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
  queueChanged();
  location.hash = `#/s/${s.id}`;
};

// ---------- Session 컨트롤러 ----------
const LANG_NAMES = { ko: 'KOREAN', en: 'ENGLISH', ja: 'JAPANESE', 'zh-CN': 'CHINESE', es: 'SPANISH' };
let currentId = null;
let acc = 0, since = null, tick = null;   // 타이머: acc=누적ms, since=listening 시작 시각
let needFreshStart = false;               // 소스 전환으로 스트림을 버린 뒤 resume 대신 start가 필요
let autoScroll = true;
let busy = false;                         // doAction 재진입 가드 (start await 중 더블클릭 방지)
const hydrationPromises = new Map();

// 모바일: 화면이 꺼지면 iOS는 마이크 캡처를 중단한다 — listening 동안 화면 유지
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch {} // 저전력 모드 등 거부는 무시 — 기능 저하일 뿐 오류 아님
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return; // 백그라운드 전환 시 브라우저가 자동 해제
  const s = currentId && store.getSession(currentId);
  if (s?.status === 'listening') void keepAwake(true);
});

const elapsedNow = () => acc + (since ? Date.now() - since : 0);

let recParts = 0;                         // 현재 세션의 녹음 파트 수 (기존 파트 포함)
let pendingUploads = [];                  // 업로드 실패 파트 [{sessionId,seq,startMs,durMs,blob,mime,ext}]
let activeRec = null;                     // 진행 중 MediaRecorder
let recStream = null;                     // REC 모드가 직접 잡은 스트림

async function captureStream(source) {
  return source === 'tab'
    ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
}

function startRecording(stream) {
  if (!sb || !currentUser || activeRec) return;   // 로컬 전용/비로그인: 녹음 없음
  const sessionId = currentId, seq = recParts + 1, startMs = elapsedNow();
  const rec = createRecorder(stream, (blob, mime) => {
    const part = { sessionId, seq, startMs, durMs: Math.max(0, elapsedNow() - startMs), blob, mime, ext: recExt(mime) };
    void uploadPart(part);
  });
  if (rec) { activeRec = rec; recParts = seq; }
}

function stopRecording() {
  if (activeRec && activeRec.state !== 'inactive') activeRec.stop();
  activeRec = null;
  recStream?.getTracks().forEach(t => t.stop());  // REC 모드 원시 캡처도 함께 정리 (LIVE는 null — no-op)
  recStream = null;
}

async function uploadPart(part) {
  try {
    await sync.uploadRecording(part);
    if (currentId === part.sessionId) void loadRecordings(part.sessionId); // Task 7이 구현 — 그 전엔 정의만 있는 no-op
    if (part.sessionId === transcribePendingFor) void runTranscribe(part.sessionId); // Task 8 — 그 전엔 no-op
  } catch (error) {
    console.error('녹음 업로드 실패', error);
    pendingUploads.push(part);
    $('rec-retry').hidden = false;
    $('saved-at').textContent = 'RECORDING UPLOAD FAILED — RETRY BELOW';
  }
}

$('rec-retry').onclick = async () => {
  const retry = pendingUploads; pendingUploads = [];
  $('rec-retry').hidden = true;
  for (const part of retry) await uploadPart(part);
};

let transcribePendingFor = null;
let parts = [];                            // 현재 세션의 녹음 파트 (url 포함)
let pendingSeek = null;
function clearPendingSeek() {
  if (pendingSeek) { $('player').removeEventListener('loadedmetadata', pendingSeek); pendingSeek = null; }
}
async function loadRecordings(id) {
  const fetched = await sync.listRecordings(id);
  if (currentId !== id) return;
  parts = fetched;
  recParts = Math.max(recParts, parts.at(-1)?.seq ?? 0);
  const row = $('player-row');
  row.hidden = !parts.length;
  $('scroll-region').classList.toggle('has-audio', !!parts.length);
  if (!parts.length) return;
  const sel = $('player-part');
  sel.hidden = parts.length < 2;
  sel.replaceChildren(...parts.map((p, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = `PART ${p.seq}`;
    return o;
  }));
  loadPart(0);
}
function loadPart(i, at = 0, play = false) {
  clearPendingSeek();
  const p = parts[i];
  if (!p?.url) return;
  $('player-part').value = i;
  const audio = $('player');
  if (audio.dataset.path !== p.path) { audio.src = p.url; audio.dataset.path = p.path; }
  const apply = () => { pendingSeek = null; audio.currentTime = at; if (play) void audio.play(); };
  if (audio.readyState >= 1) apply();
  else { pendingSeek = apply; audio.addEventListener('loadedmetadata', apply, { once: true }); }
}
$('player-part').onchange = e => loadPart(+e.target.value);

function seekTo(tsMs) {
  const p = findPart(parts, tsMs);
  if (!p) return;
  loadPart(parts.indexOf(p), Math.max(0, (tsMs - p.startMs) / 1000), true);
}
let transcribing = false;
async function runTranscribe(id) {
  if (transcribing) return;
  transcribePendingFor = null;
  const s = store.getSession(id);
  const key = envKey || remoteKey || localStorage.getItem('gemini-key') || '';
  if (!s || !key) { if (currentId === id) { $('key-row').hidden = false; } return; }
  transcribing = true;
  if (currentId === id) $('status-line').textContent = 'TRANSCRIBING…';
  try {
    const recs = await sync.listRecordings(id);
    for (const p of recs) {
      const blob = await (await fetch(p.url)).blob();
      const items = await transcribeAudio({ key, blob, mime: p.path.endsWith('.webm') ? 'audio/webm' : 'audio/mp4', targetLang: s.targetLang });
      for (const g of transcriptToSegments(items, p.startMs)) {
        store.addSegment(id, { ...g, srcLang: null, timeLabel: timeLabel(new Date(s.createdAt + g.tsMs)) });
      }
    }
    queueChanged();
    if (currentId === id) { renderTranscript(id); $('status-line').textContent = 'TRANSCRIPT READY'; renderControls(store.getSession(id).status); }
  } catch (error) {
    console.error('사후 전사 실패', error);
    if (currentId === id) $('status-line').textContent = 'TRANSCRIBE FAILED — PRESS TRANSCRIBE TO RETRY';
  } finally {
    transcribing = false;
  }
}

const engine = createEngine({
  getKey: () => envKey || remoteKey || localStorage.getItem('gemini-key') || '',
  getLang: () => $('lang').value,
  onStatus: () => {},                     // 상태 표시는 앱 상태머신이 담당
  onStream(stream) { startRecording(stream); },
  onPartial({ original, translated }) {
    $('cur-original').textContent = original;
    $('cur-translation').replaceChildren(document.createTextNode(translated), $('caret'));
    scrollBottom();
  },
  onSegment(g) {
    if (!currentId) return;                // 라우트 이탈 뒤 도착한 늦은 flush — null 세션 기록/큐 오염 방지
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
  clearPendingSeek();
  $('player').removeAttribute('src'); delete $('player').dataset.path; $('player-row').hidden = true; parts = [];
  const s = store.getSession(id);
  acc = s.elapsedMs; since = null; needFreshStart = false; autoScroll = true;
  // 레일 헤더
  renderTitle();
  const c = new Date(s.createdAt);
  $('s-meta').textContent = `${shortId(s.id)} · ${fmtDateHeader(c).split(' — ')[0]} ${timeLabel(c)} · ${fmtCost(s.elapsedMs || 0)}`;
  // 컨트롤 값 복원
  $('lang').value = s.targetLang;
  setSourceUI(s.source);
  setModeUI(s.mode || 'live');
  $('mode-sec').hidden = !sb || !currentUser;
  recParts = 0;
  $('rec-retry').hidden = !pendingUploads.some(p => p.sessionId === id); // 다른 세션 실패분은 보존 — RETRY는 전 세션 재시도
  void loadRecordings(id);
  renderTranscript(id);
  $('saved-at').textContent = '';
  renderStatus(s.status === 'listening' || s.status === 'paused' ? 'ready' : s.status); // 새로고침 복원 시 진행 중이던 세션은 ready로
  if (s.status === 'listening' || s.status === 'paused')
    store.updateSession(id, { status: 'ready' }); // 로컬 복구용 다운그레이드 — 원격 push 금지 (다른 기기의 라이브 세션 row 보호)
  if (store.isRemoteSession(id)) void hydrateSegments(id); // ended뿐 아니라 모든 원격 세션 — 빈/스테일 전사 방지
}

function renderTranscript(id) {
  $('col-original').replaceChildren();
  $('col-translation').replaceChildren();
  store.getSegments(id).forEach(appendSeg);
  $('cur-original').textContent = '';
  $('cur-translation').replaceChildren($('caret'));
  updateStats();
  scrollBottom();
}

async function hydrateSegments(id) {
  if (!store.isRemoteSession(id)) return true;
  if (!sb) return store.hasSegments(id); // ponytail: 오프라인/미설정이면 로컬 캐시 유무로만 판단 — 완전성 검증 불가
  if (hydrationPromises.has(id)) return hydrationPromises.get(id);

  const before = store.getSegments(id).length;
  const pending = sync.hydrateSegments(id)
    .catch(error => { console.error('hydrate 실패', error); return false; })
    .then(ok => {
      if (currentId !== id) return ok;
      if (ok && store.getSegments(id).length !== before) renderTranscript(id);
      else if (!ok) $('status-line').textContent = currentUser
        ? 'REMOTE TRANSCRIPT LOAD FAILED — REOPEN TO RETRY'
        : 'SIGN IN TO LOAD THE REMOTE TRANSCRIPT';
      return ok;
    }).finally(() => hydrationPromises.delete(id));
  hydrationPromises.set(id, pending);
  return pending;
}

function dot() { const d = document.createElement('span'); d.className = 'dot'; d.textContent = '.'; return d; }

function renderTitle() {
  const s = store.getSession(currentId);
  $('s-title').replaceChildren(document.createTextNode(s.title || autoTitle(new Date(s.createdAt))), dot());
}

function appendSeg(seg) {
  for (const [col, text] of [['col-original', seg.originalText], ['col-translation', seg.translatedText]]) {
    const p = document.createElement('p');
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = seg.timeLabel;
    ts.onclick = () => { if (parts.length) seekTo(seg.tsMs); };
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
  if (busy) return;
  const actionId = currentId;
  const s = store.getSession(actionId);
  if (!s) return;
  const next = transition(s.status, action);
  if (!next) return;
  busy = true;
  try {
    if (action === 'start') {
      if (!await hydrateSegments(actionId)) return; // 원격 세션은 전사 하이드레이션 후에만 시작 — seq 충돌로 원격 전사 덮어쓰기 방지
      if (currentId !== actionId) return;
      await loadRecordings(actionId);     // recParts 복원 대기 — 기존 파트 seq 충돌(덮어쓰기) 방지
      if (currentId !== actionId) return;
      if (s.mode === 'rec') {
        recStream = await captureStream(s.source);
        const track = recStream.getAudioTracks()[0];
        if (!track) { recStream.getTracks().forEach(t => t.stop()); recStream = null; $('src-caption').textContent = 'TAB SHARE NEEDS "SHARE AUDIO" CHECKED'; return; }
        track.addEventListener('ended', () => doAction('pause'));
        startRecording(recStream);
      } else {
        await engine.start(s.source);      // onStream 콜백이 녹음 시작
      }
      if (currentId !== actionId) { engine.stop(); stopRecording(); return; }
      startTick();
    }
    else if (action === 'pause') { if (s.mode !== 'rec') engine.pause(); activeRec?.pause(); stopTick(); }
    else if (action === 'resume') {
      if (s.status !== 'paused' && !await hydrateSegments(actionId)) return; // paused는 이 기기가 라이브 작성자 — 캐시가 정본
      if (currentId !== actionId) return;
      if (s.status === 'paused' && activeRec?.state === 'paused') {
        if (s.mode !== 'rec') await engine.resume();
        activeRec.resume();
      } else {                              // ended→resume 또는 fresh start: 새 파트
        await loadRecordings(actionId);     // recParts 복원 대기 — 기존 파트 seq 충돌(덮어쓰기) 방지
        if (currentId !== actionId) return;
        if (s.mode === 'rec') {
          recStream = await captureStream(s.source);
          if (!recStream.getAudioTracks()[0]) { recStream.getTracks().forEach(t => t.stop()); recStream = null; return; }
          startRecording(recStream);
        } else if (needFreshStart || s.status === 'ended') { await engine.start(s.source); needFreshStart = false; }
        else await engine.resume();
      }
      if (currentId !== actionId) { engine.stop(); stopRecording(); return; }
      startTick();
    }
    else if (action === 'end') {
      // ponytail: 사후 전사는 세그먼트가 하나도 없을 때 1회만 — REC 세션에 파트를 추가(ended→resume)한 재전사는 미지원, 필요해지면 파트 seq 기준 증분 전사로
      if (s.mode === 'rec' && !store.getSegments(actionId).length) transcribePendingFor = actionId; // 업로드 완료 후 자동 전사
      if (s.mode !== 'rec') engine.stop();
      stopRecording();
      stopTick();
    }
  } catch (e) {
    stopRecording();
    if (e.message !== 'NO_KEY' && currentId === actionId)
      $('status-line').textContent = 'ERROR: ' + e.message.toUpperCase().slice(0, 60);
    return; // 상태 전이 취소
  } finally {
    busy = false;
  }
  store.updateSession(actionId, { status: next, elapsedMs: acc, ...(next === 'ended' ? { endedAt: Date.now() } : next === 'listening' ? { endedAt: null } : {}) });
  renderStatus(next);
  void keepAwake(next === 'listening');
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
  const rec = store.getSession(currentId)?.mode === 'rec';
  chip.textContent = { ready: '○ READY', listening: rec ? '● RECORDING' : '● LISTENING', paused: '❚❚ PAUSED', ended: '— ENDED' }[status];
  line.style.color = status === 'listening' ? 'var(--acc)' : 'var(--muted)';
  line.textContent = status === 'listening' ? (rec ? '● RECORDING — TRANSCRIPT AFTER END' : `● TRANSLATING TO ${langName}`) : 'SOURCE LANGUAGE AUTO-DETECTED';
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
  else {
    mk('▶ Resume session', 'btn-acc', () => doAction('resume'));
    const s = store.getSession(currentId);
    if (s?.mode === 'rec' && !store.getSegments(currentId).length)
      mk('Transcribe', 'btn-acc-line', () => runTranscribe(currentId));
    else box.firstChild.style.gridColumn = '1 / -1';
  }
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
  if (s.status !== 'ready') { engine.stop(); stopRecording(); needFreshStart = true; } // 이전 소스 스트림 폐기
  store.updateSession(currentId, { source });
  setSourceUI(source);
  queueChanged();
}
$('src-mic').onclick = () => switchSource('mic');
$('src-tab').onclick = () => switchSource('tab');

function setModeUI(mode) {
  $('mode-live').classList.toggle('seg-on', mode === 'live');
  $('mode-rec').classList.toggle('seg-on', mode === 'rec');
  $('mode-caption').textContent = mode === 'live' ? 'TRANSLATES IN REAL TIME + RECORDS' : 'RECORDS ONLY — TRANSCRIBED AFTER END';
}
function switchMode(mode) {
  const s = store.getSession(currentId);
  if (s.mode === mode) return;
  if (s.status !== 'ready' && s.status !== 'ended') return; // 진행 중 전환 금지
  store.updateSession(currentId, { mode });
  setModeUI(mode);
  renderStatus(store.getSession(currentId).status);
  queueChanged();
}
$('mode-live').onclick = () => switchMode('live');
$('mode-rec').onclick = () => switchMode('rec');

$('playback').addEventListener('change', e => engine.setPlayback(e.target.checked));

$('api-key').addEventListener('change', e => {
  localStorage.setItem('gemini-key', e.target.value.trim());
  $('key-row').hidden = true;
});

$('back-link').onclick = () => { location.hash = '#/'; };

// ---------- SAVE ----------
const currentTxt = () => {
  const s = store.getSession(currentId);
  return toTxt(s, store.getSegments(currentId));
};

$('save-txt').onclick = () => {
  const s = store.getSession(currentId);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([currentTxt()], { type: 'text/plain' }));
  a.download = `relay-${(s.title || autoTitle(new Date(s.createdAt))).replaceAll(' ', '-')}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('save-copy').onclick = async () => {
  await navigator.clipboard.writeText(currentTxt());
  $('save-copy').textContent = 'COPIED';
  setTimeout(() => { $('save-copy').textContent = 'COPY'; }, 1200);
};

// ---------- 제목 인라인 rename ----------
$('s-title').onclick = () => {
  if ($('s-title').querySelector('input')) return;
  const s = store.getSession(currentId);
  const input = document.createElement('input');
  input.value = s.title || '';
  input.placeholder = autoTitle(new Date(s.createdAt));
  input.style.cssText = 'font:inherit;width:100%;border:none;border-bottom:1px solid var(--ink);background:none;outline:none';
  const commit = () => {
    store.updateSession(currentId, { title: input.value.trim() || null });
    queueChanged();
    renderTitle(); // 전체 renderSession 금지 — 청취 중 rename 시 상태 리셋(새로고침 복원 로직)이 라이브 엔진과 어긋남
  };
  input.onblur = commit;
  input.onkeydown = e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.onblur = null; renderTitle(); } };
  $('s-title').replaceChildren(input);
  input.focus();
};

route();
paintAuth(null);                          // Supabase 초기화 전까지 LOCAL ONLY 표시

if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
  (async () => {
    try {
      const { createClient } = await import('https://esm.run/@supabase/supabase-js@2');
      sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          flowType: 'pkce',                // OAuth 콜백을 query로 받아 해시 라우터와 충돌 방지
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      });
    } catch (error) {
      supabaseInitError = error;
      console.error('Supabase client initialization failed:', error);
      paintAuth(null);
      return;
    }
    sync.dispose();
    sync = createSync({ client: sb, store, onSessionsChanged: onSyncSessionsChanged, onState: onSyncState });
    sb.auth.onAuthStateChange(handleAuthChange);
    const user = await renderAuth();
    if (user) {
      route();                             // 게이트 해제 (INITIAL_SESSION 경로와 중복 호출은 무해)
      restoreOAuthRoute();
      await syncForUser(user);
    }
  })().catch(error => console.error('Supabase init 실패:', error));
}
