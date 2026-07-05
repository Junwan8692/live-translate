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
| `js/engine.js` | Gemini Live API 번역 엔진 (마이크 캡처 → 스트리밍 번역) |
| `js/helpers.js` | 세션 상태 머신(FSM)과 순수 헬퍼 — 주요 테스트 대상 |
| `js/store.js` | localStorage 기반 세션/세그먼트 저장소 |
| `js/sync.js` | Supabase 동기화 (업로드 큐, hydration, fullSync) |
| `js/config.js` | 모델명 + Supabase URL/publishable key 단일 정의처 |
| `supabase/schema.sql` | DB 스키마 (RLS 포함) |

## 시크릿 규칙

- Gemini API 키는 `js/env.local.js`(.gitignore됨)에 `export const GEMINI_KEY = '...'` 형태로 둔다.
  파일이 없으면 앱이 키 입력창을 띄우고 localStorage에 저장한다.
  **이 파일은 절대 커밋하거나 배포 서버에 만들지 않는다** — 클라이언트 JS라 방문자 전원에게 노출된다.
- `js/config.js`에는 Supabase publishable key만 둔다. service_role 키·Google Client Secret 금지.

## 동작 원칙

- 로컬 우선: Supabase 설정이 비어 있으면 로컬 전용 모드로 완전 동작. 설정돼 있으면 로그인 게이트 활성.
- 마이크(`getUserMedia`)는 secure context(localhost 또는 HTTPS)에서만 작동한다.
- 프레임워크·빌드 도구 도입 금지 — 바닐라 JS 유지는 의도된 결정 (`docs/PLAN.md` 참조).
