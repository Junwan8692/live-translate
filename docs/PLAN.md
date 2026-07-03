# Relay — 실시간 번역 웹 전체 기획서

> 2026-07-03 작성 · 목표 완성일 **2026-07-16** (7/17경 미국 출장 사용)
> 기존 `index.html`(Gemini Live Translate 엔진, 검증 완료)을 Relay 디자인(`실시간 번역 웹사이트 디자인/` 핸드오프)으로 재구축하고, Supabase로 세션 데이터를 영속화한다.

---

## 1. 현재 자산 진단

### 1-1. 기존 구현 (`index.html`, 바닐라 JS 단일 파일 — 동작 검증 완료)

| 기능 | 상태 | 비고 |
|---|---|---|
| Gemini Live 연결 (`gemini-3.5-live-translate-preview`) | ✅ | `translationConfig.targetLanguageCode`, SDK가 내부 재배치 |
| 마이크 입력 (16kHz PCM16, ScriptProcessor) | ✅ | AudioWorklet 전환은 고도화 항목 |
| 탭 오디오 입력 (getDisplayMedia) | ✅ | "오디오 공유" 체크 필수 안내 있음 |
| 원문/번역 실시간 전사 (partial → 확정) | ✅ | turnComplete 미제공 → **2.5초 텍스트 디바운스로 문단 확정** (핵심 노하우) |
| 유령 재연결 방지 (`gen` 카운터) | ✅ | 재연결/정지 레이스 해결 완료 |
| 언어 변경 즉시 반영 (세션 close → 재연결) | ✅ | ko/en/ja/zh-CN/es |
| 번역 음성 재생 (24kHz PCM, 토글) | ✅ | 디자인에 없는 기능 — 유지 결정 필요 (§4-3) |
| .TXT 저장 | ✅ | 타임스탬프 포함 |
| API 키 localStorage 저장 | ✅ | 유지 (Supabase에 절대 저장하지 않음) |
| 세션 개념 / 기록 영속화 | ❌ | 이번 기획의 핵심 추가 범위 |
| Pause/Resume, 경과 타이머 | ❌ | 디자인 요구사항 — 신규 |

### 1-2. 디자인 핸드오프 (`실시간 번역 웹사이트 디자인/`)

- **확정안**: `Relay Design.dc.html`의 `#t2` 섹션 옵션 `2a` (Main / Session Listening / Control States). `#t1`은 폐기 시안.
- `README.md`에 디자인 토큰(색/타이포/간격), 화면 명세, 인터랙션, 상태 모델까지 **완전 명세됨** — 추가 자료 불필요. `support.js`는 시안 렌더링용 런타임이라 구현과 무관.
- 아이덴티티: Playfair Display Italic + Noto Serif/Sans KR + IBM Plex Mono, 웜 페이퍼(#F6F3EC), 액센트(#8C1A12), 그림자 없음·보더 위계.

---

## 2. 아키텍처 결정

### 2-1. 프레임워크: **바닐라 JS 유지 (빌드 스텝 없음)** ★권장

README는 React 권장이지만 다음 이유로 바닐라 유지:

- 화면 2개 + 상태 머신 1개 규모. 이미 동작하는 엔진 코드가 바닐라.
- 데드라인 2주 — 프레임워크 이식 비용이 리스크 대비 이득 없음.
- 출장용 도구 특성상 "어디서든 정적 파일로 즉시 실행"이 가치 (npm/빌드 불필요).
- Supabase JS SDK도 `esm.run` CDN ESM으로 문제없이 로드됨 (@google/genai와 동일 패턴).

> 대안: 추후 기능이 3화면 이상으로 커지면 Vite+Svelte로 이전. 지금은 아님 (YAGNI).

### 2-2. 파일 구조: **단일 `index.html` SPA + 해시 라우팅**

```
/index.html        # 전체 앱 (Relay CSS 토큰 + 두 뷰 + 엔진 + 스토어)
/docs/PLAN.md      # 본 문서
```

- 라우팅: `#/` (Main) ↔ `#/s/{sessionId}` (Session). `hashchange` 리스너 하나면 충분.
- 예상 1,200~1,500줄. 이 선을 넘으면 `engine.js`(Gemini/오디오) / `store.js`(Supabase)만 분리.

### 2-3. 데이터 계층: **localStorage 우선 + Supabase 동기화 (write-behind)**

- 모든 쓰기는 localStorage에 즉시 → Supabase에 비동기 반영.
- 로컬 우선의 이유 (오프라인 "사용"이 아님 — 오프라인엔 번역 자체가 불가):
  1. **세션 중 유실 방지**: 탭 크래시/실수 새로고침/절전 시 진행 중 전사 보존 (최대 가치)
  2. **요구 수준 비대칭**: Gemini는 연속 연결 필수, Supabase는 eventually면 충분. 동기화 실패가 라이브 UI를 막지 않음
  3. **지난 기록 오프라인 열람**: 기내/이동 중 이전 세션 복습 가능 (열람은 네트워크 불필요)
- 시작 시 Supabase에서 세션 목록을 당겨와 localStorage와 병합 (updated_at 기준 최신 승리).

---

## 3. 화면 명세 (디자인 README를 계약서로 삼음 — 여기선 기능 매핑만)

### 3-1. Main (`#/`)

| 디자인 요소 | 데이터 소스 / 동작 |
|---|---|
| 상단 바 날짜 `2026.07.03 — SEOUL` | `new Date()` 포맷. 도시명은 상수 (고도화: 타임존 기반) |
| **Create session** CTA | 세션 레코드 생성(uuid, 표시용 앞 8자 hex) → `#/s/{id}` 즉시 이동, READY 상태. 중간 설정 화면 없음 |
| INDEX — RECENT SESSIONS | sessions 목록 (로컬+Supabase 병합), 최신순. 행: 번호/제목/`07.02 · EN→KO · 41 MIN` |
| 자동 제목 | 미입력 시 `Session MM-DD HH:MM`, 낮춘 색(#6B665A)으로 구분 |
| 행 클릭 | 해당 세션 열람 (`ended`면 읽기 전용 뷰) |

### 3-2. Session (`#/s/{id}`)

레일(300px 고정) + 우측 2단 전사. 기존 기능 매핑:

| 레일 섹션 | 기존 코드 매핑 | 신규 작업 |
|---|---|---|
| ← SESSIONS | — | 해시 라우팅 백링크. LISTENING 중이면 확인 후 정지 |
| 세션 제목 + 메타 | — | 제목 클릭 시 인라인 rename, 메타 = id 8자 + 생성시각 |
| STATUS (웨이브폼/칩/타이머) | `setStatus()` 대체 | 상태 머신 연동, `elapsedMs` 타이머 (listening일 때만 진행) |
| LANGUAGE 셀렉트 | `$('lang')` change 핸들러 그대로 | `● TRANSLATING TO KOREAN` 상태줄 연동 |
| SOURCE 세그먼트 (Mic/Tab) | `micBtn`/`tabBtn` 로직 이식 | LISTENING 중 전환 = pause → 소스 변경 → resume |
| CONTROLS (상태별 버튼) | `start()`/`stopAll()` 재구성 | Pause/Resume 신규 (§5) |
| SAVE (.TXT/COPY) | `saveBtn` 로직 그대로 | COPY 추가(clipboard API), `AUTO-SAVED HH:MM:SS` 캡션 = 마지막 flush/동기화 시각 |
| 전사 2단 + 타임스탬프 + 라이브 캐럿 | `inLog/outLog/inCur/outCur` | 세그먼트 = flush 단위. partial(curOut)에 캐럿. 오토스크롤(위로 스크롤 시 해제) |
| 푸터 `4 SEGMENTS · 612 WORDS` | — | segments 배열에서 파생 |

### 3-3. API 키 입력 (디자인에 없는 필수 요소)

- 키가 없으면 Start 시 레일 CONTROLS 아래에 인라인 입력 필드 노출 (mono 레이블 `GEMINI API KEY`, 디자인 토큰 준수). localStorage 저장. 설정 화면 별도 생성 안 함.

---

## 4. 상태 머신 & 엔진 이식

### 4-1. 상태 전이 (디자인 명세 그대로)

```
ready ──start──▶ listening ◀─pause/resume─▶ paused
                    │                          │
                    └──────────end─────────────┴──▶ ended (읽기 전용, SAVE 활성)
```

- **start**: 권한 요청(mic/tab) → Live 연결 → 오디오 펌프. 실패 시 ready 복귀 + 레일에 에러 문구.
- **pause**: 오디오 펌프 중단 + `session.close()` + flush + 타이머 정지. (Live 세션을 유지한 채 무음을 보내는 방식보다 단순하고, 재연결 코드는 이미 검증됨)
- **resume**: 기존 `connect()` 재사용 — 새 연결로 이어서. 전사 로그 보존.
- **end**: pause와 동일 정리 + `status='ended'`, `endedAt` 기록. READY에서는 비활성.

### 4-2. 이식 시 반드시 보존할 노하우 (재발견 비용 큼)

1. **turnComplete 없음** → 텍스트 수신 시에만 2.5s 디바운스 flush. 오디오 청크로 타이머 리셋 금지.
2. **`gen` 카운터** — start/stop/pause 시 증가, `onclose` 재연결은 `myGen === gen`일 때만.
3. 언어 변경 = flush 후 `session.close()` → onclose가 새 언어로 재연결.
4. `sessionResumptionUpdate` 핸들을 저장해 재연결 시 사용 (고도화 — 현재는 새 연결로 충분).
5. 같은 언어 입력 시 출력 없음(에코 off) — 상태줄에 안내 유지.

### 4-3. 디자인에서 벗어나는 유지 기능 (결정 사항)

- **번역 음성 재생 토글**: 출장에서 이어폰 청취 용도로 유용 → LANGUAGE 섹션 아래 mono 체크 행으로 유지. 불필요 판단 시 삭제만 하면 됨.

---

## 5. 데이터 모델 & Supabase 설계

### 5-1. 클라이언트 상태 (디자인 README의 모델 채택)

```js
session:  { id, title, createdAt, targetLang, source, status,
            elapsedMs, lastSavedAt, endedAt }
segments: [{ seq, tsMs, timeLabel, originalText, translatedText, srcLang }]
```

- 세그먼트 = flush 1회 (원문+번역 쌍이 같은 flush 주기에 확정되므로 한 레코드에 양쪽 저장 — 정렬 문제 원천 차단).
- `srcLang`: Live API가 감지 언어를 직접 주지 않음 → v1은 `AUTO` 고정 표기, 고도화에서 휴리스틱 검토 (§7).

### 5-2. 테이블 (SQL 초안)

```sql
create table sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users,
  title       text,                          -- null이면 클라이언트가 자동 제목 렌더
  target_lang text not null default 'ko',
  source      text not null default 'mic',   -- 'mic' | 'tab'
  status      text not null default 'ready', -- 'ready'|'listening'|'paused'|'ended'
  elapsed_ms  int  not null default 0,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,
  updated_at  timestamptz not null default now()
);

create table segments (
  session_id      uuid not null references sessions on delete cascade,
  seq             int  not null,
  ts_ms           int  not null,
  original_text   text not null default '',
  translated_text text not null default '',
  src_lang        text,
  created_at      timestamptz not null default now(),
  primary key (session_id, seq)
);

alter table sessions enable row level security;
alter table segments enable row level security;
create policy "own sessions" on sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own segments" on segments for all
  using (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()));
```

- 인덱스 목록의 `41 MIN`/`612 WORDS`는 클라이언트 파생값 (별도 컬럼 불필요, 필요해지면 뷰로).

### 5-3. 인증: **이메일 OTP(magic link) 단일 사용자**

- 개인 도구 — 소셜 OAuth 설정 비용 불필요. 최초 1회 로그인 후 Supabase가 세션 자동 갱신.
- 비로그인 상태에서도 앱은 localStorage만으로 완전 동작 (로그인 = 동기화 활성화 스위치).
- anonymous sign-in은 기기 바뀌면 데이터 유실이라 배제.

### 5-4. 동기화 전략 (write-behind)

```
flush() ──▶ localStorage 즉시 반영 ──▶ syncQueue에 push
                                        │ (온라인 && 로그인 시)
                                        ▼
                          Supabase upsert (sessions / segments 배치)
```

- flush마다 segment 1행 upsert + session `updated_at`/`elapsed_ms` 갱신. 실패 시 큐 유지, 온라인 복귀(`online` 이벤트) 시 재시도.
- 시작 시: Supabase `sessions` 목록 fetch → localStorage와 id 기준 병합. 세그먼트는 세션 열람 시 lazy 로드.
- 충돌 정책: 단일 사용자·단일 기기 시나리오이므로 `updated_at` 최신 승리로 충분. CRDT 불필요.
- API 키·오디오 원본은 **어디에도 업로드하지 않음** (텍스트 전사만 저장).

---

## 6. 단계별 실행 계획

### Phase 1 — Relay UI 재구축 + 세션화 (7/4 ~ 7/8) ✦ 최우선

1. 디자인 토큰 CSS 변수화, Google Fonts 로드, 두 뷰 마크업 (`2a` 픽셀 스펙 준수)
2. 해시 라우팅 + 세션 CRUD (localStorage)
3. 기존 엔진 이식 + 상태 머신 (ready/listening/paused/ended) + 타이머
4. 세그먼트 렌더(타임스탬프/캐럿/오토스크롤), .TXT/COPY, 자동 제목/rename
5. **완료 기준**: 기존 index.html의 모든 검증된 기능이 새 UI에서 동일하게 동작 + 새로고침해도 세션 기록 유지

### Phase 2 — Supabase 연동 (7/9 ~ 7/12)

1. 프로젝트 생성, 테이블+RLS 마이그레이션 (§5-2 SQL)
2. 이메일 OTP 로그인 (레일 하단 or 메인 상단 바에 mono 링크 하나)
3. write-behind 동기화 + 시작 시 병합, 오프라인 큐(`online` 이벤트 재시도)
4. **완료 기준**: 브라우저/기기를 바꿔 로그인해도 세션 목록·전사 열람 가능, 동기화 실패분(네트워크 순단·토큰 만료)이 온라인 복귀 시 자동 반영

### Phase 3 — 고도화 (7/13 ~ 7/16, 우선순위순 · 시간 되는 만큼)

| 항목 | 내용 | 비고 |
|---|---|---|
| 세션 이어보기 UX | ended 세션 읽기 전용 뷰 다듬기, 세그먼트 lazy 로드 | Phase 2 완충 |
| AudioWorklet 전환 | ScriptProcessor deprecated 대체 | 동작엔 지장 없음 |
| session resumption | 재연결 시 resumption handle 사용해 문맥 연속성 | Live API 세션 시간 제한 대비 |
| PWA 매니페스트 | 홈 화면 설치 + 오프라인 셸 | 출장 사용성 |
| 자동 제목 생성 | 세션 종료 시 첫 세그먼트들 요약으로 제목 제안 | Gemini 일반 API 1콜 |
| ephemeral token | Supabase Edge Function으로 Gemini 키 브라우저 노출 제거 | 개인용이라 후순위 |
| 전사 검색 | 메인 인덱스 상단 검색 (Postgres `ilike` / FTS) | 데이터 쌓인 후 |

### 미착수 (명시적 제외)

- 다중 사용자 공유/협업, 모바일 전용 레이아웃(데스크톱 우선, 최소한의 반응형만), 오디오 녹음 파일 저장, i18n.

---

## 7. 리스크 & 미결 사항

| # | 리스크/질문 | 대응 |
|---|---|---|
| 1 | Live API 세션 시간 제한(장시간 회의) | 자동 재연결은 이미 동작. Phase 3 resumption handle로 보강 |
| 2 | `● ENGLISH — AUTO` 감지 언어 표기 — API가 언어 코드를 안 줌 | v1은 `AUTO`만 표기. 필요 시 첫 세그먼트 텍스트로 휴리스틱 |
| 3 | 탭 오디오 공유 시 "오디오 공유" 미체크 실수 | 기존 에러 안내 유지 + 레일 캡션에 힌트 |
| 4 | 출장지 네트워크 불안정 | 번역은 온라인 필수(대체 불가) — Gemini 자동 재연결로 순단 버팀. 로컬 저장은 크래시 유실 방지·오프라인 열람용이지 오프라인 번역 수단이 아님 |
| 5 | preview 모델 변경/중단 가능성 | 모델명 상수 1곳 관리. 출장 직전(7/15) 동작 재검증 |
| 6 | 음성 재생 토글 유지 여부 | 유지로 가정 (§4-3). 불필요하면 알려줄 것 |
| 7 | Supabase 리전 | 서울(ap-northeast-2) 권장 — 미국에서도 목록 로드 지연은 허용 수준, 실시간성 필요한 건 Gemini뿐 |

---

## 8. 참고

- 디자인 계약: `실시간 번역 웹사이트 디자인/design_handoff_relay_live_translation/README.md` (토큰·픽셀 스펙은 이 문서가 원본)
- 확정 시안: `Relay Design.dc.html` `#t2` → `2a` 카드 3종
- 기존 엔진: 루트 `index.html` (Phase 1에서 이식 후 `legacy.html`로 보존 권장)
