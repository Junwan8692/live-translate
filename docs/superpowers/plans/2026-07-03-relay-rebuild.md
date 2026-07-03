# Relay 재구축 구현 계획 (Phase 1 + 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검증된 Gemini Live 번역 엔진을 Relay 디자인(핸드오프 확정안 `2a`)의 2화면 SPA로 재구축하고, 세션/세그먼트를 localStorage 우선 + Supabase write-behind로 영속화한다.

**Architecture:** 빌드 스텝 없는 바닐라 JS 단일 페이지 앱. `index.html`(마크업+CSS) + ES 모듈 4개(`config/helpers/store/engine` + 와이어링 `app`). 순수 로직(헬퍼·스토어·큐)은 Node 내장 테스트 러너로 TDD, 브라우저 전용 코드(엔진·뷰)는 태스크별 브라우저 검증 체크리스트로 확인.

**Tech Stack:** 바닐라 JS (ES modules), `@google/genai`(esm.run CDN), `@supabase/supabase-js@2`(esm.run CDN), Node 22 `node --test`, http-server(기존 `start.cmd`, :8787).

## Global Constraints

- 프레임워크/번들러/npm 의존성 추가 금지. CDN ESM import만 허용 (`https://esm.run/...`).
- 모델명은 `js/config.js`의 `MODEL = 'gemini-3.5-live-translate-preview'` 한 곳에서만 정의.
- 디자인 픽셀/색/타이포의 원본 계약: `실시간 번역 웹사이트 디자인/design_handoff_relay_live_translation/README.md` (이하 "디자인 README"). 확정안은 `Relay Design.dc.html`의 `#t2` 섹션 `2a` 카드. `#t1`은 폐기 시안 — 절대 참조 금지.
- Gemini API 키는 localStorage(`gemini-key`)에만 저장. Supabase에 절대 업로드 금지. 오디오 원본도 업로드 금지(텍스트 전사만).
- 순수 로직 모듈(`helpers.js`, `store.js`)에서 DOM/window 접근 금지 (Node 테스트 가능해야 함).
- 테스트: `node --test test/` (의존성 0). 브라우저 검증: `start.cmd` 실행 후 http://localhost:8787.
- 기존 검증 노하우 보존 (docs/PLAN.md §4-2): ① turnComplete 없음 → 텍스트 수신 시에만 2.5s 디바운스 flush(오디오 청크로 리셋 금지) ② `gen` 카운터 재연결 가드 ③ 언어 변경 = flush 후 `session.close()` → onclose 재연결.
- 커밋 메시지는 conventional commits (`feat:`, `test:`, `chore:`).

## 파일 구조 (전체 태스크가 만들 최종 상태)

```
D:\code\live-translate\
├── index.html          # SPA 셸: Relay CSS 토큰/스타일 + 두 뷰 마크업 + app.js 로드
├── legacy.html         # 기존 구현 보존본 (엔진 이식 원본)
├── js/
│   ├── config.js       # MODEL, SUPABASE_URL, SUPABASE_ANON_KEY 상수
│   ├── helpers.js      # 순수 포맷터 + 상태머신 + TXT 직렬화 (Node 테스트 대상)
│   ├── store.js        # 세션/세그먼트 CRUD + localStorage 영속화 + 동기화 큐 (Node 테스트 대상)
│   ├── engine.js       # Gemini Live 연결/오디오 (브라우저 전용, legacy.html에서 이식)
│   └── app.js          # 해시 라우터 + 두 뷰 렌더링 + 이벤트/동기화 와이어링 (브라우저 전용)
├── test/
│   ├── helpers.test.mjs
│   └── store.test.mjs
├── supabase/
│   └── schema.sql      # 테이블 + RLS (Supabase SQL Editor에서 1회 실행)
├── start.cmd           # 기존 유지 (npx http-server -p 8787)
└── docs/PLAN.md        # 승인된 기획서 (본 계획의 상위 문서)
```

**모듈 간 인터페이스 요약** (각 태스크의 Interfaces 블록이 상세 계약):
`app.js` → `createStore(localStorage)`, `createEngine(callbacks)`, helpers 전부, config 상수.
`store.js` → 주입받은 storage 인터페이스(`getItem/setItem/removeItem`)만 사용.
`engine.js` → 콜백(`getKey/getLang/onStatus/onPartial/onSegment/onError`)으로만 외부와 통신. DOM 접근 금지.

**범위**: 기획서 Phase 1(UI 재구축+세션화) + Phase 2(Supabase). Phase 3 고도화(AudioWorklet, PWA, session resumption, 자동 제목 생성, 검색)는 이 계획에 없음 — 완료 후 별도 계획.

---

### Task 1: Git 초기화 & 스캐폴드

**Files:**
- Create: `.gitignore`, `js/config.js`, `legacy.html` (기존 index.html 복사본)
- 디렉토리 생성: `js/`, `test/`, `supabase/`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `js/config.js`가 `export const MODEL = 'gemini-3.5-live-translate-preview'`, `export const SUPABASE_URL = ''`, `export const SUPABASE_ANON_KEY = ''` 을 내보냄. 이후 모든 태스크는 git 커밋 가능 상태를 전제.

- [ ] **Step 1: git 초기화 및 .gitignore 작성**

```powershell
git init
```

`.gitignore` 내용:

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 2: 기존 구현 보존**

```powershell
Copy-Item index.html legacy.html
```

(index.html은 Task 4에서 새로 작성되어 덮어씀. legacy.html이 엔진 이식 원본.)

- [ ] **Step 3: 디렉토리와 config.js 생성**

`js/config.js`:

```js
// 모델명/Supabase 접속 정보 단일 정의처. Supabase 값은 Task 9에서 채움 — 비어 있으면 앱은 로컬 전용으로 동작.
export const MODEL = 'gemini-3.5-live-translate-preview';
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
```

- [ ] **Step 4: 스모크 확인**

Run: `node --test test/` → Expected: 테스트 0개로 통과(에러 없이 종료). `git status` → legacy.html, js/config.js, .gitignore 표시.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "chore: init repo, preserve legacy app, scaffold module layout"
```

---

### Task 2: helpers.js — 순수 헬퍼 + 상태머신 (TDD)

**Files:**
- Create: `js/helpers.js`
- Test: `test/helpers.test.mjs`

**Interfaces:**
- Consumes: 없음 (의존성 0, DOM 금지)
- Produces (이후 모든 태스크가 사용하는 정확한 시그니처):
  - `shortId(uuid: string): string` — 하이픈 제거 후 앞 8자
  - `timeLabel(d: Date): string` — `"14:02"`
  - `autoTitle(d: Date): string` — `"Session 07-03 14:02"`
  - `fmtTimer(ms: number): string` — `"00:14:37"`
  - `fmtDateHeader(d: Date): string` — `"2026.07.03 — SEOUL"`
  - `fmtIndexMeta(session): string` — `"07.02 · AUTO→KO · 41 MIN"` (srcLang 미감지 v1은 AUTO 고정, 기획서 §7-2)
  - `countWords(segments): number` — originalText 공백 분리 단어 수 합
  - `transition(status, action): string|null` — 상태머신. `ready+start→listening`, `listening+pause→paused`, `paused+resume→listening`, `listening|paused+end→ended`, 그 외 `null`
  - `toTxt(session, segments): string` — .TXT 다운로드 본문

- [ ] **Step 1: 실패하는 테스트 작성** — `test/helpers.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortId, timeLabel, autoTitle, fmtTimer, fmtDateHeader, fmtIndexMeta, countWords, transition, toTxt } from '../js/helpers.js';

const d = new Date(2026, 6, 3, 14, 2, 7); // 2026-07-03 14:02:07

test('shortId: uuid 앞 8자', () => {
  assert.equal(shortId('a93b18d4-1111-2222-3333-444455556666'), 'a93b18d4');
});

test('timeLabel / autoTitle / fmtDateHeader', () => {
  assert.equal(timeLabel(d), '14:02');
  assert.equal(autoTitle(d), 'Session 07-03 14:02');
  assert.equal(fmtDateHeader(d), '2026.07.03 — SEOUL');
});

test('fmtTimer: ms → HH:MM:SS', () => {
  assert.equal(fmtTimer(0), '00:00:00');
  assert.equal(fmtTimer(877000), '00:14:37');
  assert.equal(fmtTimer(3661000), '01:01:01');
});

test('fmtIndexMeta: 날짜 · 언어쌍 · 분', () => {
  const s = { createdAt: d.getTime(), targetLang: 'ko', elapsedMs: 41 * 60000 };
  assert.equal(fmtIndexMeta(s), '07.03 · AUTO→KO · 41 MIN');
});

test('countWords: 원문 단어 수 합', () => {
  assert.equal(countWords([{ originalText: 'hello world' }, { originalText: ' one  two three ' }, { originalText: '' }]), 5);
});

test('transition: 디자인 명세 상태 전이만 허용', () => {
  assert.equal(transition('ready', 'start'), 'listening');
  assert.equal(transition('listening', 'pause'), 'paused');
  assert.equal(transition('paused', 'resume'), 'listening');
  assert.equal(transition('listening', 'end'), 'ended');
  assert.equal(transition('paused', 'end'), 'ended');
  assert.equal(transition('ready', 'end'), null);   // READY에서 End 비활성 (디자인 명세)
  assert.equal(transition('ended', 'start'), null); // 종료 후 재시작 불가
});

test('toTxt: 타임스탬프 + 원문/번역 쌍', () => {
  const txt = toTxt({ title: 'T' }, [{ timeLabel: '14:02', originalText: 'Hi', translatedText: '안녕' }]);
  assert.ok(txt.includes('[14:02]'));
  assert.ok(txt.includes('Hi'));
  assert.ok(txt.includes('안녕'));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/helpers.test.mjs`
Expected: FAIL — `Cannot find module ... helpers.js`

- [ ] **Step 3: 구현** — `js/helpers.js`:

```js
// 순수 헬퍼 — 브라우저/Node 공용. DOM/window 접근 금지.
const p2 = n => String(n).padStart(2, '0');

export const shortId = id => id.replaceAll('-', '').slice(0, 8);
export const timeLabel = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const autoTitle = d => `Session ${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${timeLabel(d)}`;
export const fmtTimer = ms => {
  const s = Math.floor(ms / 1000);
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
};
export const fmtDateHeader = d => `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} — SEOUL`;
export const fmtIndexMeta = s => {
  const c = new Date(s.createdAt);
  const mins = Math.round((s.elapsedMs || 0) / 60000);
  return `${p2(c.getMonth() + 1)}.${p2(c.getDate())} · ${(s.srcLang || 'AUTO').toUpperCase()}→${s.targetLang.toUpperCase()} · ${mins} MIN`;
};
export const countWords = segs =>
  segs.reduce((n, g) => n + (g.originalText.trim() ? g.originalText.trim().split(/\s+/).length : 0), 0);

// 상태머신: 디자인 README "State Management" 절의 전이만 허용
const TRANSITIONS = {
  ready: { start: 'listening' },
  listening: { pause: 'paused', end: 'ended' },
  paused: { resume: 'listening', end: 'ended' },
};
export const transition = (status, action) => TRANSITIONS[status]?.[action] ?? null;

export const toTxt = (session, segs) =>
  segs.map(g => `[${g.timeLabel}]\n원문: ${g.originalText}\n번역: ${g.translatedText}\n`).join('\n');
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/helpers.test.mjs`
Expected: PASS — 8 tests, 0 fail

- [ ] **Step 5: Commit**

```powershell
git add js/helpers.js test/helpers.test.mjs
git commit -m "feat: pure helpers - formatters, state machine, txt serializer"
```

---

### Task 3: store.js — 세션/세그먼트 CRUD + 동기화 큐 (TDD)

**Files:**
- Create: `js/store.js`
- Test: `test/store.test.mjs`

**Interfaces:**
- Consumes: 없음. storage는 **주입**받음 — `{ getItem(k), setItem(k,v), removeItem(k) }` (브라우저에선 `localStorage`, 테스트에선 Map 심).
- Produces: `createStore(storage)` → 아래 메서드를 가진 객체. **이후 태스크(5,7,8,10,11)가 이 시그니처에 의존.**
  - `listSessions(): Session[]` — createdAt 내림차순
  - `getSession(id): Session|null`
  - `createSession({targetLang='ko', source='mic'}): Session` — `{id(uuid), title:null, targetLang, source, status:'ready', elapsedMs:0, createdAt(ms), endedAt:null, updatedAt(ms)}`
  - `updateSession(id, patch): Session|null` — 병합 + updatedAt 갱신 + 큐 적재
  - `getSegments(sessionId): Segment[]` — `{seq, tsMs, timeLabel, originalText, translatedText, srcLang}`
  - `addSegment(sessionId, seg): Segment` — seq 자동 부여(1부터) + 큐 적재
  - `setSegments(sessionId, segs): void` — 원격 lazy 로드 결과 캐시용 (큐 적재 안 함)
  - `mergeRemoteSessions(remote: Session[]): void` — id 기준, updatedAt 최신 승리
  - `pendingOps(): Op[]` — `{type:'session'|'segment', id: sessionId, seq?}` (페이로드가 아닌 **참조**만 저장 — push 시점에 최신 데이터를 읽으므로 stale 없음)
  - `enqueue(op): void` — 동일 op 중복 제거
  - `drain(push: async (op, store) => void): Promise<number>` — 앞에서부터 push, 실패 시 중단·잔여 보존, 남은 개수 반환
- localStorage 키: `relay.sessions`, `relay.segments.{sessionId}`, `relay.queue`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/store.test.mjs`:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
};

let store;
beforeEach(() => { store = createStore(memStorage()); });

test('createSession: 기본값과 uuid', () => {
  const s = store.createSession();
  assert.match(s.id, /^[0-9a-f-]{36}$/);
  assert.equal(s.status, 'ready');
  assert.equal(s.targetLang, 'ko');
  assert.equal(s.source, 'mic');
  assert.equal(s.title, null);
  assert.equal(store.getSession(s.id).id, s.id);
});

test('listSessions: createdAt 내림차순', () => {
  const a = store.createSession();
  store.updateSession(a.id, {});               // updatedAt만 변경
  const b = store.createSession();
  b.createdAt += 1000;                          // 강제로 더 늦게
  store.updateSession(b.id, { createdAt: b.createdAt });
  assert.equal(store.listSessions()[0].id, b.id);
});

test('updateSession: 병합 + updatedAt 증가, 없는 id는 null', () => {
  const s = store.createSession();
  const before = s.updatedAt;
  const u = store.updateSession(s.id, { title: 'My talk', status: 'listening' });
  assert.equal(u.title, 'My talk');
  assert.equal(u.status, 'listening');
  assert.ok(u.updatedAt >= before);
  assert.equal(store.updateSession('nope', {}), null);
});

test('addSegment: seq 자동 부여, getSegments 순서 유지', () => {
  const s = store.createSession();
  const g1 = store.addSegment(s.id, { tsMs: 0, timeLabel: '14:02', originalText: 'Hi', translatedText: '안녕', srcLang: null });
  const g2 = store.addSegment(s.id, { tsMs: 5000, timeLabel: '14:02', originalText: 'Bye', translatedText: '잘가', srcLang: null });
  assert.equal(g1.seq, 1);
  assert.equal(g2.seq, 2);
  assert.deepEqual(store.getSegments(s.id).map(g => g.originalText), ['Hi', 'Bye']);
});

test('mergeRemoteSessions: updatedAt 최신 승리', () => {
  const s = store.createSession();
  const localTitle = store.updateSession(s.id, { title: 'local' });
  store.mergeRemoteSessions([{ ...localTitle, title: 'remote-old', updatedAt: localTitle.updatedAt - 100 }]);
  assert.equal(store.getSession(s.id).title, 'local');
  store.mergeRemoteSessions([{ ...localTitle, title: 'remote-new', updatedAt: localTitle.updatedAt + 100 }]);
  assert.equal(store.getSession(s.id).title, 'remote-new');
  store.mergeRemoteSessions([{ id: 'brand-new', title: null, targetLang: 'ko', source: 'mic', status: 'ended', elapsedMs: 0, createdAt: 1, endedAt: 2, updatedAt: 3 }]);
  assert.ok(store.getSession('brand-new'));
});

test('큐: create/update/addSegment가 op을 쌓고 중복은 제거', () => {
  const s = store.createSession();
  store.updateSession(s.id, { title: 't' });    // 같은 session op → dedupe
  store.addSegment(s.id, { tsMs: 0, timeLabel: '14:02', originalText: 'a', translatedText: 'b', srcLang: null });
  const ops = store.pendingOps();
  assert.equal(ops.filter(o => o.type === 'session').length, 1);
  assert.equal(ops.filter(o => o.type === 'segment').length, 1);
});

test('drain: 성공 시 비움, 실패 시 중단하고 잔여 보존', async () => {
  const s = store.createSession();
  store.addSegment(s.id, { tsMs: 0, timeLabel: '14:02', originalText: 'a', translatedText: 'b', srcLang: null });
  const pushed = [];
  let failNext = true;
  const push = async op => { if (failNext) { failNext = false; throw new Error('offline'); } pushed.push(op); };
  const remain1 = await store.drain(push);      // 첫 op에서 실패 → 전부 보존
  assert.equal(remain1, 2);
  assert.equal(pushed.length, 0);
  const remain2 = await store.drain(push);      // 재시도 → 전부 성공
  assert.equal(remain2, 0);
  assert.equal(pushed.length, 2);
  assert.equal(store.pendingOps().length, 0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/store.test.mjs`
Expected: FAIL — `Cannot find module ... store.js`

- [ ] **Step 3: 구현** — `js/store.js`:

```js
// 세션/세그먼트 영속화 + write-behind 큐. storage는 주입(localStorage 또는 테스트 심). DOM 금지.
export function createStore(storage) {
  const read = (k, fallback) => { const v = storage.getItem(k); return v ? JSON.parse(v) : fallback; };
  const write = (k, v) => storage.setItem(k, JSON.stringify(v));
  const sessions = () => read('relay.sessions', []);

  const store = {
    listSessions: () => sessions().sort((a, b) => b.createdAt - a.createdAt),
    getSession: id => sessions().find(s => s.id === id) ?? null,

    createSession({ targetLang = 'ko', source = 'mic' } = {}) {
      const now = Date.now();
      const s = { id: crypto.randomUUID(), title: null, targetLang, source, status: 'ready', elapsedMs: 0, createdAt: now, endedAt: null, updatedAt: now };
      write('relay.sessions', [...sessions(), s]);
      store.enqueue({ type: 'session', id: s.id });
      return s;
    },

    updateSession(id, patch) {
      const all = sessions();
      const i = all.findIndex(s => s.id === id);
      if (i < 0) return null;
      all[i] = { ...all[i], ...patch, updatedAt: Date.now() };
      write('relay.sessions', all);
      store.enqueue({ type: 'session', id });
      return all[i];
    },

    getSegments: id => read(`relay.segments.${id}`, []),

    addSegment(id, seg) {
      const segs = store.getSegments(id);
      const full = { seq: segs.length + 1, ...seg };
      write(`relay.segments.${id}`, [...segs, full]);
      store.enqueue({ type: 'segment', id, seq: full.seq });
      return full;
    },

    setSegments: (id, segs) => write(`relay.segments.${id}`, segs),

    mergeRemoteSessions(remote) {
      const byId = new Map(sessions().map(s => [s.id, s]));
      for (const r of remote) {
        const l = byId.get(r.id);
        if (!l || r.updatedAt > l.updatedAt) byId.set(r.id, r);
      }
      write('relay.sessions', [...byId.values()]);
    },

    // ---- write-behind 큐: 페이로드가 아닌 참조만 저장, push 시점에 최신 데이터 조회 ----
    pendingOps: () => read('relay.queue', []),

    enqueue(op) {
      const q = store.pendingOps();
      if (!q.some(o => o.type === op.type && o.id === op.id && o.seq === op.seq)) write('relay.queue', [...q, op]);
    },

    async drain(push) {
      let q = store.pendingOps();
      while (q.length) {
        try { await push(q[0], store); } catch { break; } // 실패 시 중단 — 다음 drain에서 재시도
        q = q.slice(1);
        write('relay.queue', q);
      }
      return q.length;
    },
  };
  return store;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/`
Expected: PASS — helpers 8 + store 7, 0 fail

- [ ] **Step 5: Commit**

```powershell
git add js/store.js test/store.test.mjs
git commit -m "feat: session/segment store with write-behind sync queue"
```

---

### Task 4: index.html — Relay 디자인 토큰 + 두 뷰 마크업 (정적)

**Files:**
- Create: `index.html` (기존 파일은 Task 1에서 legacy.html로 보존됨 — 덮어쓰기 OK)

**Interfaces:**
- Consumes: 디자인 README(§Design Tokens, §Screens/Views — 픽셀 계약 원본), `Relay Design.dc.html` `#t2`의 `2a` 카드 3종(마크업 구조 참고).
- Produces: **아래 id들이 app.js(Task 5, 7, 8, 10, 11)의 DOM 계약.** 임의 변경 금지.
  - 공통: `#view-main`, `#view-session` (라우터가 `hidden` 속성 토글)
  - Main: `#hdr-date`(상단 바 날짜), `#btn-signin`(mono 링크), `#btn-create`, `#idx-rows`(행 컨테이너)
  - Session 레일: `#back-link`, `#s-title`, `#s-meta`, `#waveform`(bar 5개), `#status-chip`, `#timer`, `#lang`(select), `#status-line`, `#src-mic`, `#src-tab`(세그먼트 버튼 2개), `#src-caption`, `#playback`(체크박스), `#controls`(버튼 2개를 상태별로 렌더), `#key-row`+`#api-key`(키 인라인 입력, 기본 hidden), `#save-txt`, `#save-copy`, `#saved-at`
  - Session 전사: `#hdr-src`(예: `● ENGLISH — AUTO`), `#hdr-target`, `#col-original`, `#col-translation`(세그먼트 p 누적), `#cur-original`, `#cur-translation`(파셜), `#caret`, `#footer-stats`, `#scroll-region`(전사 스크롤 컨테이너)
- 이 태스크는 **정적 마크업/CSS만**. JS는 다음 태스크. 두 뷰 모두 보이는 상태로 두고 시각 검증 후, 마지막 스텝에서 `#view-session`에 `hidden` 부여.

- [ ] **Step 1: 문서 골격 + 폰트 + 디자인 토큰 CSS 작성**

`index.html` 상단(head + 토큰). 색상값은 디자인 README §Colors 표에서 그대로:

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relay — Live Translation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,500&family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --acc: #8C1A12;        /* 시작/재개 버튼, 라이브 상태, 타이틀 마침표, 캐럿 */
  --ink: #1C1A14;        /* 제목/강조, 강한 보더, 버튼 호버 배경 */
  --paper: #F6F3EC;      /* 페이지 배경 */
  --surface: #FFFFFF;    /* 셀렉트·세그먼트 배경 */
  --text-2: #4A463C;     /* 보조 본문, 원문 컬럼 */
  --muted: #8A857A;      /* 모노 레이블, 비활성 세그먼트 */
  --faint: #B3AEA1;      /* 타임스탬프, 푸터 메타 */
  --faint-2: #A8A395;    /* 힌트/캡션 */
  --border: #D9D4C6;     /* 인풋/세그먼트 보더 */
  --hairline: #E8E4D9;   /* 구분선 */
  --hairline-warm: #E3DFD2; /* 인덱스 행 구분선, disabled 보더 */
  --disabled-text: #C4BFB2;
  --row-hover: #F5F1E6;
  --on-accent: #FBFAF6;
  --auto-title: #6B665A; /* 자동 생성 제목 */
  --serif-display: 'Playfair Display', serif;
  --sans: 'Noto Sans KR', sans-serif;
  --serif-kr: 'Noto Serif KR', serif;
  --mono: 'IBM Plex Mono', monospace;
}
* { box-sizing: border-box; margin: 0; }
body { background: var(--paper); color: var(--ink); font-family: var(--sans); }
button { font: inherit; cursor: pointer; background: none; border: none; border-radius: 0; }
.mono { font-family: var(--mono); font-weight: 500; text-transform: uppercase; letter-spacing: 0.16em; font-size: 10px; color: var(--muted); }
/* 버튼 변형 — radius 2px는 버튼만, box-shadow 전면 금지 (디자인 README §Spacing/Misc) */
.btn { font-family: var(--sans); font-weight: 500; font-size: 13px; padding: 13px 0; border-radius: 2px; transition: all 140ms ease; }
.btn-acc { background: var(--acc); color: var(--on-accent); }
.btn-acc:hover { background: var(--ink); }
.btn-ink-line { border: 1px solid var(--ink); color: var(--ink); }
.btn-ink-line:hover { background: var(--ink); color: var(--on-accent); }
.btn-acc-line { border: 1px solid var(--acc); color: var(--acc); }
.btn-acc-line:hover { background: var(--acc); color: var(--on-accent); }
.btn[disabled] { border: 1px solid var(--hairline-warm); color: var(--disabled-text); cursor: not-allowed; background: none; }
</style>
</head>
```

- [ ] **Step 2: Main 뷰 마크업 + 스타일**

디자인 README §Screens 1번(Main) 명세대로. 구조:

```html
<body>
<div id="view-main">
  <div class="main-wrap"><!-- 1120px, 패딩 48px 72px 64px -->
    <header class="topbar">
      <span class="mono" style="letter-spacing:0.22em">RELAY — LIVE TRANSLATION</span>
      <span><span class="mono" id="hdr-date"></span> <button class="mono" id="btn-signin">SIGN IN</button></span>
    </header>
    <section class="hero">
      <h1 class="hero-title">Relay<span class="dot">.</span></h1>
      <p class="hero-desc">마이크 또는 탭 오디오를 실시간으로 번역해 텍스트로 기록합니다.<br>세션은 자동 저장되며 언제든 다시 열람할 수 있습니다.</p>
      <div class="cta-row">
        <button id="btn-create" class="btn btn-acc" style="padding:17px 36px;font-size:14px">Create session</button>
        <span class="mono" style="font-size:9.5px">DATE &amp; TIME LOGGED AUTOMATICALLY</span>
      </div>
    </section>
    <section class="index">
      <div class="mono index-label">INDEX — RECENT SESSIONS</div>
      <div id="idx-rows"></div>
    </section>
  </div>
</div>
```

CSS 핵심값(README 명세 → 셀렉터): `.main-wrap{max-width:1120px;margin:0 auto;padding:48px 72px 64px}` · `.topbar{display:flex;justify-content:space-between;border-bottom:1px solid var(--ink);padding-bottom:14px}` · `.hero-title{font-family:var(--serif-display);font-style:italic;font-weight:500;font-size:128px;line-height:1;letter-spacing:-0.02em;margin-top:64px}` · `.dot{color:var(--acc)}` · `.hero-desc{font-family:var(--serif-kr);font-size:16.5px;line-height:1.85;color:var(--text-2);margin-top:28px}` · `.cta-row{display:flex;align-items:center;gap:20px;margin-top:40px}` · `.index{margin-top:72px}` · `.index-label{border-bottom:1px solid var(--ink);padding-bottom:10px}` · 행(`.idx-row`, Task 5에서 JS 생성): `display:grid;grid-template-columns:48px 1fr auto;align-items:baseline;padding:20px 4px;border-bottom:1px solid var(--hairline-warm)`, hover 배경 `var(--row-hover)`, 번호 `font-family:var(--mono);font-size:12px;color:var(--acc)`, 제목 세리프 21px(자동 제목은 `color:var(--auto-title);font-weight:400`), 메타 mono 10.5px `var(--muted)`.

- [ ] **Step 3: Session 뷰 마크업 + 스타일**

디자인 README §Screens 2번(Session) 명세대로. 구조(레일 섹션 순서 고정):

```html
<div id="view-session">
  <div class="session-grid"><!-- grid: 300px 1fr, min-height 100vh -->
    <aside class="rail">
      <button id="back-link" class="mono">← SESSIONS</button>
      <div class="rail-sec">
        <h2 id="s-title" class="rail-title" title="클릭해서 이름 변경"></h2>
        <div class="mono" id="s-meta" style="font-size:10px;color:var(--faint-2);text-transform:none"></div>
      </div>
      <div class="rail-sec">
        <div class="mono">STATUS</div>
        <div class="status-row">
          <span id="waveform"><i></i><i></i><i></i><i></i><i></i></span>
          <span id="status-chip" class="mono">○ READY</span>
        </div>
        <div id="timer">00:00:00</div>
      </div>
      <div class="rail-sec">
        <label class="mono" for="lang">LANGUAGE</label>
        <select id="lang">
          <option value="ko" selected>Korean — 한국어</option>
          <option value="en">English</option>
          <option value="ja">Japanese — 日本語</option>
          <option value="zh-CN">Chinese — 中文</option>
          <option value="es">Spanish — Español</option>
        </select>
        <div id="status-line" class="mono" style="font-size:10px">SOURCE LANGUAGE AUTO-DETECTED</div>
        <label class="playback-row mono" style="font-size:10px"><input type="checkbox" id="playback"> PLAY TRANSLATED AUDIO</label>
      </div>
      <div class="rail-sec">
        <div class="mono">SOURCE</div>
        <div class="seg-ctl">
          <button id="src-mic" class="seg-on">Microphone</button>
          <button id="src-tab">Tab audio</button>
        </div>
        <div id="src-caption" class="mono" style="font-size:9.5px;color:var(--faint-2)">INPUT: MICROPHONE</div>
      </div>
      <div class="rail-sec">
        <div class="mono">CONTROLS</div>
        <div id="controls"></div><!-- 상태별 버튼 2개를 app.js가 렌더 -->
        <div id="key-row" hidden>
          <label class="mono" for="api-key" style="font-size:9.5px">GEMINI API KEY</label>
          <input id="api-key" type="password" autocomplete="off" placeholder="aistudio.google.com/apikey">
        </div>
      </div>
      <div class="rail-sec rail-save">
        <button id="save-txt" class="mono save-btn">.TXT ↓</button>
        <button id="save-copy" class="mono save-btn">COPY</button>
        <div id="saved-at" class="mono" style="font-size:9.5px;color:var(--faint)"></div>
      </div>
    </aside>
    <main class="transcript">
      <div class="t-head"><!-- 하단 보더 ink 1px -->
        <div><span class="mono">ORIGINAL</span> <span id="hdr-src" class="mono" style="color:var(--acc)">● AUTO</span></div>
        <div><span class="mono">TRANSLATION</span> <span id="hdr-target" class="mono">KOREAN</span></div>
      </div>
      <div class="t-body" id="scroll-region">
        <div class="t-col t-col-src"><div id="col-original"></div><p id="cur-original" class="partial"></p></div>
        <div class="t-col t-col-dst"><div id="col-translation"></div><p id="cur-translation" class="partial"><span id="caret" hidden></span></p></div>
      </div>
      <div class="t-foot mono" style="font-size:9.5px;color:var(--faint)">
        <span>NEW LINES APPEAR AT THE BOTTOM — AUTO-SCROLL ON</span>
        <span id="footer-stats">0 SEGMENTS · 0 WORDS</span>
      </div>
    </main>
  </div>
</div>
<script type="module" src="js/app.js"></script>
</body>
</html>
```

CSS 핵심값: `.session-grid{display:grid;grid-template-columns:300px 1fr;min-height:100vh}` · `.rail{padding:36px 30px;display:flex;flex-direction:column;border-right:1px solid var(--hairline)}` · `.rail-sec{margin-top:26px;padding-top:24px;border-top:1px solid var(--hairline)}` · `.rail-save{margin-top:auto}` · `.rail-title{font-family:var(--serif-display);font-style:italic;font-weight:500;font-size:30px;line-height:1.2}` (마침표 `.dot` accent) · `#timer{font-family:var(--mono);font-size:30px;letter-spacing:0.02em;margin-top:12px;color:var(--disabled-text)}` · 웨이브폼: `#waveform i{display:inline-block;width:2px;margin-right:2px;background:var(--muted);opacity:0.35}` 높이 각각 6/13/9/14/7px, 라이브 시 `.live i{background:var(--acc);opacity:1}` · `select{width:100%;background:var(--surface);border:1px solid var(--border);padding:13px 14px;font:inherit;border-radius:0;margin-top:10px}` hover 보더 ink · 세그먼트 컨트롤: `.seg-ctl{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);margin-top:10px}` `.seg-ctl button{padding:11px 0;font-size:13px;color:var(--muted);background:var(--surface)}` `.seg-on{background:var(--ink);color:var(--on-accent)}` · `#controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}` · `.save-btn{border:1px solid var(--border);padding:10px 14px;font-size:11px}` hover 보더 ink · `.transcript{display:flex;flex-direction:column;padding:36px 44px;height:100vh}` · `.t-head{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--ink);padding-bottom:12px}` · `.t-body{display:grid;grid-template-columns:1fr 1fr;flex:1;overflow-y:auto;min-height:0}` · `.t-col{padding:24px 32px 24px 0}` `.t-col-dst{border-left:1px solid var(--hairline);padding-left:32px}` · 원문 p: `font-family:var(--sans);font-size:14.5px;line-height:1.85;color:var(--text-2);margin-bottom:20px` · 번역 p: `font-family:var(--serif-kr);font-size:16px;line-height:1.95;color:var(--ink);margin-bottom:22px` · 타임스탬프 span `.ts{font-family:var(--mono);font-weight:500;font-size:10.5px;color:var(--faint);margin-right:10px}` · `.partial{opacity:0.65}` · `#caret{display:inline-block;width:8px;height:15px;background:var(--acc);vertical-align:-2px;margin-left:2px}` · `.t-foot{display:flex;justify-content:space-between;border-top:1px solid var(--hairline);padding-top:12px}` · `#api-key{width:100%;border:1px solid var(--border);background:var(--surface);padding:10px 12px;font:inherit;margin-top:6px}`

- [ ] **Step 4: 브라우저 시각 검증 (두 뷰 모두 노출 상태로)**

Run: `start.cmd` → http://localhost:8787
체크리스트 (디자인 README 대조):
- [ ] 배경 웜 페이퍼 #F6F3EC, 그림자 어디에도 없음, 카드/인풋 radius 0 (버튼만 2px)
- [ ] `Relay.` 128px Playfair Italic, 마침표만 accent
- [ ] 상단 바 아래 ink 1px 보더, 전사 헤더 아래 ink 1px 보더 (나머지 구분선은 hairline)
- [ ] 레일 300px 고정 + 섹션 hairline 구분, SAVE가 레일 최하단
- [ ] 전사 2단 1fr/1fr + 중앙 hairline, 웨이브폼 바 5개 높이 6/13/9/14/7px
- [ ] 폰트 4종 모두 로드됨 (개발자도구 Network에서 확인)

- [ ] **Step 5: 세션 뷰 숨김 처리 후 커밋**

`<div id="view-session">` → `<div id="view-session" hidden>` 으로 변경. (app.js가 없는 동안 콘솔의 `js/app.js` 404 에러는 정상 — Task 5에서 해소.)

```powershell
git add index.html
git commit -m "feat: Relay design markup and token CSS for main/session views"
```

---

### Task 5: app.js — 해시 라우터 + Main 뷰

**Files:**
- Create: `js/app.js`

**Interfaces:**
- Consumes: Task 2 helpers(`shortId, autoTitle, fmtDateHeader, fmtIndexMeta, countWords`), Task 3 `createStore(localStorage)`, Task 4 DOM id 계약.
- Produces: `route()` 라우터 — `#/` → Main, `#/s/{id}` → Session. `renderMain()`, `renderSession(id)` 함수 골격. **Task 7이 `renderSession`을 확장**하므로 함수 분리 유지. 전역 단일 `store` 인스턴스.

- [ ] **Step 1: 라우터 + Main 렌더 구현** — `js/app.js`:

```js
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
```

`.idx-row` 관련 CSS가 Task 4에서 텍스트로만 명세되었으므로 index.html `<style>`에 실제로 존재하는지 확인하고, 없으면 추가:

```css
.idx-row { display: grid; grid-template-columns: 48px 1fr auto; align-items: baseline; padding: 20px 4px; border-bottom: 1px solid var(--hairline-warm); cursor: pointer; }
.idx-row:hover { background: var(--row-hover); }
.idx-num { font-family: var(--mono); font-size: 12px; color: var(--acc); }
.idx-title { font-family: var(--serif-display); font-weight: 500; font-size: 21px; }
.idx-title-auto { color: var(--auto-title); font-weight: 400; }
.idx-meta { font-size: 10.5px; }
```

- [ ] **Step 2: 브라우저 검증**

Run: `start.cmd` → http://localhost:8787
- [ ] 초기 화면 Main만 보임, 상단 바 날짜 오늘 날짜
- [ ] **Create session** 클릭 → 즉시 세션 화면(`#/s/{uuid}`), 레일에 자동 제목 `Session 07-03 HH:MM.` + 메타(8자 hex · 일시)
- [ ] `← SESSIONS` 클릭 → Main 복귀, 인덱스에 방금 세션 행(번호/제목/`07.03 · AUTO→KO · 0 MIN`) 표시, 행 hover 배경 변화
- [ ] 행 클릭 → 다시 세션 화면. 새로고침해도 목록 유지 (localStorage)
- [ ] 콘솔 에러 0건

- [ ] **Step 3: Commit**

```powershell
git add js/app.js index.html
git commit -m "feat: hash router, main index view, create-session flow"
```

---

### Task 6: engine.js — Gemini Live 엔진 이식

**Files:**
- Create: `js/engine.js`
- 참고(읽기 전용): `legacy.html`의 `<script type="module">` 블록 — 검증된 원본. **아래 코드는 그 로직을 콜백 API로 감싼 것. 디바운스/gen 카운터/오디오 처리 로직을 임의로 "개선"하지 말 것.**

**Interfaces:**
- Consumes: `js/config.js`의 `MODEL`.
- Produces: `createEngine(cb)` — **Task 7이 이 계약에 의존.**
  - `cb`: `{ getKey(): string, getLang(): string, onStatus(text: string), onPartial({original, translated}), onSegment({originalText, translatedText}), onError(msg: string) }`
  - 반환: `{ start(source: 'mic'|'tab'): Promise<void>, pause(), resume(): Promise<void>, stop(), setPlayback(on: boolean), restartLanguage() }`
  - `onSegment`은 flush(2.5s 무텍스트) 시점에만 호출, 빈 세그먼트는 호출 안 함. `onPartial`은 텍스트 청크마다 호출(빈 문자열로 초기화 신호 포함).
  - `pause()`는 mediaStream을 **유지**(탭 캡처 재선택 방지), 오디오 펌프와 Live 세션만 종료. `stop()`은 전부 정리.

- [ ] **Step 1: 구현** — `js/engine.js`:

```js
import { GoogleGenAI, Modality } from 'https://esm.run/@google/genai';
import { MODEL } from './config.js';

export function createEngine(cb) {
  let session = null, mediaStream = null, inCtx = null, outCtx = null, proc = null;
  let running = false, paused = false, nextPlayTime = 0, curIn = '', curOut = '';
  let gen = 0, flushTimer = null, playback = false;

  async function connect(key, myGen) {
    const lang = cb.getLang(); // 연결 시점 고정 — 변경 시 restartLanguage()가 재연결시킴
    const ai = new GoogleGenAI({ apiKey: key });
    session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: { targetLanguageCode: lang, echoTargetLanguage: false },
      },
      callbacks: {
        onopen: () => cb.onStatus(`listening:${lang}`),
        onmessage: handleMessage,
        onerror: e => cb.onError(e.message),
        onclose: () => {
          if (running && !paused && myGen === gen) {
            cb.onStatus('reconnecting');
            setTimeout(() => {
              if (running && !paused && myGen === gen)
                connect(key, myGen).catch(e => cb.onError('재연결 실패: ' + e.message));
            }, 600);
          }
        },
      },
    });
  }

  function handleMessage(msg) {
    const c = msg.serverContent;
    if (!c) return;
    let gotText = false;
    if (c.inputTranscription?.text) { curIn += c.inputTranscription.text; gotText = true; }
    if (c.outputTranscription?.text) { curOut += c.outputTranscription.text; gotText = true; }
    if (gotText) cb.onPartial({ original: curIn, translated: curOut });
    for (const p of c.modelTurn?.parts || []) if (p.inlineData?.data) playChunk(p.inlineData.data);
    // 이 모델은 turnComplete를 보내지 않음 — 텍스트가 2.5초간 없으면 문단 확정.
    // 오디오 청크로 타이머를 리셋하면 안 됨(오디오는 텍스트보다 수 초 뒤까지 옴).
    if (gotText) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 2500); }
  }

  function flush() {
    clearTimeout(flushTimer);
    if (curIn.trim() || curOut.trim())
      cb.onSegment({ originalText: curIn.trim(), translatedText: curOut.trim() });
    curIn = curOut = '';
    cb.onPartial({ original: '', translated: '' });
  }

  // ---------- 오디오 입력 (16kHz PCM16, ~128ms 청크) ----------
  function pumpAudio() {
    inCtx = new AudioContext({ sampleRate: 16000 });
    const src = inCtx.createMediaStreamSource(mediaStream);
    // ponytail: ScriptProcessor는 deprecated지만 AudioWorklet보다 단순. Phase 3에서 교체 검토.
    proc = inCtx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = e => {
      if (!session) return;
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7fff;
      session.sendRealtimeInput({ audio: { data: b64(i16.buffer), mimeType: 'audio/pcm;rate=16000' } });
    };
    src.connect(proc);
    proc.connect(inCtx.destination); // ScriptProcessor는 destination 연결 없이는 동작 안 함(출력은 무음)
  }

  function b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---------- 오디오 출력 (24kHz PCM16) ----------
  function playChunk(b64data) {
    if (!playback) return;
    if (!outCtx) outCtx = new AudioContext({ sampleRate: 24000 });
    const bin = atob(b64data);
    const f32 = new Float32Array(bin.length / 2);
    for (let i = 0; i < f32.length; i++) {
      const v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8); // little-endian
      f32[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
    }
    const buf = outCtx.createBuffer(1, f32.length, 24000);
    buf.getChannelData(0).set(f32);
    const src = outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(outCtx.destination);
    nextPlayTime = Math.max(nextPlayTime, outCtx.currentTime + 0.05);
    src.start(nextPlayTime);
    nextPlayTime += buf.duration;
  }

  function teardownPump() {
    clearTimeout(flushTimer);
    try { proc?.disconnect(); } catch {}
    proc = null;
    inCtx?.close();
    inCtx = null;
  }

  return {
    async start(source) {
      const key = cb.getKey();
      if (!key) { cb.onError('NO_KEY'); throw new Error('NO_KEY'); }
      mediaStream = source === 'tab'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const track = mediaStream.getAudioTracks()[0];
      if (!track) { this.stop(); cb.onError('NO_AUDIO_TRACK'); throw new Error('NO_AUDIO_TRACK'); } // 탭 공유 시 "오디오 공유" 미체크
      track.addEventListener('ended', () => cb.onError('TRACK_ENDED')); // 사용자가 공유 중단 → app이 pause 처리
      running = true; paused = false;
      await connect(key, ++gen);
      pumpAudio();
    },

    pause() {
      paused = true;
      gen++;                     // 진행 중인 onclose 재연결 타이머 무효화
      flush();
      teardownPump();
      try { session?.close(); } catch {}
      session = null;
      // mediaStream은 유지 — resume 시 탭 픽커를 다시 띄우지 않기 위함
    },

    async resume() {
      const key = cb.getKey();
      paused = false;
      await connect(key, ++gen);
      pumpAudio();
    },

    stop() {
      running = false; paused = false;
      gen++;
      flush();
      teardownPump();
      try { session?.close(); } catch {}
      session = null;
      mediaStream?.getTracks().forEach(t => t.stop());
      mediaStream = null;
    },

    setPlayback(on) { playback = on; },

    // 언어 변경: 세션만 닫으면 onclose 가드(myGen===gen 유지)가 새 언어로 재연결
    restartLanguage() { if (session) { flush(); try { session.close(); } catch {} } },
  };
}
```

- [ ] **Step 2: 임시 스모크 테스트 (콘솔)**

Run: `start.cmd` → http://localhost:8787 → 개발자도구 콘솔에서:

```js
const { createEngine } = await import('./js/engine.js');
const e = createEngine({
  getKey: () => localStorage.getItem('gemini-key'),
  getLang: () => 'ko',
  onStatus: s => console.log('[status]', s),
  onPartial: p => console.log('[partial]', p),
  onSegment: g => console.log('[SEGMENT]', g),
  onError: m => console.error('[err]', m),
});
await e.start('mic');  // 마이크 허용 후 영어로 몇 문장 말하기
```

Expected: `[status] listening:ko` → 말하는 동안 `[partial]` 다수 → 침묵 2.5초 후 `[SEGMENT] {originalText, translatedText}` 1회. `e.pause()` 후 콘솔 조용해짐, `await e.resume()` 후 재개, `e.stop()`으로 마이크 표시등 꺼짐 확인.
(localStorage에 `gemini-key`가 없으면 `localStorage.setItem('gemini-key', '<키>')` 선행 — 사람 확인 필요 시 HUMAN VERIFY로 보고.)

- [ ] **Step 3: Commit**

```powershell
git add js/engine.js
git commit -m "feat: port verified Gemini Live engine behind callback API"
```

---

### Task 7: Session 뷰 통합 — 상태머신 + 타이머 + 전사 + 저장

**Files:**
- Modify: `js/app.js` (Task 5의 `renderSession` 스텁을 아래 세션 컨트롤러로 교체)

**Interfaces:**
- Consumes: Task 6 `createEngine(cb)` 계약 전체, Task 3 store, Task 2 `transition/timeLabel/fmtTimer/countWords`, Task 4 DOM id.
- Produces: `queueChanged()` 훅(이 태스크에선 빈 함수) — **Task 10이 동기화 drain으로 구현.** `currentId`, `elapsedNow()` — Task 8이 사용.

- [ ] **Step 1: app.js에 세션 컨트롤러 구현**

import 줄 교체:

```js
import { createStore } from './store.js';
import { createEngine } from './engine.js';
import { shortId, autoTitle, timeLabel, fmtTimer, fmtDateHeader, fmtIndexMeta, countWords, transition } from './helpers.js';
```

Task 5의 `renderSession` 함수를 삭제하고 아래로 교체:

```js
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
```

주의: `route()`가 Main으로 전환할 때 진행 중 세션이 있으면 정리해야 함 — `route()` 안 Main 분기 첫 줄에 추가:

```js
if (currentId && store.getSession(currentId)?.status === 'listening') { engine.stop(); stopTick(); store.updateSession(currentId, { status: 'ready', elapsedMs: acc }); }
currentId = null;
```

- [ ] **Step 2: 브라우저 검증 — HUMAN VERIFY (마이크/실제 API 키 필요)**

Run: `start.cmd` → Create session 후:
- [ ] READY: `○ READY` muted, 타이머 회색, Start(accent 솔리드) + End(disabled)
- [ ] Start → 키 없으면 GEMINI API KEY 인라인 입력 노출, 키 입력 후 Start → 마이크 권한 → `● LISTENING` accent, 웨이브폼 accent, 타이머 진행
- [ ] 영어로 말하면: 좌측 파셜(회색) → 우측 번역 파셜 + 캐럿 → 2.5초 침묵 후 타임스탬프 붙은 확정 문단이 양쪽에 추가, 푸터 `N SEGMENTS · M WORDS` 증가, `AUTO-SAVED HH:MM:SS` 갱신
- [ ] Pause → 타이머 정지·전사 보존, Resume → 이어서 진행 (타이머 누적 이어짐)
- [ ] 언어를 English로 바꾸면 다음 세그먼트부터 영어 출력, 상태줄 `● TRANSLATING TO ENGLISH`
- [ ] End session → `— ENDED`, 컨트롤 자리 READ ONLY 문구, 전사·SAVE 유지
- [ ] ← SESSIONS → 인덱스 행에 분(MIN) 반영. 행 클릭 재진입 → 전사 그대로 복원 (새로고침 후에도)

- [ ] **Step 3: Commit**

```powershell
git add js/app.js
git commit -m "feat: session view - state machine, timer, live transcript, persistence"
```

---

### Task 8: SAVE 섹션 — .TXT / COPY / 제목 rename

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: Task 2 `toTxt(session, segments)`, Task 7 `currentId`, store.
- Produces: 없음 (말단 기능).

- [ ] **Step 1: 구현** — app.js에 추가:

```js
// ---------- SAVE ----------
import { toTxt } from './helpers.js'; // 기존 import 줄에 toTxt 추가 (별도 import문 금지)

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
    renderSession(currentId);
  };
  input.onblur = commit;
  input.onkeydown = e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.onblur = null; renderSession(currentId); } };
  $('s-title').replaceChildren(input);
  input.focus();
};
```

- [ ] **Step 2: 브라우저 검증**

- [ ] 세그먼트 몇 개 만든 뒤 `.TXT ↓` → `relay-Session-07-03-….txt` 다운로드, 내용에 `[HH:MM]` + 원문/번역 쌍
- [ ] `COPY` → 클립보드에 동일 내용, 버튼이 1.2초간 `COPIED`
- [ ] 제목 클릭 → 인라인 입력 → Enter로 저장(레일 제목·Main 인덱스 모두 반영), Escape 취소, 빈 값이면 자동 제목 복귀
- [ ] rename 후 새로고침해도 유지

- [ ] **Step 3: Commit**

```powershell
git add js/app.js
git commit -m "feat: txt export, clipboard copy, inline title rename"
```

---

### Task 9: Supabase 스키마 + 클라이언트 + 이메일 OTP 로그인

**Files:**
- Create: `supabase/schema.sql`
- Modify: `js/config.js` (사용자 체크포인트에서 값 채움), `js/app.js`

**Interfaces:**
- Consumes: Task 5 `#btn-signin`.
- Produces: `sb` (Supabase 클라이언트 또는 `null`) — **Task 10, 11이 사용.** `renderAuth()`. config가 비어 있으면 `sb === null` → 앱은 로컬 전용으로 계속 동작해야 함(모든 Supabase 코드는 `if (!sb) return` 가드).

- [ ] **Step 1: schema.sql 작성**

`supabase/schema.sql`:

```sql
-- Relay: 세션/세그먼트 + RLS. Supabase Dashboard > SQL Editor에서 1회 실행.
create table public.sessions (
  id          uuid primary key,                -- 클라이언트 생성 uuid (crypto.randomUUID)
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text,
  target_lang text not null default 'ko',
  source      text not null default 'mic',     -- 'mic' | 'tab'
  status      text not null default 'ready',   -- 'ready'|'listening'|'paused'|'ended'
  elapsed_ms  int  not null default 0,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,
  updated_at  timestamptz not null default now()
);

create table public.segments (
  session_id      uuid not null references public.sessions on delete cascade,
  seq             int  not null,
  ts_ms           int  not null,
  time_label      text not null,
  original_text   text not null default '',
  translated_text text not null default '',
  src_lang        text,
  created_at      timestamptz not null default now(),
  primary key (session_id, seq)
);

create index sessions_user_created on public.sessions (user_id, created_at desc);

alter table public.sessions enable row level security;
alter table public.segments enable row level security;

create policy "own sessions" on public.sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own segments" on public.segments for all
  using (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));
```

- [ ] **Step 2: HUMAN CHECKPOINT — Supabase 프로젝트 준비 (사용자 작업)**

서브에이전트는 여기서 사용자에게 요청하고 대기:
1. https://supabase.com 에서 프로젝트 생성 — 리전 **Seoul (ap-northeast-2)** (기획서 §7-7)
2. SQL Editor에서 `supabase/schema.sql` 전체 실행
3. Authentication > Providers > Email 활성 확인(기본값), Authentication > URL Configuration의 Redirect URLs에 `http://localhost:8787` 추가
4. Settings > API의 **Project URL**과 **anon public key**를 `js/config.js`의 `SUPABASE_URL`/`SUPABASE_ANON_KEY`에 입력

- [ ] **Step 3: 클라이언트 초기화 + 로그인 UI** — app.js 상단(import들 다음)에 추가:

```js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export let sb = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  const { createClient } = await import('https://esm.run/@supabase/supabase-js@2');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

async function renderAuth() {
  if (!sb) { $('btn-signin').textContent = 'LOCAL ONLY'; $('btn-signin').disabled = true; return; }
  const { data: { user } } = await sb.auth.getUser();
  $('btn-signin').textContent = user ? `${user.email.toUpperCase()} — SIGN OUT` : 'SIGN IN';
}

$('btn-signin').onclick = async () => {
  const { data: { user } } = await sb.auth.getUser();
  if (user) { await sb.auth.signOut(); renderAuth(); return; }
  const email = prompt('로그인 이메일 (magic link 전송)');
  if (!email) return;
  const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin } });
  alert(error ? '전송 실패: ' + error.message : '메일의 링크를 열면 로그인됩니다.');
};

sb?.auth.onAuthStateChange(() => { renderAuth(); fullSync(); }); // fullSync는 Task 10 — 그 전까지는 `renderAuth();`만
renderAuth();
```

(Task 10 이전에 이 태스크만 단독 검증할 때는 `fullSync()` 호출 줄을 `renderAuth();`만으로 두고, Task 10에서 원복.)

- [ ] **Step 4: 브라우저 검증**

- [ ] config 비어 있을 때: 상단 바에 `LOCAL ONLY`, 나머지 기능 전부 정상 (콘솔 에러 0)
- [ ] config 채운 후: `SIGN IN` 클릭 → 이메일 입력 → 수신 메일 링크 클릭 → 돌아오면 상단 바에 이메일 표시
- [ ] `— SIGN OUT` 클릭 → `SIGN IN` 복귀

- [ ] **Step 5: Commit**

```powershell
git add supabase/schema.sql js/app.js js/config.js
git commit -m "feat: supabase schema with RLS, client init, email OTP auth"
```

---

### Task 10: write-behind 동기화 — push 어댑터 + 병합 + 재시도

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: Task 3 `store.drain/pendingOps/mergeRemoteSessions`, Task 9 `sb`, Task 7의 `queueChanged()` 스텁.
- Produces: `fullSync()`, `queueChanged()` 구현체. 컬럼 매핑 규칙: JS camelCase ↔ DB snake_case, ms(number) ↔ timestamptz(ISO 문자열).

- [ ] **Step 1: 구현** — Task 7의 `export function queueChanged() {}` 를 삭제하고 아래로 교체:

```js
// ---------- Supabase 동기화 (write-behind) ----------
const sessionFromRow = r => ({
  id: r.id, title: r.title, targetLang: r.target_lang, source: r.source, status: r.status,
  elapsedMs: r.elapsed_ms, createdAt: Date.parse(r.created_at),
  endedAt: r.ended_at ? Date.parse(r.ended_at) : null, updatedAt: Date.parse(r.updated_at),
});

async function pushOp(op, st) {
  if (op.type === 'session') {
    const s = st.getSession(op.id);
    if (!s) return;                              // 삭제된 세션의 잔여 op — 무시
    const { error } = await sb.from('sessions').upsert({
      id: s.id, title: s.title, target_lang: s.targetLang, source: s.source, status: s.status,
      elapsed_ms: s.elapsedMs, created_at: new Date(s.createdAt).toISOString(),
      ended_at: s.endedAt ? new Date(s.endedAt).toISOString() : null,
      updated_at: new Date(s.updatedAt).toISOString(),
    });
    if (error) throw error;
  } else {
    const g = st.getSegments(op.id).find(x => x.seq === op.seq);
    if (!g) return;
    const { error } = await sb.from('segments').upsert({
      session_id: op.id, seq: g.seq, ts_ms: g.tsMs, time_label: g.timeLabel,
      original_text: g.originalText, translated_text: g.translatedText, src_lang: g.srcLang,
    });
    if (error) throw error;
  }
}

let drainTimer = null;
export function queueChanged() {                 // flush마다 호출됨 — 0.8초 디바운스로 배치
  if (!sb) return;
  clearTimeout(drainTimer);
  drainTimer = setTimeout(() => store.drain(pushOp), 800);
}

async function fullSync() {                      // 로그인 직후 + 앱 시작 시: 밀린 큐 push → 원격 목록 병합
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await store.drain(pushOp);
  const { data, error } = await sb.from('sessions').select('*');
  if (!error && data) {
    store.mergeRemoteSessions(data.map(sessionFromRow));
    if (!location.hash || location.hash === '#/') renderMain();
  }
}

window.addEventListener('online', queueChanged); // 오프라인 복귀 시 잔여 큐 재시도
fullSync();
```

Task 9에서 임시 처리한 `onAuthStateChange` 콜백을 `{ renderAuth(); fullSync(); }` 로 원복.

- [ ] **Step 2: 통합 검증 — HUMAN VERIFY**

- [ ] 로그인 상태에서 세션 생성 + 세그먼트 몇 개 기록 → Supabase Table Editor에서 `sessions`/`segments` 행 확인 (세그먼트는 flush 후 ~1초 내)
- [ ] rename → `title` 컬럼 갱신 확인
- [ ] DevTools Network를 Offline으로 → 세그먼트 기록(로컬 정상 저장) → `localStorage['relay.queue']`에 op 누적 확인 → Online 복귀 → 큐 비워지고 테이블에 행 추가
- [ ] 시크릿 창에서 로그인 → Main 인덱스에 같은 세션 목록 표시
- [ ] 로그아웃/`LOCAL ONLY` 상태에서 모든 로컬 기능 정상 (동기화만 침묵)

- [ ] **Step 3: Commit**

```powershell
git add js/app.js
git commit -m "feat: write-behind sync - push adapter, merge on login, online retry"
```

---

### Task 11: ended 세션 원격 lazy 로드 + 최종 E2E

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: Task 3 `store.setSegments`, Task 9 `sb`, Task 7 `renderSession/currentId`.
- Produces: 없음 (최종 태스크).

- [ ] **Step 1: hydrate 구현** — app.js에 추가, `renderSession` 마지막 줄에 `if (s.status === 'ended') hydrateSegments(id);` 삽입:

```js
// 다른 기기에서 만든 ended 세션: 로컬에 세그먼트가 없으면 원격에서 1회 로드해 캐시
async function hydrateSegments(id) {
  if (!sb || store.getSegments(id).length) return;   // 세그먼트 존재 시 no-op → 재렌더 루프 없음
  const { data, error } = await sb.from('segments').select('*').eq('session_id', id).order('seq');
  if (error || !data?.length || currentId !== id) return;
  store.setSegments(id, data.map(r => ({
    seq: r.seq, tsMs: r.ts_ms, timeLabel: r.time_label,
    originalText: r.original_text, translatedText: r.translated_text, srcLang: r.src_lang,
  })));
  renderSession(id);
}
```

- [ ] **Step 2: 검증**

- [ ] 시크릿 창(로컬 데이터 없음)에서 로그인 → 인덱스에서 ended 세션 클릭 → 전사 전체 로드·표시, `.TXT ↓`/`COPY` 동작
- [ ] 같은 세션 재진입 시 네트워크 요청 없음 (localStorage 캐시 사용 — DevTools Network 확인)

- [ ] **Step 3: 최종 E2E 체크리스트 (기획서 완료 기준)**

- [ ] **Phase 1 기준**: legacy.html의 모든 기능(마이크/탭/언어 전환/음성 재생/TXT)이 새 UI에서 동일 동작 + 새로고침 후 세션 기록 유지
- [ ] **Phase 2 기준**: 다른 브라우저에서 로그인해 세션 목록·전사 열람 가능, 동기화 실패분이 온라인 복귀 시 자동 반영
- [ ] `node --test test/` 전체 PASS
- [ ] 콘솔 에러 0건 (Main/Session 양쪽, 로그인/비로그인 각각)

- [ ] **Step 4: Commit + 마무리**

```powershell
git add js/app.js
git commit -m "feat: lazy-load remote segments for ended sessions"
```

완료 후 superpowers:finishing-a-development-branch 스킬로 마무리 옵션 결정.

---

## Self-Review 기록

- **기획서 커버리지**: Phase 1(토큰 CSS T4 · 라우팅/세션 CRUD T5 · 엔진 T6 · 상태머신/타이머/전사 T7 · TXT/COPY/rename T8) / Phase 2(스키마+RLS+OTP T9 · write-behind/병합/재시도 T10 · 기기 간 열람 T11) — 기획서 §6의 두 완료 기준이 T7/T10/T11 검증 항목에 그대로 존재. Phase 3은 의도적 제외.
- **의도적 단순화**: 인덱스 언어쌍은 v1에서 `AUTO→KO`(srcLang 미감지, 기획서 §7-2) · 오토스크롤 해제 시 푸터 문구는 `AUTO-SCROLL ON` 고정(동작은 해제됨) · 세션 삭제 기능 없음(기획서 범위 외).
- **타입 일관성 확인**: `fmtIndexMeta(session)` 1-인자(T2 테스트=T5 사용처 일치) · `toTxt(session, segments)` 2-인자(T2=T8) · `drain(push(op, store))` 2-인자 콜백(T3 테스트=T10 pushOp) · Segment 필드 `{seq,tsMs,timeLabel,originalText,translatedText,srcLang}` (T3=T7=T10=T11) · DB 컬럼 snake_case 매핑은 T9 스키마=T10 어댑터=T11 hydrate 일치.





