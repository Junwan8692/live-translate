# Handoff: Relay — 실시간 번역 웹 (Live Translation Web App)

## Overview
Relay는 마이크 또는 브라우저 탭 오디오를 실시간으로 번역해 텍스트로 기록하는 웹 앱이다.
- **메인 페이지**: 세션(프로젝트) 생성 + 지난 세션 목록
- **세션 페이지**: 좌측 컨트롤 레일 + 우측 2단 실시간 전사(좌: 원문, 우: 번역), 타임스탬프 포함

에디토리얼한 무드(세리프 이탤릭 디스플레이 + 모노 레이블 + 웜 페이퍼)가 아이덴티티의 핵심이다.

## About the Design Files
이 번들의 `Relay Design.dc.html`은 **HTML로 제작된 디자인 레퍼런스**다(프로토타입/시안). 프로덕션 코드로 그대로 복사하는 용도가 아니다.
할 일은 **타깃 코드베이스의 기존 환경(React, Vue, Svelte 등)과 패턴/라이브러리로 이 디자인을 재구현**하는 것. 환경이 아직 없다면 프로젝트에 가장 적합한 프레임워크를 선택해 구현한다 (실시간 스트리밍 텍스트 특성상 React + WebSocket/WebRTC 조합 권장).

파일 안에는 여러 시안 턴이 있다. **확정안은 섹션 `#t2`의 옵션 `2a`** (메인 + 세션 + CONTROL STATES 스펙 카드)이며, **디자인 가이드는 섹션 `#t3`** 카드에 시각화되어 있다. `#t1`(display:none 처리)은 탐색 과정의 폐기 시안이므로 무시할 것.

## Fidelity
**High-fidelity (hifi).** 색·타이포·간격·상태가 확정값이다. 픽셀 단위로 재현하되, 코드베이스의 기존 컴포넌트 시스템 위에서 구현할 것.

## Design Tokens

### Colors
| Token | Hex | Usage |
|---|---|---|
| accent | `#8C1A12` | 시작/재개 버튼, 라이브 상태, 타이틀 마침표, 라이브 캐럿 |
| ink | `#1C1A14` | 제목/강조 텍스트, 강한 보더, 버튼 호버 배경 |
| paper | `#F6F3EC` | 페이지 배경 (웜 페이퍼) |
| surface | `#FFFFFF` | 셀렉트·세그먼트 컨트롤 배경 |
| text-secondary | `#4A463C` | 보조 본문, 원문 컬럼 텍스트 |
| muted | `#8A857A` | 모노 레이블, 비활성 세그먼트 텍스트 |
| faint | `#B3AEA1` | 타임스탬프, 푸터 메타 |
| faint-2 | `#A8A395` | 힌트/캡션 모노 텍스트 |
| border | `#D9D4C6` | 인풋/세그먼트 보더 |
| hairline | `#E8E4D9` | 구분선 (1px) |
| hairline-warm | `#E3DFD2` | 메인 인덱스 행 구분선, disabled 보더 |
| disabled-text | `#C4BFB2` | disabled 버튼 텍스트, 대기 타이머 |
| skeleton | `#F0EDE3` | 플레이스홀더 바 |
| row-hover | `#F5F1E6` | 인덱스 행 호버 배경 |
| on-accent / on-ink | `#FBFAF6` | 채워진 버튼 위 텍스트 |

색은 CSS 변수로: `--acc: #8C1A12`, `--paper: #F6F3EC` (디자인 파일은 `var(--acc, fallback)` 패턴 사용).

### Typography (Google Fonts)
로드: Playfair Display (ital 500), Noto Sans KR (400/500/700), Noto Serif KR (400/600), IBM Plex Mono (400/500)

| Role | Font | Spec |
|---|---|---|
| Display hero | Playfair Display Italic 500 | 128px/1, letter-spacing -0.02em, 마지막 마침표만 accent 색 |
| Display statement | Playfair Display Italic 500 | 58px/1.1 |
| Session title (rail) | Playfair Display Italic 500 | 30px/1.2 + accent 마침표 |
| Guide/서브 display | Playfair Display Italic 500 | 42–52px |
| Hero 설명 | Noto Serif KR 400 | 16.5px/1.85, #4A463C |
| 번역 컬럼 | **Noto Serif KR 400** | 16px/1.95, #1C1A14, 문단 간격 22px |
| 원문 컬럼 | Noto Sans KR 400 | 14.5px/1.85, #4A463C, 문단 간격 20px |
| 리스트 타이틀 | Noto Sans KR 500 | 15px (자동 생성 제목은 400 + #6B665A) |
| 버튼 | Noto Sans KR 500 | 13–14px |
| 모노 레이블 | IBM Plex Mono 500 | 9.5–11px, UPPERCASE, letter-spacing 0.12–0.22em |
| 타이머 | IBM Plex Mono 400 | 30px, letter-spacing 0.02em |
| 타임스탬프 | IBM Plex Mono 500 | 10.5px, #B3AEA1, 세그먼트 텍스트 앞 margin-right 10px |
| 인덱스 번호 | IBM Plex Mono 400 | 12px, accent 색 |

### Spacing / Misc
- 메인 콘텐츠 폭 1120px, 패딩 48–72px. 세션 화면은 풀블리드.
- 레일 고정 300px, 패딩 36px 30px. 레일 섹션 간격: margin-top 26–30px + padding-top 24px + hairline border-top.
- 전사 컬럼: `grid-template-columns: 1fr 1fr`, 컬럼 안쪽 거터 32px, 중앙 구분선 hairline 1px.
- 전사 헤더 행 아래 보더는 **ink 1px** (강조). 나머지 구분선은 hairline.
- border-radius: 버튼만 2px. 카드/인풋/세그먼트는 0. **box-shadow 없음** — 위계는 보더와 타이포로.
- 웨이브폼 인디케이터: 2px 폭 바 5개 (높이 6/13/9/14/7px), gap 2px, 라이브 시 accent, idle 시 #8A857A + opacity 0.35.
- 라이브 캐럿: 8×15px accent 블록, 번역 컬럼 마지막 세그먼트 끝에만.

## Screens / Views

### 1. Main — 세션 목록 & 생성 (`data-screen-label="2a Main"`)
- **Purpose**: 새 세션 생성(원클릭), 지난 기록 열람.
- **Layout**: 1120px, 패딩 48px 72px 64px.
  1. 상단 바: 좌 `RELAY — LIVE TRANSLATION` (mono 10px, ls 0.22em), 우 날짜 `2026.07.03 — SEOUL` (mono 10px, muted). 아래 ink 1px 보더, padding-bottom 14px.
  2. 히어로: `Relay.` Playfair Italic 128px + accent 마침표 (margin-top 64px) → 설명 2줄 (Noto Serif KR 16.5px) → CTA 행 (margin-top 40px): **Create session** (accent 솔리드, 17px 36px 패딩, radius 2px, hover ink) + 캡션 `DATE & TIME LOGGED AUTOMATICALLY` (mono 9.5px).
  3. 인덱스: `INDEX — RECENT SESSIONS` 레이블 + ink 보더 → 행 반복: 번호(mono 12px accent) / 제목(Instrument Serif 21px — 구현 시 Playfair 400 21px 또는 유사 세리프로 통일 가능) / 메타(mono 10.5px muted, `07.02 · EN→KO · 41 MIN`). 행 패딩 20px 4px, 구분선 #E3DFD2, hover 배경 #F5F1E6.
- **자동 제목**: 사용자가 이름을 안 지으면 `Session MM-DD HH:MM` 형식, 색만 #6B665A로 낮춤.

### 2. Session — 번역 화면 (`data-screen-label="2a Session Listening"`)
Create session 클릭 시 **바로 이 화면**으로 진입 (중간 설정 화면 없음).

- **Layout**: 풀스크린, `grid-template-columns: 300px 1fr`, min-height 100vh.

**좌측 레일 (위→아래, 각 섹션 hairline로 구분):**
1. `← SESSIONS` 백링크 (mono 10px, muted, hover ink)
2. 세션 제목 (Playfair Italic 30px + accent 마침표) + 메타 `a93b18d4 · 2026.07.03 14:02` (mono 10px #A8A395)
3. **STATUS**: 웨이브폼 바 + 상태 칩 + 타이머 30px. 상태별: READY `○ READY`(muted, 바 opacity 0.35, 타이머 #C4BFB2) / LISTENING `● LISTENING`(accent, 바 accent, 타이머 ink) / PAUSED `❚❚ PAUSED`(muted)
4. **LANGUAGE**: 레이블 (mono 10px ls 0.16em muted) + 셀렉트 박스 (surface bg, border #D9D4C6, 패딩 13px 14px, hover border ink) 값 `Korean — 한국어` + 상태줄 `● TRANSLATING TO KOREAN` (mono 10px accent; READY일 땐 `SOURCE LANGUAGE AUTO-DETECTED` muted)
5. **SOURCE**: 2분할 세그먼트 (border #D9D4C6, 활성 = ink 채움 + #FBFAF6 텍스트, 비활성 = muted 텍스트) `Microphone | Tab audio` + 캡션 `INPUT: MACBOOK PRO MIC` 등
6. **CONTROLS** (같은 슬롯에서 상태 전환, 2열 그리드 gap 8px):
   - READY: **Start translation** (accent 솔리드) + **End session** (disabled: border #E3DFD2, text #C4BFB2, cursor not-allowed)
   - LISTENING: **❚❚ Pause** (ink 아웃라인, hover 채움) + **End session** (accent 아웃라인, hover 채움)
   - PAUSED: **▶ Resume** (accent 솔리드) + **End session** (accent 아웃라인)
   - 버튼 공통: 13px/500, 패딩 13px 0, full-width 그리드 셀
7. **SAVE** (레일 하단 고정, margin-top auto): `.TXT ↓` / `COPY` (mono 11px 아웃라인 버튼) + `AUTO-SAVED 14:16:02` 캡션

**우측 전사 영역** (패딩 36px 44px, flex column):
1. 헤더 행 (ink 1px 하단 보더): 좌 `ORIGINAL` + `● ENGLISH — AUTO` (accent) / 우 `TRANSLATION` + `KOREAN`
2. 본문 2열 (1fr/1fr, 중앙 hairline): 좌 원문 세그먼트(sans 14.5), 우 번역 세그먼트(serif 16). 각 세그먼트 앞 타임스탬프 `14:02`. 마지막 번역 세그먼트 끝에 라이브 캐럿.
3. 푸터 행 (hairline 상단 보더): 좌 `NEW LINES APPEAR AT THE BOTTOM — AUTO-SCROLL ON` / 우 `4 SEGMENTS · 612 WORDS` (mono 9.5px faint)

## Interactions & Behavior
- **Create session** → 세션 레코드 생성(id 8자 hex, 생성 시각 자동 기록) → 즉시 세션 화면 (READY 상태)
- **Start translation** → 마이크 권한 요청(mic 소스일 때) 또는 탭 캡처 픽커(tab 소스일 때) → LISTENING. 타이머 시작, 상태 칩·웨이브폼 accent로.
- **Pause** → PAUSED: 오디오 캡처 중단, 타이머 정지, 전사 보존. **Resume** → LISTENING 복귀.
- **End session** → 세션 종료 후 기록 보기 상태(전사는 읽기 전용, SAVE는 활성 유지). READY에서는 비활성.
- **언어 셀렉트** — 타깃 언어 변경(기본 Korean). 세션 중 변경 시 이후 세그먼트부터 적용.
- **소스 세그먼트** — Mic/Tab 중 하나만 활성. LISTENING 중 전환은 일시 정지 후 재시작으로 처리 권장.
- **.TXT ↓** — `원문/번역 + 타임스탬프` 텍스트 파일 다운로드. **COPY** — 클립보드 복사. 상시 자동 저장(로컬), 캡션에 마지막 저장 시각.
- **오토스크롤** — 새 세그먼트는 하단 추가, 하단 고정 스크롤. 사용자가 위로 스크롤하면 일시 해제(권장).
- **Hover**: 채움 버튼 → ink로; 아웃라인 버튼 → 해당 색으로 채움; 셀렉트/익스포트 → 보더 ink; 리스트 행 → 배경 #F5F1E6.
- 트랜지션은 120–160ms ease 정도로 절제. 웨이브폼은 라이브 시 미세 애니메이션 가능(선택).

## State Management
```
session: { id, title (auto: "Session MM-DD HH:MM", rename 가능), createdAt,
           targetLang (default 'ko'), source ('mic' | 'tab'),
           status ('ready' | 'listening' | 'paused' | 'ended'),
           elapsedMs, segments: [{ tsMs, timeLabel, originalText, translatedText, srcLang }],
           lastSavedAt }
sessions: Session[]  // 메인 인덱스용 (date, langPair, duration, wordCount 파생)
```
- 상태 전이: ready →(start)→ listening ↔(pause/resume)↔ paused →(end)→ ended
- 소스 언어는 세그먼트 단위 자동 감지 결과를 저장 (`● ENGLISH — AUTO` 표기용)
- 실시간 파이프라인: 오디오 스트림 → STT(partial/final) → 번역 스트림. partial 세그먼트는 번역 컬럼 캐럿으로 표시.

## Assets
- 이미지/아이콘 에셋 없음. 아이콘은 텍스트 글리프 사용: `←` `▾` `●` `○` `❚❚` `▶` `→` `↓`
- 웨이브폼/캐럿은 div로 그림 (위 스펙 참조)
- 폰트: Google Fonts CDN (Playfair Display, Noto Sans KR, Noto Serif KR, IBM Plex Mono)

## Files
- `Relay Design.dc.html` — 디자인 원본. **확정안: `#t2` 섹션의 `2a`** (Main / Session-Listening / Control States 카드), **가이드: `#t3`**. `#t1`은 폐기 시안 (숨김).
- `support.js` — 디자인 파일 렌더링용 런타임 (참고용, 구현과 무관)
- `README.md` — 본 문서
