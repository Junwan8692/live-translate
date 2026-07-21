# Relay — 실시간 번역 웹앱

영↔한 실시간 음성 번역 웹앱. 바닐라 JS, 빌드 과정 없음 — 정적 파일이 전부다.
전체 기획서: `docs/PLAN.md` · EC2 배포: `docs/DEPLOY.md`

## 명령어

- 로컬 서버: `npx -y http-server -p 8787 -c-1` (Windows는 `start.cmd`)
- 테스트: `node --test` (package.json 없음 — Node 내장 러너가 test/*.test.mjs 자동 발견)

## 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 단일 페이지. 모든 뷰(login/home/session)가 여기 있고 JS가 표시를 전환 |
| `js/app.js` | 진입점. 해시 라우팅, 뷰 렌더, Google OAuth 인증, 이벤트 바인딩 |
| `js/engine.js` | Gemini Live API 번역 엔진 (마이크 캡처 → 스트리밍 번역, 16kHz 다운샘플 폴백) |
| `js/recorder.js` | MediaRecorder 래퍼 — 세션 오디오 녹음 (mp4/AAC 우선, iPhone 재생 호환) |
| `js/transcribe.js` | REC 세션 사후 전사+번역 (generateContent, 20MB 초과 시 Files API) |
| `js/helpers.js` | 세션 상태 머신(FSM)과 순수 헬퍼 — 주요 테스트 대상 |
| `js/store.js` | localStorage 기반 세션/세그먼트 저장소 |
| `js/sync.js` | Supabase 동기화 (업로드 큐, hydration, fullSync) |
| `js/config.js` | 모델명(MODEL·BATCH_MODEL) + Supabase URL/publishable key 단일 정의처 |
| `supabase/schema.sql` | DB 스키마 (RLS·Storage 정책 포함) — 적용은 대시보드 SQL Editor에서 수동 |
| `manifest.json` `icons/` | PWA 홈 화면 설치 (서비스워커 없음 — 실시간 API 앱이라 오프라인 무의미) |

## 시크릿 규칙

- Gemini API 키 우선순위: `js/env.local.js`(.gitignore됨, `export const GEMINI_KEY = '...'`) →
  Supabase `app_secrets` 테이블(로그인 + `allowed_emails` 명단 등록자만 RLS로 조회) → 키 입력창(localStorage).
  **이 파일은 절대 커밋하지 않는다.** 배포 서버에는 Cloudflare Access로 사이트 전체를 보호한 경우에만 둔다
  (`docs/DEPLOY.md` 4·6번) — Access 없이는 클라이언트 JS라 방문자 전원에게 노출된다.
- `js/config.js`에는 Supabase publishable key만 둔다. service_role 키·Google Client Secret 금지.

## 동작 원칙

- 로컬 우선: Supabase 설정이 비어 있으면 로컬 전용 모드로 완전 동작. 설정돼 있으면 로그인 게이트 활성.
- 마이크(`getUserMedia`)는 secure context(localhost 또는 HTTPS)에서만 작동한다.
- 프레임워크·빌드 도구 도입 금지 — 바닐라 JS 유지는 의도된 결정 (`docs/PLAN.md` 참조).
- 세션 모드 2개: LIVE(실시간 번역 + 녹음 병행) / REC(녹음만 → END 후 배치 API로 자동 전사+번역).
  녹음은 로그인 시에만 동작(업로드처가 Supabase Storage `recordings` 버킷). 파트별 `transcribed_at`
  마커로 증분 전사 — 전사 안 된 파트만 처리.
- 세그먼트 `tsMs`는 일시정지 제외 경과시간 — 녹음도 pause 시 같이 멈춰 오디오 시간축과 일치
  (타임스탬프 클릭 점프의 근거). 스펙: `docs/superpowers/specs/2026-07-21-recording-mobile-design.md`
- **배포 서버는 반드시 `http-server -c-1`** — python `http.server`는 Cache-Control 헤더가 없어
  Cloudflare가 js를 2시간 엣지 캐싱, "고쳤는데 옛날 동작" 문제가 재발한다.
