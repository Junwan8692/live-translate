# Relay 모바일 최종 디자인 적용 기획서 — "Relay Mobile Final"

> 2026-07-21 작성. 디자인 소스: claude.ai/design 프로젝트 「실시간 번역 앱 모바일 디자인」의
> `Relay Mobile Final.dc.html` (모바일 디자인 — 최종안 v1).
> 이 문서 작성 시점에 구현도 함께 완료됨 — 아래는 적용된 설계의 기록이자 검증 기준.

## 1. 목표와 원칙

1. **모바일(≤720px)에서만** 새 디자인으로 동작한다. 데스크톱 UI는 기존 그대로 유지.
2. **PWA 앱 경험**: 홈 화면 설치(manifest 기존 구성 유지) + 스마트폰에서 앱처럼 쓰는 3화면 플로우.
3. 기존 원칙 유지: 바닐라 JS, 빌드/의존성 추가 금지, 로컬 우선, 상태머신(helpers.js FSM) 재사용.
4. 디자인이 정의한 3화면(로그인 / 홈 / 라이브)만 교체 — 디자인이 다루지 않은 상태(ready·ended,
   플레이어, 전사, 저장)는 기존 모바일 클래식 UI가 그대로 담당한다.

## 2. 화면별 매핑 (디자인 → 구현)

### 01 로그인 — `#login-mobile`

| 디자인 | 구현 |
|---|---|
| 블링크 도트 + RELAY 헤더, 대형 이탤릭 타이틀, 카피 | `#view-login` 안에 모바일 전용 블록 신설. 데스크톱 로그인(`#login-desktop`)은 media query로 상호 배타 표시 |
| Google 로고 버튼 "Google로 계속하기" | `#login-btn-m` — 기존 `btn-signin` OAuth 로직에 위임 |
| "Google에 연결 중…" 스피너 상태 | 버튼에 `.busy` 클래스 — 클릭 시 표시, OAuth 리다이렉트 실패로 되돌아오면 해제 |
| 하단 안내/약관 문구 | 정적 텍스트 (약관 링크는 placeholder `#`) |

Supabase 초기화 실패 시 기존 `SYNC UNAVAILABLE — CONTINUE OFFLINE` 우회 버튼도 모바일 블록에 복제(`#login-skip-m`).

### 02 홈 — `#m-home` + 바텀시트 `#sheet`

| 디자인 | 구현 |
|---|---|
| 링 애니메이션 마이크 버튼 "탭해서 녹음 시작" | `#m-mic` — 탭하면 시트 오픈. 데스크톱 hero/Create session은 모바일에서 숨김 |
| 칩 2개 (자동 감지 → 언어 / 마이크) | 시트 오픈 트리거. 언어 칩은 시트의 언어 선택과 동기화 |
| 최근 세션 리스트 (번호 + 제목/메타 스택) | 기존 `idx-row`를 모바일 media query로 재배치 — 렌더 코드 변경 없음 |
| 바텀시트: 번역 언어 + 모드 토글 + 녹음 시작 | `#sheet-lang`(기존 언어 목록 동일), `#sheet-mode`(실시간 번역/녹음만), `#sheet-start` |

**원탭 시작 플로우**: `녹음 시작` → `store.createSession({targetLang, mode})` → 세션 라우팅 →
`renderSession`이 `autoStartId` 플래그를 보고 즉시 `doAction('start')`. 마이크 권한 프롬프트가 이때 뜬다.

게이팅: 비로그인/로컬 전용이면 시트에서 모드 토글 숨김 + 강제 `live` (녹음 업로드처가 없으므로 —
기존 `mode-sec` 게이팅과 동일 규칙). 소스는 모바일에서 항상 마이크(탭 오디오는 데스크톱 전용 개념).

### 03 라이브 — 포커스 뷰 `#focus` (다크 오버레이)

세션 상태가 `listening`/`paused`일 때만 표시되는 전체 화면 오버레이. `ready`/`ended`는 클래식 뷰.

| 디자인 | 구현 |
|---|---|
| 헤더: "녹음 중 — 타이머", 자동 감지 → 언어, 힌트 | `#f-state`(틱마다 갱신), `#f-lang-txt` — REC 모드면 "녹음만 — 종료 후 전사됩니다"로 스왑 |
| 포커스 전사: 현재 문장 대형 세리프, 직전 2개 점감 dim | CSS `:last-child`/`:nth-last-child(2)` 티어. 스트리밍 partial(`#f-cur`)이 있으면 `has-partial` 클래스로 티어 한 칸씩 밀림 |
| 세그먼트 탭 → ORIGINAL 원문 토글 | `appendFocusSeg`가 세그먼트별 원문 블록 생성, 탭 토글. 현재 partial도 탭 시 원문 표시 |
| ↑ 스크롤 시 "라이브로 돌아가기 ↓" pill | 스크롤 위치 감지(`focusAtBottom`) → `.scrolled` 클래스. pill 탭 시 smooth 스크롤 복귀 |
| 웨이브 바 24개 | 디자인 고정 높이/딜레이 배열, CSS 애니메이션. paused 시 `animation-play-state: paused` |
| 컨트롤: ❚❚ 일시정지 / ■ 종료 / ◇ | pause↔resume(아이콘 스왑), end, **◇ = 클래식 뷰 전환**(디자인 미정의 버튼에 부여한 기능) |

◇로 클래식 뷰에 나가면 하단 고정 `● 라이브 뷰로 돌아가기` pill(`#f-return`)이 떠서 복귀 가능 —
청취 중에도 언어 변경·저장 등 클래식 기능 접근을 유지하기 위함.

**전사 이원 렌더**: `appendSeg`/`renderTranscript`/`onPartial`이 데스크톱 2컬럼과 포커스 뷰 DOM을
동시에 갱신한다. 상태 반영은 `renderStatus` 끝의 `paintFocus(status)` 한 곳.

오버레이가 켜지는 순간(display:none 동안 렌더된 히스토리는 scrollTop 0) 바닥으로 강제 스크롤 —
헤드리스 검증에서 발견해 수정한 버그.

### 03b 라이브 — 종료 다크 시트 (v2 추가)

■ 탭 → `doAction('end')` 후 포커스 뷰 위에 다크 시트(`#end-layer`) 오픈. 헤더 라벨 "세션 종료됨", 웨이브 정지.

| 디자인 | 구현 |
|---|---|
| 요약 "00:47 · N문장 저장됨" | REC 미전사 시 "녹음 저장됨 — 전사 중" |
| 이어서 녹음 | `doAction('resume')` — 새 파트로 이어짐. 실패 시 리더 뷰 폴백 |
| 설정 변경 ▾ (언어/모드 펼침) | 기존 `$('lang')` change 경로·`switchMode` 재사용 — 다음 구간부터 적용 |
| 기록 보기 → | 시트+오버레이 닫고 아래의 리더 뷰 노출 |

### 04 세션 열람 — 리더 뷰 `#m-reader` (v2 추가)

모바일에서 클래식 세션 레일을 **대체**한다(`.session-grid`는 모바일에서 display:none).

| 디자인 | 구현 |
|---|---|
| ← 세션 / 제목 / 메타 | 기존 헬퍼(shortId·autoTitle·fmtCost) 재사용, 분 단위 추가 |
| 번역/원문/대역 탭 | `readerTab` 상태로 리스트 재렌더 |
| 전체 복사 (복사됨 ✓ 1.6s) | 활성 탭 기준 `[시각] 텍스트` 포맷 복사 |
| 세그먼트 탭 → 싱크 재생 | 기존 `seekTo(tsMs)` 재사용 |
| 재생 중 세그먼트 하이라이트 | `timeupdate`에서 `part.startMs + currentTime`으로 활성 행 계산 |
| 하단 플레이어 카드 | 숨겨진 `<audio id="player">` 구동 — 재생/일시정지·진행바·시계·PART 순환 |
| (디자인 외) 이어서 녹음 pill | ← 세션 줄 우측 — ready면 start, 아니면 resume. 유저 플로우 "세션 확인 후 이어서 진행" 요청분 |

전사 진행/오류 표시는 `#status-line`을 MutationObserver로 미러링(`#mr-status`) — TRANSCRIB/ERROR/FAILED류만 노출.

**모바일에서 잃는 클래식 기능**(의도된 한계, 필요 시 추가): 세션 이름 변경, .TXT 다운로드, 소스(탭 오디오) 전환, API 키 수동 입력(비로그인 로컬 모드 한정 문제 — 로그인 사용자는 app_secrets 키 사용).

## 3. 디자인이 다루지 않아 내린 결정

- **ready/ended 상태**: 클래식 모바일 UI 유지 (플레이어, TRANSCRIBE, 저장, 이름 변경 전부 기존).
- **◇ 버튼**: 목업에 핸들러 없음 → 클래식 뷰 전환으로 정의.
- **REC 모드 라이브 화면**: 세그먼트가 없으므로 타이머+웨이브+안내 문구만.
- **일시정지 상태**: 디자인 미정의 → 헤더 "일시정지", ❚❚→▶, 애니메이션 정지로 처리.
- **색/폰트**: 다크 화면 색은 디자인 값 그대로(#121009, #B33A28, #E4523A 등). 라이트 화면은
  기존 토큰 재사용(#8C1A12 vs 디자인 #8B2117 — 육안 구분 불가, 정의처 단일 유지).
  폰트는 기존 Google Fonts 링크에 굵은 웨이트(Playfair 700/900i, Noto Serif KR 700/900, Mono 600)만 추가.
- **PWA**: manifest/아이콘/standalone 기존 구성 그대로 — 변경 불필요. 서비스워커 없음 유지(실시간 API 앱).

## 4. 변경 파일

| 파일 | 내용 |
|---|---|
| `index.html` | 폰트 웨이트 추가 · 공통 keyframes/로그인 CSS · 모바일 media query(홈/시트/포커스) · `#login-mobile` `#m-home` `#sheet` `#focus` `#f-return` 마크업 |
| `js/app.js` | 모바일 로그인 위임+busy · 시트 오픈/모드/원탭 시작(`autoStartId`) · 포커스 뷰 렌더/컨트롤(`paintFocus`, `appendFocusSeg`, `setFocusPartial`) · 기존 렌더 경로에 훅 3줄 |
| 그 외 | 없음 — store/engine/sync/helpers/schema 무변경 |

## 5. 검증

- [x] `node --test` 36개 전체 통과
- [x] 헤드리스 Chromium(402×874, 모바일 에뮬레이션) 스모크: 로그인 모바일/데스크톱 상호 배타 표시,
      홈 마이크+칩, 시트 오픈, 로컬 전용 시 모드 토글 숨김, 원탭 시작→세션 진입,
      포커스 뷰 진입 시 바닥 정렬, 원문 탭 토글, 스크롤업 pill 표시/복귀, ◇↔라이브 뷰 전환
- [ ] 실기기(iOS Safari/PWA): 마이크 권한, 시트 애니메이션, safe-area 인셋, 화면 꺼짐 방지 — **수동 확인 필요**
- [ ] 로그인 상태에서 REC 모드 원탭 시작 → END → 자동 전사 (헤드리스에선 OAuth 불가로 미검증)

## 6. 백로그

- 데스크톱 홈/라이브에도 새 디자인 언어 확장 (현재는 모바일 전용이 명세)
- 약관/개인정보처리방침 실제 문서 연결
- 홈 "전체 →" 세션 아카이브 화면 (현재 리스트가 전체 표시라 생략)
- 포커스 뷰 내 언어 변경 UI (현재는 ◇ → 클래식 뷰 경유)
