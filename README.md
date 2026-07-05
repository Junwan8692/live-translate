# Relay — 실시간 번역기

Gemini Live로 마이크 또는 브라우저 탭 오디오를 실시간 번역하고, 원문/번역 기록을 세션별로 저장하는 정적 웹 앱이다.

- 빌드 과정 없는 바닐라 JavaScript SPA
- 로컬 저장 우선(localStorage)
- Google OAuth 로그인과 Supabase 기기 간 동기화
- 원문/번역 TXT 다운로드 및 클립보드 복사

## 로컬 실행

1. Gemini API 키 발급: <https://aistudio.google.com/apikey>
2. (선택) `js/env.local.js`의 `GEMINI_KEY`에 키 입력 — 이후 앱에서 키 입력창이 뜨지 않는다 (.gitignore 등록, 커밋 안 됨)
3. `start.cmd` 실행
4. <http://localhost:8787> 접속
5. 세션을 만들고 Start translation (env 키가 없으면 이때 키 입력창이 뜬다)

Supabase 설정이 비어 있어도 `LOCAL ONLY` 모드로 모든 번역·로컬 저장 기능을 사용할 수 있다.

## Supabase와 Google OAuth 설정

### 1. Supabase 프로젝트

1. Supabase 프로젝트를 생성한다.
2. SQL Editor에서 [`supabase/schema.sql`](supabase/schema.sql)을 실행한다.
3. Authentication → URL Configuration:
   - Site URL: `http://localhost:8787`
   - Redirect URLs: `http://localhost:8787/**`

### 2. Google OAuth

1. Google Auth Platform에서 Web application OAuth Client를 생성한다.
2. Authorized JavaScript origins에 `http://localhost:8787`을 추가한다.
3. Authorized redirect URIs에 아래 Supabase 콜백을 추가한다.

   ```text
   https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback
   ```

4. Supabase Authentication → Providers → Google에서 Google Client ID와 Client Secret을 입력하고 활성화한다.

Google Client Secret은 Supabase Dashboard에만 입력한다. 브라우저 코드나 Git에는 저장하지 않는다.

### 3. 앱 연결

Supabase Dashboard의 Project URL과 publishable key를 [`js/config.js`](js/config.js)에 입력한다.

```js
export const SUPABASE_URL = 'https://<PROJECT_REF>.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';
```

`service_role` key는 브라우저에서 사용하면 안 된다.

## 동기화 방식

- 모든 변경은 localStorage에 먼저 저장된다.
- 로그인 상태에서는 변경 큐를 Supabase에 비동기로 반영한다.
- 네트워크 오류가 나면 큐를 보존하고 온라인 복귀 시 재시도한다.
- 로그인 시 원격 세션 목록을 병합한다.
- 다른 기기에서 생성한 종료 세션의 전사는 세션을 열 때 받아 로컬에 캐시한다.
- Gemini API 키와 오디오 원본은 Supabase에 업로드하지 않는다. 세션 메타데이터와 전사 텍스트만 동기화한다.

## 테스트

```powershell
node --test test/*.test.mjs
```

실제 마이크·탭 오디오·Gemini 연결과 OAuth 리디렉션은 브라우저에서 별도로 확인해야 한다.

## 참고

- Gemini 모델은 [`js/config.js`](js/config.js)에서 지정한다.
- 같은 언어를 번역 대상으로 선택하면 출력이 없을 수 있다.
- 탭 오디오 테스트에서는 공유 창의 “오디오 공유” 옵션을 활성화해야 한다.
- 공식 Gemini Live Translate 문서: <https://ai.google.dev/gemini-api/docs/live-api/live-translate>
- Supabase Google 로그인 문서: <https://supabase.com/docs/guides/auth/social-login/auth-google>
