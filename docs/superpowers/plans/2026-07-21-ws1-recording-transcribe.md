# WS1 — 세션 녹음 + 사후 전사 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 세션의 오디오를 Supabase Storage에 녹음 저장하고, REC 모드에서는 Live API 없이 녹음 → 종료 후 배치 API로 전사+번역을 자동 생성한다.

**Architecture:** MediaRecorder로 압축 오디오(mp4/AAC 우선)를 세션 파트 단위로 캡처 → `sync.js` 경유 Storage 업로드 + `recordings` 테이블 메타 기록. REC 모드는 Gemini Live 연결을 생략하고, END 후 `js/transcribe.js`가 generateContent(structured output)로 세그먼트를 생성해 기존 store/UI를 재사용한다.

**Tech Stack:** 바닐라 JS(빌드 없음), MediaRecorder, Supabase Storage, `@google/genai`(esm.run, 이미 사용 중), Node 내장 테스트 러너.

**Spec:** `docs/superpowers/specs/2026-07-21-recording-mobile-design.md`

## Global Constraints

- 프레임워크·빌드 도구·신규 런타임 의존성 금지 (CLAUDE.md)
- `js/config.js`가 모델명/Supabase 값의 단일 정의처
- service_role 키 금지, 클라이언트는 publishable key만
- 순수 로직은 `js/helpers.js`(DOM 금지) + `test/*.test.mjs` (`node --test`)
- 커밋 메시지 한국어, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 푸터
- git worktree에서 작업 (superpowers:using-git-worktrees), WS2보다 **먼저 머지**

---

### Task 1: 순수 헬퍼 (findPart, transcriptToSegments) — TDD

**Files:**
- Modify: `js/helpers.js` (파일 끝에 추가)
- Test: `test/helpers.test.mjs` (기존 파일에 추가)

**Interfaces:**
- Produces: `findPart(parts, tsMs)` — parts는 `{seq, startMs, ...}` 배열(seq 오름차순). `startMs <= tsMs`인 마지막 파트, 없으면 첫 파트, 빈 배열이면 null.
- Produces: `transcriptToSegments(items, partStartMs)` — items는 `[{startSec, original, translated}]`. `[{tsMs, originalText, translatedText}]`를 tsMs 오름차순으로 반환. startSec 음수/누락은 0으로 클램프.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/helpers.test.mjs`에 추가:

```js
import { findPart, transcriptToSegments } from '../js/helpers.js';

test('findPart: tsMs가 속한 파트를 고른다', () => {
  const parts = [{ seq: 1, startMs: 0 }, { seq: 2, startMs: 60000 }];
  assert.equal(findPart(parts, 0).seq, 1);
  assert.equal(findPart(parts, 59999).seq, 1);
  assert.equal(findPart(parts, 60000).seq, 2);
  assert.equal(findPart(parts, 999999).seq, 2);
});

test('findPart: 경계 — 첫 파트 이전이면 첫 파트, 빈 배열이면 null', () => {
  assert.equal(findPart([{ seq: 1, startMs: 5000 }], 100).seq, 1);
  assert.equal(findPart([], 100), null);
});

test('transcriptToSegments: 파트 오프셋 합산 + 정렬 + 클램프', () => {
  const items = [
    { startSec: 10, original: 'b', translated: 'B' },
    { startSec: 2.5, original: 'a', translated: 'A' },
    { startSec: -3, original: 'x', translated: 'X' },
  ];
  const segs = transcriptToSegments(items, 60000);
  assert.deepEqual(segs.map(g => g.tsMs), [60000, 62500, 70000]);
  assert.equal(segs[1].originalText, 'a');
  assert.equal(segs[1].translatedText, 'A');
});
```

(파일 상단에 이미 `test`/`assert` import가 있으면 재사용 — 기존 테스트 파일의 import 스타일 `import test from 'node:test'; import assert from 'node:assert/strict';`를 따른다.)

- [ ] **Step 2: 실패 확인** — Run: `node --test test/helpers.test.mjs` → Expected: FAIL (`findPart is not a function` 류)

- [ ] **Step 3: 구현** — `js/helpers.js` 끝에 추가:

```js
// ---- 녹음/사후 전사 ----
// parts: {seq, startMs} 오름차순. tsMs가 속한 파트(startMs<=tsMs인 마지막) 선택.
export const findPart = (parts, tsMs) =>
  parts.filter(p => p.startMs <= tsMs).at(-1) ?? parts[0] ?? null;

// 배치 전사 응답 [{startSec, original, translated}] → 세그먼트 필드로 변환
export const transcriptToSegments = (items, partStartMs) =>
  items
    .map(t => ({
      tsMs: partStartMs + Math.max(0, Math.round((t.startSec || 0) * 1000)),
      originalText: (t.original || '').trim(),
      translatedText: (t.translated || '').trim(),
    }))
    .sort((a, b) => a.tsMs - b.tsMs);
```

- [ ] **Step 4: 통과 확인** — Run: `node --test` → Expected: 전체 PASS
- [ ] **Step 5: Commit** — `git add js/helpers.js test/helpers.test.mjs && git commit -m "feat: 녹음 파트 선택·전사 매핑 순수 헬퍼"`

---

### Task 2: DB 스키마 — recordings 테이블 + sessions.mode + Storage 정책

**Files:**
- Modify: `supabase/schema.sql` (파일 끝에 추가)

**Interfaces:**
- Produces: `public.recordings(session_id, seq, start_ms, dur_ms, path, created_at)`, `sessions.mode ('live'|'rec')`, private 버킷 `recordings`.

- [ ] **Step 1: schema.sql 끝에 추가**

```sql
-- ---- 세션 녹음 (WS1) ----
alter table public.sessions add column mode text not null default 'live'
  check (mode in ('live', 'rec'));

create table public.recordings (
  session_id uuid not null references public.sessions on delete cascade,
  seq        integer not null check (seq > 0),
  start_ms   integer not null check (start_ms >= 0),
  dur_ms     integer not null check (dur_ms >= 0),
  path       text not null,
  created_at timestamptz not null default now(),
  primary key (session_id, seq)
);

alter table public.recordings enable row level security;
create policy "users manage recordings in own sessions"
  on public.recordings for all to authenticated
  using (exists (select 1 from public.sessions s
                 where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.sessions s
                      where s.id = session_id and s.user_id = auth.uid()));
revoke all on table public.recordings from anon;
grant select, insert, delete on table public.recordings to authenticated;

-- Storage: private 버킷, 경로 1번째 폴더 = 본인 uid 인 파일만 접근
insert into storage.buckets (id, name, public) values ('recordings', 'recordings', false);
create policy "own recordings select" on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own recordings insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own recordings delete" on storage.objects for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 2: 사용자에게 실행 요청** — 이 SQL은 자동 적용되지 않는다. Supabase SQL Editor에서 위 블록을 실행해야 한다고 **작업 로그/최종 보고에 명시**할 것 (기존 프로젝트 관행 — schema.sql은 기록, 적용은 대시보드). **주의: 이 SQL이 DB에 적용되기 전에 WS1 코드가 배포되면 세션 upsert가 `mode` 컬럼 없음(42703)으로 실패하고 sync 큐에서 영구 오류로 폐기된다 — 머지/배포 전 SQL 적용이 선행 조건.**
- [ ] **Step 3: Commit** — `git add supabase/schema.sql && git commit -m "feat: recordings 테이블·sessions.mode·Storage 정책 스키마"`

---

### Task 3: `js/recorder.js` — MediaRecorder 래퍼 (신규)

**Files:**
- Create: `js/recorder.js`

**Interfaces:**
- Produces: `pickRecMime()` → `'audio/mp4' | 'audio/webm;codecs=opus' | null`
- Produces: `recExt(mime)` → `'m4a' | 'webm'`
- Produces: `createRecorder(stream, onBlob)` → `MediaRecorder | null`. onBlob은 stop 후 `(blob, mime)`으로 1회 호출. 브라우저 API라 Node 테스트 없음 — 검증은 Task 8 수동 체크.

- [ ] **Step 1: 파일 작성**

```js
// MediaRecorder 래퍼 — 오디오 트랙만 복제해 압축 녹음. DOM 금지.
// mp4(AAC) 우선: iPhone Safari가 webm/opus를 재생하지 못하므로 교차 기기 다시듣기의 공통 포맷.
export function pickRecMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  return null;
}

export const recExt = mime => (mime === 'audio/mp4' ? 'm4a' : 'webm');

export function createRecorder(stream, onBlob) {
  const mime = pickRecMime();
  if (!mime) return null;
  // 탭 소스는 비디오 트랙 포함 — 오디오만 복제해 순수 오디오 파일을 만든다
  const rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()),
    { mimeType: mime, audioBitsPerSecond: 48000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => onBlob(new Blob(chunks, { type: mime }), mime);
  rec.start(1000); // 1s 청크 — 크래시 시 브라우저가 이미 모은 청크는 보존
  return rec;
}
```

- [ ] **Step 2: 문법 확인** — Run: `node --check js/recorder.js` → Expected: 무출력(성공)
- [ ] **Step 3: Commit** — `git add js/recorder.js && git commit -m "feat: MediaRecorder 래퍼 recorder.js"`

---

### Task 4: sync.js — 녹음 업로드/조회 + mode 동기화

**Files:**
- Modify: `js/sync.js`
- Test: `test/sync.test.mjs` (행 매핑만)

**Interfaces:**
- Consumes: Task 2의 recordings 테이블/버킷.
- Produces: `recordingFromRow(r)` → `{seq, startMs, durMs, path}` (모듈 수준 export, 테스트 대상)
- Produces: createSync 반환 객체에 추가 —
  `uploadRecording({ sessionId, seq, startMs, durMs, blob, mime, ext })` → 성공 시 true, 실패 시 throw.
  `listRecordings(sessionId)` → `[{seq, startMs, durMs, path, url}]` (url = 1시간 서명 URL). 미로그인/미설정이면 `[]`.
- Produces: `sessionFromRow`/`sessionToRow`에 `mode` 필드 왕복 (`r.mode ?? 'live'`).

- [ ] **Step 1: 실패하는 테스트** — `test/sync.test.mjs`에 추가 (기존 import 스타일 재사용):

```js
import { recordingFromRow, sessionFromRow, sessionToRow } from '../js/sync.js';

test('recordingFromRow: snake→camel', () => {
  assert.deepEqual(
    recordingFromRow({ session_id: 'x', seq: 2, start_ms: 100, dur_ms: 5000, path: 'u/x/2.m4a' }),
    { seq: 2, startMs: 100, durMs: 5000, path: 'u/x/2.m4a' });
});

test('session row 왕복에 mode 포함, 구 행은 live 기본', () => {
  const s = sessionFromRow({ id: 'a', title: null, target_lang: 'ko', source: 'mic',
    status: 'ready', elapsed_ms: 0, created_at: '2026-07-21T00:00:00Z', ended_at: null,
    updated_at: '2026-07-21T00:00:00Z' });
  assert.equal(s.mode, 'live');
  assert.equal(sessionToRow({ ...s, mode: 'rec' }).mode, 'rec');
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test test/sync.test.mjs` → Expected: FAIL
- [ ] **Step 3: 구현** — `js/sync.js` 수정:

`sessionFromRow`에 `mode: r.mode ?? 'live',` 추가. `sessionToRow`에 `mode: s.mode ?? 'live',` 추가. 파일 상단 매핑 함수들 옆에 추가:

```js
export const recordingFromRow = r => ({
  seq: r.seq, startMs: r.start_ms, durMs: r.dur_ms, path: r.path,
});
```

`createSync` 내부(예: `hydrateSegments` 아래)에 추가하고 반환 객체에 두 함수 포함:

```js
  // 녹음 파트 업로드 — write-behind 큐를 타지 않는다 (Blob은 localStorage에 못 담음).
  // 실패 시 throw — 호출자(app)가 Blob을 들고 RETRY UPLOAD를 노출한다.
  async function uploadRecording({ sessionId, seq, startMs, durMs, blob, mime, ext }) {
    const { data: authData, error: authError } = await client.auth.getSession();
    if (authError || !authData.session) throw authError ?? new Error('NOT_SIGNED_IN');
    const path = `${authData.session.user.id}/${sessionId}/${seq}.${ext}`;
    const { error: upErr } = await client.storage.from('recordings')
      .upload(path, blob, { contentType: mime, upsert: true }); // upsert: 재시도 안전
    if (upErr) throw upErr;
    const { error: insErr } = await client.from('recordings')
      .upsert({ session_id: sessionId, seq, start_ms: startMs, dur_ms: durMs, path },
              { onConflict: 'session_id,seq' });
    if (insErr) throw insErr;
    return true;
  }

  async function listRecordings(sessionId) {
    if (!client) return [];
    const { data, error } = await client.from('recordings')
      .select('*').eq('session_id', sessionId).order('seq');
    if (error || !data?.length) return [];
    const parts = data.map(recordingFromRow);
    const { data: signed, error: sigErr } = await client.storage.from('recordings')
      .createSignedUrls(parts.map(p => p.path), 3600);
    if (sigErr) return [];
    return parts.map((p, i) => ({ ...p, url: signed[i]?.signedUrl ?? null }));
  }
```

반환문을 `return { queueChanged, fullSync, hydrateSegments, uploadRecording, listRecordings, flush: drainQueue, dispose };`로 교체.

- [ ] **Step 4: 통과 확인** — Run: `node --test` → Expected: 전체 PASS
- [ ] **Step 5: Commit** — `git add js/sync.js test/sync.test.mjs && git commit -m "feat: 녹음 업로드/서명URL 조회 + 세션 mode 동기화"`

---

### Task 5: store.js mode + engine.js onStream 콜백

**Files:**
- Modify: `js/store.js:12-19` (createSession)
- Modify: `js/engine.js:118-121` (start 내 트랙 확보 직후)
- Test: `test/store.test.mjs`

**Interfaces:**
- Produces: `store.createSession({ targetLang, source, mode })` — mode 기본 `'live'`, 세션 객체에 `mode` 포함.
- Produces: engine 콜백 `cb.onStream?.(mediaStream)` — start()에서 트랙 검증 통과 직후 1회 호출. 선택적 콜백(없으면 no-op)이라 기존 테스트/호출부와 호환.

- [ ] **Step 1: 실패하는 테스트** — `test/store.test.mjs`에 추가:

```js
test('createSession: mode 기본 live, rec 지정 가능', () => {
  const store = createStore(memStorage()); // 기존 테스트 파일의 스토리지 심 헬퍼 재사용
  assert.equal(store.createSession().mode, 'live');
  assert.equal(store.createSession({ mode: 'rec' }).mode, 'rec');
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test test/store.test.mjs` → Expected: FAIL
- [ ] **Step 3: 구현** — `js/store.js` createSession 시그니처/객체에 mode 추가:

```js
    createSession({ targetLang = 'ko', source = 'mic', mode = 'live' } = {}) {
      const now = Date.now();
      const s = { id: crypto.randomUUID(), title: null, targetLang, source, mode, status: 'ready', elapsedMs: 0, createdAt: now, endedAt: null, updatedAt: now };
```

`js/engine.js` start()의 `track.addEventListener('ended', ...)` 다음 줄에 추가:

```js
      cb.onStream?.(mediaStream);          // 녹음 등 부가 소비자용 — 엔진은 관여하지 않음
```

- [ ] **Step 4: 통과 확인** — Run: `node --test` → Expected: PASS. `node --check js/engine.js` → 무출력
- [ ] **Step 5: Commit** — `git add js/store.js js/engine.js test/store.test.mjs && git commit -m "feat: 세션 mode 필드 + 엔진 onStream 콜백"`

---

### Task 6: app.js — LIVE 녹음 연결 + REC 모드

**Files:**
- Modify: `js/app.js`, `index.html`

**Interfaces:**
- Consumes: `createRecorder/recExt`(Task 3), `sync.uploadRecording/listRecordings`(Task 4), `store mode`(Task 5), `cb.onStream`(Task 5).
- Produces: 전역(모듈) 상태 `recParts`(현재 세션의 파트 수), `pendingUploads` 배열, 함수 `startRecording(stream)`, `stopRecording()`, `retryUploads()`, `captureStream(source)` — Task 7이 `pendingUploads`와 `recParts`를 읽는다.

- [ ] **Step 1: index.html 마크업** — SOURCE rail-sec 위(153행 `<div class="rail-sec">` STATUS 블록 뒤가 아니라 SOURCE 블록 앞)에 MODE 토글 추가, rail-save 위에 재시도 버튼 추가:

```html
      <div class="rail-sec" id="mode-sec">
        <div class="mono">MODE</div>
        <div class="seg-ctl">
          <button id="mode-live" class="seg-on">Live translate</button>
          <button id="mode-rec">Record only</button>
        </div>
        <div id="mode-caption" class="mono" style="font-size:9.5px;color:var(--faint-2)">TRANSLATES IN REAL TIME + RECORDS</div>
      </div>
```

```html
        <button id="rec-retry" class="mono save-btn" hidden>RETRY UPLOAD</button>
```
(`rec-retry`는 `.rail-save` div 안, `save-txt` 앞에 둔다.)

- [ ] **Step 2: app.js — 녹음 상태와 함수** — import에 `createRecorder, recExt` 추가 (`import { createRecorder, recExt } from './recorder.js';`). 세션 컨트롤러 상태 변수들(`let currentId = null;` 부근)에 추가:

```js
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
```

(`loadRecordings`/`runTranscribe`/`transcribePendingFor`는 이 Task에서는 자리만 만든다: `let transcribePendingFor = null; async function loadRecordings() {} async function runTranscribe() {}` — Task 7/8이 본문을 채운다.)

- [ ] **Step 3: app.js — 엔진 onStream + 모드 토글 + doAction 분기**

createEngine 콜백에 추가:

```js
  onStream(stream) { startRecording(stream); },
```

모드 토글(SOURCE 토글 이벤트 부근에 추가):

```js
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
```

`renderSession`에서 컨트롤 복원부(`setSourceUI(s.source);` 다음)에 `setModeUI(s.mode || 'live');` 추가, 세션 진입 시 파트 수 초기화 `recParts = 0; pendingUploads = pendingUploads.filter(p => p.sessionId === id); void loadRecordings(id);` 추가.

로컬 전용/비로그인이면 녹음이 불가능하므로 MODE 섹션 자체를 숨긴다 — MODE rail-sec에 `id="mode-sec"`를 주고 `renderSession`에 추가: `$('mode-sec').hidden = !sb || !currentUser;` (스펙 §3-3).

`doAction` 수정 — start/resume/pause/end에 녹음·REC 분기 (기존 코드 구조 유지, listening 계열 액션만 발췌):

```js
    if (action === 'start') {
      if (!await hydrateSegments(actionId)) return;
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
      if (s.status !== 'paused' && !await hydrateSegments(actionId)) return;
      if (currentId !== actionId) return;
      if (s.status === 'paused' && activeRec?.state === 'paused') {
        if (s.mode !== 'rec') await engine.resume();
        activeRec.resume();
      } else {                              // ended→resume 또는 fresh start: 새 파트
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
      if (s.mode === 'rec' && !store.getSegments(actionId).length) transcribePendingFor = actionId; // 업로드 완료 후 자동 전사
      if (s.mode !== 'rec') engine.stop();
      stopRecording();
      recStream?.getTracks().forEach(t => t.stop()); recStream = null;
      stopTick();
    }
```

`route()`의 세션 이탈 처리(engine.stop() 하는 곳)에도 `stopRecording(); recStream?.getTracks().forEach(t => t.stop()); recStream = null;` 추가. `switchSource`의 `engine.stop()` 지점에도 `stopRecording()` 추가 (소스 전환 = 파트 경계).

`renderStatus`의 상태칩에 모드 반영 — `chip.textContent = ...` 행을:

```js
  const rec = store.getSession(currentId)?.mode === 'rec';
  chip.textContent = { ready: '○ READY', listening: rec ? '● RECORDING' : '● LISTENING', paused: '❚❚ PAUSED', ended: '— ENDED' }[status];
  line.textContent = status === 'listening' ? (rec ? '● RECORDING — TRANSCRIPT AFTER END' : `● TRANSLATING TO ${langName}`) : 'SOURCE LANGUAGE AUTO-DETECTED';
```

REC 모드는 API 키 검사(`NO_KEY`)를 타지 않음 — engine.start를 호출하지 않으므로 자연 충족.

- [ ] **Step 4: 검증** — `node --check js/app.js` → 무출력. `node --test` → PASS. 브라우저(로컬 `npx -y http-server -p 8787 -c-1`): LIVE 세션 시작→END 후 콘솔에 업로드 로그/실패 시 RETRY 버튼, REC 세션이 키 입력창 없이 시작되는지.
- [ ] **Step 5: Commit** — `git add js/app.js index.html && git commit -m "feat: LIVE 녹음 병행 + REC 전용 모드"`

---

### Task 7: 다시듣기 플레이어 + 타임스탬프 점프

**Files:**
- Modify: `index.html`, `js/app.js`

**Interfaces:**
- Consumes: `sync.listRecordings`(Task 4), `findPart`(Task 1), Task 6의 `loadRecordings` 자리.
- Produces: `loadRecordings(id)` 본문 — 모듈 상태 `parts`(현재 세션 파트 배열)를 채우고 플레이어 표시. `seekTo(tsMs)`.

- [ ] **Step 1: index.html — 플레이어 마크업** — `<div class="t-head">` 바로 아래에:

```html
      <div id="player-row" hidden style="display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--hairline);padding:10px 0">
        <audio id="player" controls style="flex:1;height:34px"></audio>
        <select id="player-part" hidden style="width:auto;margin-top:0"></select>
      </div>
```

CSS `<style>`에 추가: `.has-audio .ts { cursor: pointer; } .has-audio .ts:hover { color: var(--acc); }`

- [ ] **Step 2: app.js — loadRecordings/seekTo 구현** — Task 6에서 만든 빈 `loadRecordings`를 교체:

```js
let parts = [];                            // 현재 세션의 녹음 파트 (url 포함)
async function loadRecordings(id) {
  parts = await sync.listRecordings(id);
  if (currentId !== id) return;
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
  const p = parts[i];
  if (!p?.url) return;
  $('player-part').value = i;
  const audio = $('player');
  if (audio.dataset.path !== p.path) { audio.src = p.url; audio.dataset.path = p.path; }
  const apply = () => { audio.currentTime = at; if (play) void audio.play(); };
  if (audio.readyState >= 1) apply();
  else audio.addEventListener('loadedmetadata', apply, { once: true });
}
$('player-part').onchange = e => loadPart(+e.target.value);

function seekTo(tsMs) {
  const p = findPart(parts, tsMs);
  if (!p) return;
  loadPart(parts.indexOf(p), Math.max(0, (tsMs - p.startMs) / 1000), true);
}
```

import에 `findPart` 추가 (helpers import 행). `appendSeg`의 ts 생성부에 클릭 연결:

```js
    ts.textContent = seg.timeLabel;
    ts.onclick = () => { if (parts.length) seekTo(seg.tsMs); };
```

`renderSession`의 `void loadRecordings(id);`는 Task 6에서 이미 호출됨 — 플레이어 초기화를 위해 `$('player').removeAttribute('src'); delete $('player').dataset.path; $('player-row').hidden = true; parts = [];`를 `renderSession` 시작부에 추가.

- [ ] **Step 3: 검증** — `node --check js/app.js`. 브라우저: 녹음 있는 세션 재진입 → 플레이어 표시 → 타임스탬프 클릭 시 해당 시점 재생.
- [ ] **Step 4: Commit** — `git add js/app.js index.html && git commit -m "feat: 다시듣기 플레이어 + 타임스탬프 점프"`

---

### Task 8: 사후 전사 파이프라인 (`js/transcribe.js` + 자동 실행)

**Files:**
- Create: `js/transcribe.js`
- Modify: `js/config.js`, `js/app.js`

**Interfaces:**
- Consumes: `transcriptToSegments`(Task 1), Task 6의 `transcribePendingFor`/`runTranscribe` 자리, Task 7의 `parts`.
- Produces: `config.js`에 `export const BATCH_MODEL = 'gemini-2.5-flash';`
- Produces: `transcribeAudio({ key, blob, mime, targetLang })` → `[{startSec, original, translated}]` (throw on 실패)

- [ ] **Step 1: config.js에 추가** — `MODEL` 정의 아래:

```js
export const BATCH_MODEL = 'gemini-2.5-flash'; // 사후 전사/번역용 (오디오 이해)
```

- [ ] **Step 2: `js/transcribe.js` 작성**

```js
// 녹음 파일 사후 전사+번역 — generateContent(structured output).
// 20MB 이하는 inline, 초과는 Files API 업로드 후 참조.
import { GoogleGenAI } from 'https://esm.run/@google/genai';
import { BATCH_MODEL } from './config.js';

const INLINE_MAX = 20 * 1024 * 1024;

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      startSec: { type: 'NUMBER', description: '문단 시작 시각(초, 오디오 기준)' },
      original: { type: 'STRING', description: '원문 전사' },
      translated: { type: 'STRING', description: '대상 언어 번역' },
    },
    required: ['startSec', 'original', 'translated'],
  },
};

const prompt = targetLang =>
  `이 오디오를 전사하고 번역하라. 원문 언어는 자동 감지한다. ` +
  `발화를 자연스러운 문단 단위로 나누고, 각 문단의 시작 시각(초)을 startSec에 넣어라. ` +
  `original에는 들리는 그대로의 원문을, translated에는 '${targetLang}' 언어 번역을 넣어라. ` +
  `음악·무음 구간은 건너뛴다.`;

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result.split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function audioPart(ai, blob, mime) {
  if (blob.size <= INLINE_MAX)
    return { inlineData: { mimeType: mime, data: await blobToBase64(blob) } };
  let file = await ai.files.upload({ file: blob, config: { mimeType: mime } });
  for (let i = 0; i < 60 && file.state === 'PROCESSING'; i++) {   // 최대 ~2분 대기
    await new Promise(res => setTimeout(res, 2000));
    file = await ai.files.get({ name: file.name });
  }
  if (file.state !== 'ACTIVE') throw new Error('FILE_PROCESSING_FAILED');
  return { fileData: { mimeType: mime, fileUri: file.uri } };
}

export async function transcribeAudio({ key, blob, mime, targetLang }) {
  const ai = new GoogleGenAI({ apiKey: key });
  const part = await audioPart(ai, blob, mime);
  const res = await ai.models.generateContent({
    model: BATCH_MODEL,
    contents: [{ role: 'user', parts: [part, { text: prompt(targetLang) }] }],
    config: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  });
  const items = JSON.parse(res.text);
  if (!Array.isArray(items)) throw new Error('BAD_TRANSCRIPT');
  return items;
}
```

- [ ] **Step 3: app.js — runTranscribe 본문 + TRANSCRIBE 버튼**

import 추가: `import { transcribeAudio } from './transcribe.js';`, helpers import에 `transcriptToSegments` 추가.

Task 6의 빈 `runTranscribe`를 교체:

```js
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
      const items = await transcribeAudio({ key, blob, mime: blob.type || 'audio/mp4', targetLang: s.targetLang });
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
```

`renderControls`의 ended 분기를 수동 재시도 버튼 포함으로 교체:

```js
  else {
    mk('▶ Resume session', 'btn-acc', () => doAction('resume'));
    const s = store.getSession(currentId);
    if (s?.mode === 'rec' && !store.getSegments(currentId).length)
      mk('Transcribe', 'btn-acc-line', () => runTranscribe(currentId));
    else box.firstChild.style.gridColumn = '1 / -1';
  }
```

- [ ] **Step 4: 검증** — `node --check js/app.js js/transcribe.js`. `node --test` → PASS. 브라우저 E2E: REC 세션에서 30초 말하고 END → `TRANSCRIBING…` → 세그먼트 생성 + 타임스탬프 점프 동작. 실패 유도(키 임시 제거) → ended 화면에 Transcribe 버튼.
- [ ] **Step 5: Commit** — `git add js/transcribe.js js/config.js js/app.js && git commit -m "feat: REC 세션 사후 전사+번역 파이프라인"`

---

### Task 9: 최종 검증

- [ ] **Step 1:** `node --test` 전체 PASS, `node --check js/*.js` 전체 무출력
- [ ] **Step 2:** 스펙 §6 체크리스트 중 WS1 항목을 브라우저에서 수동 확인 (LIVE 녹음→플레이어→점프, REC→자동 전사, pause 타임라인 일치, RETRY UPLOAD)
- [ ] **Step 3:** superpowers:requesting-code-review로 리뷰 요청, 발견사항 반영 후 최종 커밋
