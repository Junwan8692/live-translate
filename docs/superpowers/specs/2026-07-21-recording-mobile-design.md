# Relay 고도화 — 세션 녹음(+사후 전사) & 모바일 최적화 설계

> 2026-07-21 작성. 대상: `docs/PLAN.md`의 v1 완성본 위에 추가.
> 원칙 유지: 바닐라 JS, 빌드/의존성 추가 금지, 로컬 우선.

## 1. 목표

1. **REC 모드**: 세션을 "녹음 전용"으로 돌리고, 종료 후 배치 API로 전사+번역을 자동 생성.
   실시간이 필요 없는 자리는 Live API(분당 과금) 대신 훨씬 싼 배치 경로를 쓴다.
2. **다시듣기**: 모든 녹음은 Supabase Storage에 저장, 세션 화면에서 재생 + 전사 타임스탬프 클릭 시 해당 시점 점프.
3. **모바일 최적화**: iOS/Android 반응형 + 청취 중 화면 꺼짐 방지 + PWA 홈 화면 설치.

## 2. 범위 밖 (백로그)

- 재생 중 현재 세그먼트 하이라이트 (점프만 이번 범위)
- 녹음 청크 실시간 업로드 (End 전 탭 닫으면 녹음 유실 — 알려진 한계로 수용)
- Google Drive 저장 전환 (Storage 용량이 실제로 아플 때)
- LIVE 모드 세션에 사후 전사 재실행 (REC 모드 전용으로 시작)
- 오프라인 캐싱(서비스워커) — 실시간 API 앱이라 무의미

## 3. 설계 A — 세션 모드와 녹음

### 3-1. 모드 모델

- `sessions.mode: 'live' | 'rec'` (기본 `'live'`, 기존 행은 마이그레이션 불필요 — default로 흡수).
- 세션 레일의 SOURCE 토글과 같은 패턴으로 **MODE 토글(LIVE / REC)** 추가. ready 상태에서만 변경 가능.
- **LIVE**: 기존 동작 그대로 + 녹음 병행.
- **REC**: Gemini Live 연결을 생략 — 캡처와 MediaRecorder만 동작. 전사 영역에는 `RECORDING — TRANSCRIPT WILL BE GENERATED AFTER END` 안내. API 키 없이도 녹음 가능(전사 시점에만 키 필요).
- 상태머신(helpers.js FSM)은 그대로 재사용 — REC도 ready/listening/paused/ended 동일. 상태칩 문구만 모드별 분기(`● RECORDING`).

### 3-2. 녹음 캡처 (양 모드 공통)

- `js/recorder.js` 신규 — MediaRecorder 래퍼. 입력: MediaStream(오디오 트랙만 복제), 콜백: onDone(blob, startMs, durMs).
- 포맷: `MediaRecorder.isTypeSupported('audio/mp4')`면 mp4(AAC), 아니면 `audio/webm;codecs=opus`.
  mp4 우선 이유: iPhone 재생 호환(웹킷은 webm/opus 재생 불가).
- 엔진 수정 최소화: `engine.start()`가 트랙 확보 직후 `cb.onStream(new MediaStream(audioTracks))` 호출 (1줄).
  REC 모드는 engine을 거치지 않고 app에서 직접 getUserMedia/getDisplayMedia → 동일 recorder 사용.
  - ponytail: 캡처 코드가 engine과 app에 한 벌씩 생기는 대신 engine 개조를 피함. 중복이 아프면 캡처 헬퍼 추출.
- 타임라인 정렬: pause/resume 액션에서 `recorder.pause()/resume()` 호출 → 오디오 시간축과 세그먼트 `tsMs`(경과시간 기준)가 일치.
- **멀티파트**: END 후 RESUME, 소스 전환 시 스트림이 새로 시작되므로 세션당 녹음 파일 N개(보통 1개). 파트마다 `startMs` = 시작 시점의 누적 경과시간.

### 3-3. 저장

Storage 버킷 `recordings` (private), 경로 `{user_id}/{session_id}/{seq}.(m4a|webm)`.

```sql
create table public.recordings (
  session_id uuid not null references public.sessions on delete cascade,
  seq        integer not null check (seq > 0),
  start_ms   integer not null check (start_ms >= 0),
  dur_ms     integer not null check (dur_ms >= 0),
  path       text not null,
  created_at timestamptz not null default now(),
  primary key (session_id, seq)
);
-- RLS: segments와 동일 패턴 (자기 세션의 것만 select/insert/delete)
-- Storage 정책: 경로 1번째 세그먼트 = auth.uid() 인 파일만 read/write
alter table public.sessions add column mode text not null default 'live'
  check (mode in ('live', 'rec'));
```

- 업로드: 파트 종료(pause 아님 — stop) 시 `sync.js` 경유로 Storage 업로드 + recordings insert.
- 실패 시: Blob을 메모리에 보관, 세션 화면에 `RETRY UPLOAD` 표시. 탭을 닫으면 녹음 유실(전사는 로컬에 무사).
- 비로그인/로컬 전용 모드: 업로드 대상이 없으므로 **녹음 기능 비활성** (REC 모드 토글 숨김, LIVE 녹음 안 함).

### 3-4. 사후 전사 파이프라인 (REC 모드)

END → 업로드 완료 → 자동으로 전사 시작. 수동 `TRANSCRIBE` 버튼도 동일 코드 경로(자동 실행 실패/탭 닫음 후 재시도용).

1. 오디오 확보: 업로드된 파트를 순서대로 처리.
2. 크기 분기: Blob ≤ 20MB → generateContent에 base64 inline. 초과 → Gemini Files API 업로드 후 URI 참조.
   (1시간 녹음 ~15–30MB라 Files API 경로가 사실상 기본.)
3. `generateContent` 호출 — `js/config.js`에 `BATCH_MODEL` 추가(flash 계열, 단일 정의처).
   structured output(responseSchema)으로 강제:
   `[{ startSec: number, original: string, translated: string }]`
   프롬프트: 원문 언어 자동 감지, 세션의 targetLang으로 번역, 문단 단위 분할, 시작 시각 포함.
4. 세그먼트 저장: `tsMs = part.start_ms + startSec*1000`, 기존 segments 테이블/store 재사용.
   기존 다시듣기·타임스탬프 점프 UI가 그대로 동작.
5. 진행 표시: 상태줄 `TRANSCRIBING…` → 완료 시 전사 렌더. 실패 시 `TRANSCRIBE FAILED — RETRY` 버튼.

한계(명시): 사후 전사의 타임스탬프는 모델 추정이라 수 초 오차 가능. 전사 완료까지 탭을 열어둬야 함(닫으면 나중에 TRANSCRIBE 버튼으로 재실행).

### 3-5. 다시듣기 UI

- 세션 화면 전사 상단에 `<audio controls>` 플레이어 — recordings 있을 때만 표시, 서명 URL(만료 1h)로 로드.
- 파트 N개면 셀렉터(또는 순차 재생)로 전환. 보통 1개라 단일 플레이어가 기본 경험.
- 타임스탬프 클릭: `start_ms ≤ tsMs`인 마지막 파트 선택 → `audio.currentTime = (tsMs - start_ms)/1000` → play.
- 파트 선택 로직은 순수 함수로 `helpers.js`에 두고 `test/`에 Node 테스트 추가.

## 4. 설계 B — 모바일 최적화 + PWA

1. **반응형** (index.html `<style>`에 `@media (max-width: 720px)`):
   - 홈: 레일/목록 세로 스택.
   - 세션: 컨트롤 레일 → 상단 컴팩트 바. 전사 2컬럼 → **번역 단독 + `SHOW ORIGINAL` 토글**.
   - 터치 타깃 최소 44px, 플레이어/버튼 폭 100%.
2. **Wake Lock**: listening/recording 중 `navigator.wakeLock.request('screen')`, pause/end/라우트 이탈 시 해제, `visibilitychange` 복귀 시 재획득. 미지원 브라우저는 조용히 무시.
3. **iOS 오디오 검증(리스크)**: 엔진이 `AudioContext({sampleRate:16000})` 가정. iOS가 무시하면 `inCtx.sampleRate` 확인 후 onaudioprocess에서 선형 다운샘플. 실기기(iOS Safari) 검증 필수 항목.
4. **PWA**: `manifest.json`(name, icons 192/512, display standalone, theme_color #F6F3EC) + `apple-touch-icon`·`theme-color` 메타. 서비스워커 없음(설치 요건에 필요해지면 no-op 워커만).

## 5. 병렬 실행 계획

| 워크스트림 | 내용 | 주요 파일 |
|---|---|---|
| **WS1 녹음+전사** | recorder.js, 스키마, 업로드, REC 모드, 사후 전사, 플레이어 | `js/recorder.js`(신규), `engine.js`(콜백 1줄), `js/sync.js`, `js/app.js`, `index.html`(마크업), `supabase/schema.sql`, `js/config.js`, `helpers.js`+test |
| **WS2 모바일** | 반응형 CSS, wake lock, iOS 리샘플, PWA | `index.html`(CSS·메타), `js/app.js`(wake lock), `engine.js`(리샘플), `manifest.json`(신규) |

- 각 WS는 별도 git worktree에서 진행, **WS1 먼저 머지 → WS2 리베이스 후 머지**.
- 겹치는 파일(index.html, app.js, engine.js)은 수정 영역이 분리됨(마크업 vs CSS, 액션 핸들러 vs wake lock, onStream vs 리샘플) — 충돌은 경미할 것.
- WS1 내부는 순차: 스키마/recorder → 업로드 → REC 모드 → 사후 전사 → 플레이어.

## 6. 검증 체크리스트

- [ ] LIVE 세션: 번역 + 녹음 병행, END 후 플레이어 표시, 타임스탬프 클릭 점프 정확(±1s)
- [ ] REC 세션: API 키 없이 녹음, END 후 자동 전사+번역 세그먼트 생성
- [ ] pause 구간이 오디오/타임라인 양쪽에서 동일하게 제외되는지
- [ ] 1시간급 녹음(>20MB)이 Files API 경로로 전사되는지
- [ ] 업로드 실패 → RETRY UPLOAD 동작
- [ ] PC(Chrome) 녹음 → iPhone(Safari) 재생
- [ ] 모바일(iOS/Android): 마이크 세션 시작 → 화면 안 꺼짐 → 번역/녹음 정상
- [ ] 홈 화면 설치(PWA) 후 전체화면 실행
- [ ] `node --test` 전체 통과

## 7. 리스크

| 리스크 | 대응 |
|---|---|
| iOS AudioContext 16kHz 미지원 | sampleRate 확인 + 다운샘플 폴백 (§4-3) |
| 사후 전사 타임스탬프 오차 | 한계로 명시, 점프 UX에는 수 초 오차 허용 |
| Storage 1GB 초과 | Supabase 이메일 경고 + 수동 삭제 운영. 초과 시 업로드만 실패(과금 없음) |
| 장시간 오디오 전사 응답 초과(토큰/시간) | 파트가 이미 자연 분할 단위. 그래도 초과 시 Files API + 구간 지정 재호출은 백로그 |
