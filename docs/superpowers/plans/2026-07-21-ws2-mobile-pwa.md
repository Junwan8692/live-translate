# WS2 — 모바일 최적화 + PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS/Android 브라우저에서 Relay를 온전히 쓸 수 있게 한다 — 반응형 레이아웃, 청취 중 화면 꺼짐 방지, iOS 마이크 샘플레이트 대응, 홈 화면 설치(PWA).

**Architecture:** CSS 미디어쿼리(≤720px)로 세션 화면을 세로 스택 + 번역 단독 뷰로 재배치. Wake Lock API를 상태머신 전이에 연결. 엔진의 16kHz 가정을 리샘플 폴백으로 방어. manifest + 메타태그로 설치 지원 (서비스워커 없음).

**Tech Stack:** 바닐라 JS/CSS, Wake Lock API, Web App Manifest, Node 내장 테스트 러너.

**Spec:** `docs/superpowers/specs/2026-07-21-recording-mobile-design.md`

## Global Constraints

- 프레임워크·빌드 도구·신규 런타임 의존성 금지 (CLAUDE.md)
- 디자인 토큰 준수: 웜 페이퍼 `#F6F3EC`, 액센트 `#8C1A12`, box-shadow 금지 (index.html `:root` 참조)
- 순수 로직은 `js/helpers.js` + `test/*.test.mjs` (`node --test`)
- 커밋 메시지 한국어, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 푸터
- git worktree에서 작업, **WS1 머지 후 리베이스하고 머지** (index.html/app.js/engine.js 접점)

---

### Task 1: 다운샘플 헬퍼 — TDD

**Files:**
- Modify: `js/helpers.js` (파일 끝에 추가)
- Test: `test/helpers.test.mjs` (기존 파일에 추가)

**Interfaces:**
- Produces: `downsampleTo16k(f32, srcRate)` — Float32Array를 16kHz로 선형보간 다운샘플. `srcRate === 16000`이면 입력 그대로 반환.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/helpers.test.mjs`에 추가 (기존 import 스타일 재사용):

```js
import { downsampleTo16k } from '../js/helpers.js';

test('downsampleTo16k: 16k 입력은 그대로', () => {
  const f32 = new Float32Array([0.1, 0.2, 0.3]);
  assert.equal(downsampleTo16k(f32, 16000), f32);
});

test('downsampleTo16k: 48k→16k는 1/3 길이 + 선형보간 값', () => {
  const f32 = new Float32Array([0, 0.3, 0.6, 0.9, 1.2, 1.5]);
  const out = downsampleTo16k(f32, 48000);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0] - 0) < 1e-6);
  assert.ok(Math.abs(out[1] - 0.9) < 1e-6); // pos=3.0 → f32[3]
});

test('downsampleTo16k: 비정수 배율(44.1k)도 동작', () => {
  const out = downsampleTo16k(new Float32Array(441), 44100);
  assert.equal(out.length, 160);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test test/helpers.test.mjs` → Expected: FAIL (`downsampleTo16k is not a function`)

- [ ] **Step 3: 구현** — `js/helpers.js` 끝에 추가:

```js
// iOS 등이 AudioContext({sampleRate:16000})를 무시할 때의 선형보간 다운샘플 폴백
export const downsampleTo16k = (f32, srcRate) => {
  if (srcRate === 16000) return f32;
  const ratio = srcRate / 16000;
  const out = new Float32Array(Math.floor(f32.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio, lo = Math.floor(pos), hi = Math.min(lo + 1, f32.length - 1);
    out[i] = f32[lo] + (f32[hi] - f32[lo]) * (pos - lo);
  }
  return out;
};
```

- [ ] **Step 4: 통과 확인** — Run: `node --test` → Expected: 전체 PASS
- [ ] **Step 5: Commit** — `git add js/helpers.js test/helpers.test.mjs && git commit -m "feat: 16kHz 다운샘플 헬퍼"`

---

### Task 2: engine.js — 샘플레이트 방어

**Files:**
- Modify: `js/engine.js:59-73` (pumpAudio)

**Interfaces:**
- Consumes: `downsampleTo16k`(Task 1).
- Produces: 없음 (내부 방어). 16kHz가 강제되지 않는 환경에서도 Gemini에 항상 16kHz PCM 전송.

- [ ] **Step 1: 구현** — `js/engine.js` 상단 import에 추가:

```js
import { downsampleTo16k } from './helpers.js';
```

`pumpAudio()`를 다음으로 교체:

```js
  function pumpAudio() {
    try { inCtx = new AudioContext({ sampleRate: 16000 }); }
    catch { inCtx = new AudioContext(); }  // 일부 브라우저는 sampleRate 옵션 자체를 거부
    const srcRate = inCtx.sampleRate;      // iOS는 옵션을 무시하고 HW 레이트(보통 48k)를 줄 수 있음
    const src = inCtx.createMediaStreamSource(mediaStream);
    // ponytail: ScriptProcessor는 deprecated지만 AudioWorklet보다 단순. Phase 3에서 교체 검토.
    proc = inCtx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = e => {
      if (!session) return;
      const f32 = downsampleTo16k(e.inputBuffer.getChannelData(0), srcRate);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7fff;
      session.sendRealtimeInput({ audio: { data: b64(i16.buffer), mimeType: 'audio/pcm;rate=16000' } });
    };
    src.connect(proc);
    proc.connect(inCtx.destination); // ScriptProcessor는 destination 연결 없이는 동작 안 함(출력은 무음)
  }
```

- [ ] **Step 2: 검증** — `node --check js/engine.js` → 무출력. `node --test` → PASS. 데스크톱 브라우저에서 LIVE 세션 번역이 기존과 동일하게 동작(회귀 확인).
- [ ] **Step 3: Commit** — `git add js/engine.js && git commit -m "fix: AudioContext 샘플레이트 미보장 환경 다운샘플 폴백"`

---

### Task 3: Wake Lock — 청취 중 화면 꺼짐 방지

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Produces: `keepAwake(on)` — listening 상태에서만 화면 잠금 방지. 미지원 브라우저는 무시(no-op).

- [ ] **Step 1: 구현** — `js/app.js`의 세션 컨트롤러 상태 변수 부근에 추가:

```js
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
```

`doAction`의 마지막 `renderStatus(next);` 다음 줄에 `void keepAwake(next === 'listening');` 추가.
`route()`의 세션 이탈 처리 블록(엔진 정지하는 곳)에 `void keepAwake(false);` 추가.

- [ ] **Step 2: 검증** — `node --check js/app.js`. 데스크톱 Chrome DevTools 콘솔에서 세션 start 후 `navigator.wakeLock` 요청 에러 없는지 확인 (실기기 검증은 Task 6).
- [ ] **Step 3: Commit** — `git add js/app.js && git commit -m "feat: 청취 중 Wake Lock으로 화면 꺼짐 방지"`

---

### Task 4: 반응형 레이아웃 (≤720px)

**Files:**
- Modify: `index.html` (`<style>` 끝에 미디어쿼리 블록, t-head에 토글 버튼)
- Modify: `js/app.js` (원문 토글 1핸들러)

**Interfaces:**
- Produces: 모바일에서 번역 단독 뷰 + `#toggle-src` 버튼으로 원문 전환. 데스크톱은 변화 없음(미디어쿼리 내부만 수정).

- [ ] **Step 1: index.html — t-head에 토글 버튼** — `<div class="t-head">`의 두 번째 div를 다음으로 교체:

```html
        <div><span class="mono">TRANSLATION</span> <span id="hdr-target" class="mono">KOREAN</span>
          <button id="toggle-src" class="mono" hidden style="float:right;cursor:pointer">SHOW ORIGINAL</button></div>
```

- [ ] **Step 2: index.html — `</style>` 직전에 미디어쿼리 블록 추가**

```css
/* ---------- Mobile (≤720px) ---------- */
@media (max-width: 720px) {
  .main-wrap { padding: 24px 20px 48px; }
  .hero-title { font-size: 64px; margin-top: 32px; }
  .idx-title { font-size: 17px; }

  /* 세션: 레일 상단 스택 + 전사 영역이 나머지 높이 */
  .session-grid { grid-template-columns: 1fr; grid-template-rows: auto 1fr; min-height: 100dvh; }
  .rail { border-right: none; border-bottom: 1px solid var(--hairline); padding: 20px; }
  .rail-sec { margin-top: 16px; padding-top: 14px; }
  .rail-title { font-size: 24px; }
  #timer { font-size: 22px; margin-top: 8px; }
  .rail-save { margin-top: 16px; }
  .transcript { padding: 16px 20px; height: auto; min-height: 0; }
  .btn { padding: 14px 0; } /* 터치 타깃 ≥44px */
  .seg-ctl button { padding: 13px 0; }

  /* 전사: 번역 단독, SHOW ORIGINAL 토글로 전환 */
  #toggle-src { display: inline; }
  .t-head, .t-body { grid-template-columns: 1fr; }
  .t-head > div:first-child { display: none; }
  .t-col { padding: 16px 0; }
  .t-col-src { display: none; }
  .t-col-dst { border-left: none; padding-left: 0; }
  .show-src .t-col-src { display: block; }
  .show-src .t-col-dst { display: none; }
}
```

주의: `#toggle-src`는 HTML에서 `hidden` 속성이 아니라 데스크톱 CSS로 숨긴다 — Step 1의 마크업에서 `hidden`을 빼고, `<style>` 데스크톱 영역(미디어쿼리 밖)에 `#toggle-src { display: none; }`를 추가하는 방식으로 구현한다 (미디어쿼리 안 `display:inline`이 이를 뒤집는다).

- [ ] **Step 3: app.js — 토글 핸들러** — 이벤트 바인딩 구역(`$('back-link').onclick` 부근)에 추가:

```js
$('toggle-src').onclick = () => {
  const on = $('scroll-region').classList.toggle('show-src');
  $('toggle-src').textContent = on ? 'SHOW TRANSLATION' : 'SHOW ORIGINAL';
};
```

`renderSession` 시작부에 초기화 추가: `$('scroll-region').classList.remove('show-src'); $('toggle-src').textContent = 'SHOW ORIGINAL';`

- [ ] **Step 4: 검증** — `node --check js/app.js`. 브라우저 DevTools 모바일 뷰(390px)에서: 홈 스택 정상, 세션 진입 시 번역 단독 + 토글 동작, 데스크톱 폭(1280px)에서 기존 2컬럼 그대로(회귀 없음).
- [ ] **Step 5: Commit** — `git add index.html js/app.js && git commit -m "feat: 모바일 반응형 레이아웃 + 원문 토글"`

---

### Task 5: PWA — manifest + 아이콘 + 메타태그

**Files:**
- Create: `manifest.json`, `icons/icon.svg`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`
- Create: `scripts/make-icons.mjs` (개발용 1회 실행 스크립트 — 런타임 의존성 아님)
- Modify: `index.html` (head 메타)

**Interfaces:**
- Produces: 홈 화면 설치 가능한 manifest. 아이콘은 액센트 배경 단색 사각형(임시) — 디자인 아이콘 교체는 백로그.

- [ ] **Step 1: `manifest.json` 작성** (저장소 루트):

```json
{
  "name": "Relay — Live Translation",
  "short_name": "Relay",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#F6F3EC",
  "theme_color": "#F6F3EC",
  "icons": [
    { "src": "icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: `icons/icon.svg` 작성** (디자인 토큰 색 사용):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#F6F3EC"/>
  <text x="256" y="332" font-family="Georgia, 'Playfair Display', serif" font-style="italic"
        font-size="280" text-anchor="middle" fill="#1C1A14">R<tspan fill="#8C1A12">.</tspan></text>
</svg>
```

- [ ] **Step 3: PNG 생성 스크립트** — 서버에 이미지 도구가 없으므로 무의존성 Node 스크립트로 단색+글자 없는 PNG를 생성한다(임시 아이콘). `scripts/make-icons.mjs`:

```js
// 개발용 1회 실행: 단색 PNG 아이콘 생성 (외부 의존성 없음).
// 사용: node scripts/make-icons.mjs  → icons/icon-192.png, icon-512.png, apple-touch-icon.png
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
// 웜 페이퍼 배경 + 중앙 액센트 사각형 (수직/수평 40~60% 영역)
function makePng(size, path) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const paper = [0xf6, 0xf3, 0xec], acc = [0x8c, 0x1a, 0x12];
  const lo = Math.floor(size * 0.4), hi = Math.floor(size * 0.6);
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const c = y >= lo && y < hi && x >= lo && x < hi ? acc : paper;
      raw.set(c, row + 1 + x * 3);
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log(path, png.length, 'bytes');
}
mkdirSync('icons', { recursive: true });
makePng(192, 'icons/icon-192.png');
makePng(512, 'icons/icon-512.png');
makePng(180, 'icons/apple-touch-icon.png');
```

Run: `node scripts/make-icons.mjs` → Expected: 3개 파일 생성 로그. 확인: `node -e "const b=require('fs').readFileSync('icons/icon-192.png'); console.log(b.slice(1,4).toString())"` → `PNG`

- [ ] **Step 4: index.html head에 추가** — `<title>` 아래:

```html
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#F6F3EC">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
```

- [ ] **Step 5: 검증** — 로컬 서버에서 DevTools → Application → Manifest에 이름/아이콘 표시, 오류 없음.
- [ ] **Step 6: Commit** — `git add manifest.json icons scripts/make-icons.mjs index.html && git commit -m "feat: PWA manifest·아이콘·메타태그"`

---

### Task 6: 최종 검증

- [ ] **Step 1:** `node --test` 전체 PASS, `node --check js/*.js` 무출력, 데스크톱(1280px) 레이아웃 회귀 없음
- [ ] **Step 2:** 실기기 수동 확인 (배포 URL에서): ① iPhone Safari — 마이크 세션 시작→번역 출력(리샘플 검증), 화면 안 꺼짐, 홈 화면 설치 ② Android Chrome — 동일 + 설치 배너. 실기기 확인은 사용자에게 요청하고 결과를 기다릴 것 (에이전트가 대신 못 함).
- [ ] **Step 3:** superpowers:requesting-code-review로 리뷰 요청, 발견사항 반영 후 최종 커밋
