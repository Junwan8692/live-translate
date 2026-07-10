# 세션별 비용 표시 — 기획서 + 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 세션 목록과 세션 화면에 세션별 Gemini API 예상 비용을 표시한다.

**Architecture:** 이미 저장되는 `elapsedMs`(청취 누적 시간)에 공식 분당 단가를 곱하는 순수 함수 하나를 helpers.js에 추가하고, 기존 메타 라인 두 곳에 끼워 넣는다. 스키마·sync 변경 없음.

**Tech Stack:** 바닐라 JS (기존 그대로), `node --test`

## Global Constraints

- 프레임워크·빌드 도구 도입 금지 (CLAUDE.md)
- `js/helpers.js`는 순수 함수만 — DOM/window 접근 금지
- 단가 상수는 `js/config.js`(단일 정의처)에만 둔다
- 테스트: `node --test` (test/*.test.mjs 자동 발견)

---

# Part 1 — 기획서

## 배경

미국 출장(2026-07-17경)에서 실사용 예정. 세션(회의) 단위로 Gemini API 지출을 바로 확인할 수 있어야 하루/출장 전체 예산 감이 잡힌다. 현재 앱은 토큰·비용을 전혀 추적하지 않고, Google 콘솔은 프로젝트 단위 집계만 제공한다.

## 공식 단가 (2026-07, `gemini-3.5-live-translate-preview` 유료 등급)

| 항목 | 토큰 단가 | 분당 환산 (오디오) |
|---|---|---|
| 입력 (마이크 오디오) | $3.50 / 1M tok | $0.0053/분 |
| 출력 (번역 오디오, 사고 토큰 포함) | $21.00 / 1M tok | $0.0315/분 |
| **입·출력 연속 시 유효가** | 초당 25토큰 환산 | **$0.0368/분** |

무료 등급도 있으나 **"제품 개선에 사용됨: 예"** — 회의 내용이 Google 학습에 쓰일 수 있다. 업무 회의 실사용은 유료 등급 키를 권장.

## 비용 시뮬레이션

상한 = 입·출력 모두 연속($0.0368/분). 현실치 = 입력은 마이크 켜진 내내 과금되지만 출력(번역 발화)은 발화 구간에만 발생 — 발화율 50% 가정 시 분당 $0.021.

| 시나리오 | 상한 | 현실치(발화 50%) |
|---|---|---|
| 10분 세션 | $0.37 | $0.21 |
| 30분 세션 | $1.10 | $0.63 |
| 1시간 회의 | $2.21 | $1.26 |
| 출장 1주 (6시간×5일) | $66 | $38 |

환율 1,400원 가정 시 1시간 회의 약 ₩1,800~3,100, 출장 전체 약 ₩53,000~93,000.

## 표시 방식 (UX)

- **세션 목록** 메타 라인 확장: `07.03 · AUTO→KO · 41 MIN` → `07.03 · AUTO→KO · 41 MIN · ~$1.51`
- **세션 화면** 헤더 메타(`s-meta`)에도 동일 추가 (진입 시점 기준 — ended 세션 확인 용도)
- `~` 접두로 추정치임을 표시. 계산 기준은 상한 단가 — **실제 청구는 이 값 이하**.

## 정확도 원칙과 Phase 2 (지금 안 함)

`elapsedMs × $0.0368/분`은 상한 추정이다. 토큰 단위 정밀 계산(usageMetadata 누적)은 엔진 콜백 + 세션 필드 + Supabase 컬럼 + sync 매핑이 모두 필요해서 diff가 10배 크다. **추정치와 실제 청구의 오차가 실사용에서 문제로 확인될 때만** 착수한다 (YAGNI).

---

# Part 2 — 구현 계획

## File Structure

- Modify: `js/config.js` — 단가 상수 1개 추가
- Modify: `js/helpers.js` — `fmtCost()` 추가, `fmtIndexMeta()` 확장
- Modify: `js/app.js` — 세션 화면 메타에 비용 추가 (1줄 + import)
- Test: `test/helpers.test.mjs` — fmtCost 테스트 추가, fmtIndexMeta 기대값 갱신

### Task 1: 단가 상수 + 비용 헬퍼 (TDD)

**Files:**
- Modify: `js/config.js`
- Modify: `js/helpers.js`
- Test: `test/helpers.test.mjs`

**Interfaces:**
- Produces: `fmtCost(ms: number): string` — 예: `fmtCost(2460000)` → `'~$1.51'`. Task 2가 import한다.
- Produces: `COST_PER_MIN_USD: number` (config.js)

- [ ] **Step 1: 실패하는 테스트 작성**

`test/helpers.test.mjs`의 import에 `fmtCost` 추가하고, 기존 fmtIndexMeta 테스트(23~26행)를 교체 + 새 테스트 추가:

```js
test('fmtIndexMeta: 날짜 · 언어쌍 · 분 · 비용', () => {
  const s = { createdAt: d.getTime(), targetLang: 'ko', elapsedMs: 41 * 60000 };
  assert.equal(fmtIndexMeta(s), '07.03 · AUTO→KO · 41 MIN · ~$1.51');
});

test('fmtCost: 청취 시간 기반 상한 추정', () => {
  assert.equal(fmtCost(0), '~$0.00');
  assert.equal(fmtCost(10 * 60000), '~$0.37');   // 10분 × $0.0368
  assert.equal(fmtCost(41 * 60000), '~$1.51');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test`
Expected: FAIL 2건 — `fmtCost is not a function` 류 + fmtIndexMeta 문자열 불일치

- [ ] **Step 3: 구현**

`js/config.js` 끝에 추가:

```js
// Gemini 3.5 Live Translate 유료 등급 단가 (2026-07 공식 가격표).
// 오디오 초당 25토큰: 입력 $3.50/1M + 출력 $21.00/1M → 입·출력 연속 시 분당 $0.0368.
// 출력(번역 발화)이 없는 구간은 과금이 줄므로, 이 값으로 계산한 비용은 상한 추정치다.
export const COST_PER_MIN_USD = 0.0368;
```

`js/helpers.js` 상단에 import 추가, `fmtCost` 추가, `fmtIndexMeta` 확장:

```js
import { COST_PER_MIN_USD } from './config.js';

export const fmtCost = ms => `~$${(ms / 60000 * COST_PER_MIN_USD).toFixed(2)}`;

export const fmtIndexMeta = s => {
  const c = new Date(s.createdAt);
  const mins = Math.round((s.elapsedMs || 0) / 60000);
  return `${p2(c.getMonth() + 1)}.${p2(c.getDate())} · ${(s.srcLang || 'AUTO').toUpperCase()}→${s.targetLang.toUpperCase()} · ${mins} MIN · ${fmtCost(s.elapsedMs || 0)}`;
};
```

- [ ] **Step 4: 통과 확인**

Run: `node --test`
Expected: PASS — 기존 26 + 신규 1 = 27/27 (세션 목록 표시는 fmtIndexMeta를 쓰므로 UI 코드 수정 없이 자동 반영)

- [ ] **Step 5: Commit**

```bash
git add js/config.js js/helpers.js test/helpers.test.mjs
git commit -m "feat: session cost estimate in index meta (official per-minute rate)"
```

### Task 2: 세션 화면 메타에 비용 표시

**Files:**
- Modify: `js/app.js:5` (import), `js/app.js:241` (s-meta)

**Interfaces:**
- Consumes: `fmtCost(ms)` — Task 1

- [ ] **Step 1: 수정**

`js/app.js:5`의 helpers import 목록에 `fmtCost` 추가. `js/app.js:241`을 다음으로 교체:

```js
$('s-meta').textContent = `${shortId(s.id)} · ${fmtDateHeader(c).split(' — ')[0]} ${timeLabel(c)} · ${fmtCost(s.elapsedMs || 0)}`;
```

- [ ] **Step 2: 회귀 확인**

Run: `node --test`
Expected: 27/27 PASS

- [ ] **Step 3: 브라우저 확인 (서버가 8787에 이미 떠 있음)**

http://localhost:8787 열기 →
- 세션 목록 각 행 메타에 `· ~$X.XX` 표시
- 기존 세션 열기 → 헤더 메타 끝에 `· ~$X.XX` 표시

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: show session cost estimate in session header meta"
```
