# _To-do — Relay 재구축 남은 작업

> 2026-07-03 갱신. Task 1~8 완료, Task 9~11 코드 구현 완료(미커밋).
> 인증 방식은 이메일 OTP에서 **Google OAuth → Supabase Auth 세션**으로 변경.
> 진행 원장: `.superpowers/sdd/progress.md` (git 미추적 — 각 태스크 브리프/리포트도 같은 폴더).

## 완료된 것

- Relay 디자인 SPA 완성: Main(세션 인덱스) + Session(레일+2단 전사) 뷰, 해시 라우팅
- 상태머신(ready/listening/paused/ended) + 타이머 + 라이브 전사 + localStorage 영속화
- Gemini Live 엔진 이식 (2.5s flush 디바운스·gen 카운터·언어 전환 보존, 바이트 단위 검증)
- .TXT 다운로드 / COPY / 제목 인라인 rename
- 유닛 테스트 21/21 (`node --test test/*.test.mjs`)
- 리뷰에서 잡은 실버그 3건 픽스 완료: drain() 큐 유실, doAction 재진입, rename 상태 리셋
- **디자인 스펙 변경 (사용자 승인, 커밋 829df3d)**: ENDED = 소프트 종료. 핸드오프 README는 ended를 read-only terminal로 정의했으나, End 오조작 복구를 위해 ENDED 컨트롤에 `▶ Resume session` 추가 → 같은 세션에 이어 담기 가능. ended→resume은 fresh engine.start(End 때 스트림 정리됨), 재개 시 endedAt=null. 최종 리뷰/문서에 반영 필요.
- Supabase RLS 스키마 + Google OAuth(PKCE) + 로그인/로그아웃
- localStorage write-behind 동기화, 온라인 재시도, 원격 세션 병합
- 종료 세션 원격 전사 lazy load + 로컬 캐시
- PAUSED 화면 이탈/연결 실패 시 미디어 스트림 정리

## 남은 작업

### 1. Supabase/Google 콘솔 설정

- [ ] Supabase 프로젝트 생성 후 `supabase/schema.sql` 실행
- [ ] Google Web OAuth Client 생성
- [ ] Google origin에 `http://localhost:8787` 등록
- [ ] Google redirect URI에 `https://<PROJECT_REF>.supabase.co/auth/v1/callback` 등록
- [ ] Supabase Google Provider에 Client ID/Secret 입력
- [ ] Supabase Site URL/Redirect URLs 설정
- [ ] Project URL + publishable key를 `js/config.js`에 입력

상세 순서는 루트 `README.md` 참고. config가 비어 있으면 앱은 `LOCAL ONLY`로 계속 동작한다.

### 2. HUMAN VERIFY — Google OAuth/Supabase E2E

- [ ] Google 로그인 → 원래 해시 경로로 복귀, 상단에 이메일 표시
- [ ] 세션 생성/rename/전사 → `sessions`/`segments` 행 생성
- [ ] Offline 중 변경 → `relay.queue` 유지 → Online 복귀 후 반영
- [ ] 다른 브라우저에서 로그인 → 세션 목록 표시
- [ ] 다른 브라우저에서 ended 세션 열기 → 전사 lazy load, TXT/COPY 동작
- [ ] 로그아웃 상태에서도 로컬 번역/저장 정상

### 3. HUMAN VERIFY — 마이크 실기기 테스트
`start.cmd` 실행 → Create session → API 키 입력 → Start translation:
- [ ] 2.5s 침묵 → 세그먼트 정확히 1회 확정 (빠른 발화 중 조기 flush 없음)
- [ ] Pause→Resume: 같은 mediaStream 유지 (탭 픽커 재출현 없음), 타이머 누적 이어짐
- [ ] 청취 중 언어 변경 → 다음 세그먼트부터 새 언어
- [ ] 탭 공유 "오디오 공유" 미체크 → 안내 캡션
- [ ] 공유 중단(TRACK_ENDED) → 자동 PAUSED
- [ ] 재생 토글 켠 채 start→stop→start 반복 시 오디오 정상
- [ ] End session → ENDED, .TXT/COPY 동작, Resume session으로 이어서 기록
- [ ] Start 더블클릭에도 단일 세션 (busy 가드)

### 4. 최종 whole-branch 리뷰
- 리뷰 패키지: `scripts/review-package 4b825dc642cb6eb9a060e54bf8d69288fbee4904 HEAD` (루트가 empty-tree)
- 아래 Minor findings 목록을 함께 전달해 triage

## 2026-07-04 코드리뷰(xhigh) 결과 — Codex 구현분 검증 및 수정 완료

Task 9~11 미커밋분 리뷰에서 CONFIRMED 13건 / PLAUSIBLE 2건 발견, 심각한 것부터 수정 완료 (테스트 26/26, 브라우저 스모크 통과):

- **[수정]** 원격 세션 hydrate가 ended에만 걸려 있어 ready 상태 원격 세션에서 Start 시 seq 충돌로 서버 전사를 덮어씀 → 모든 원격 세션 열람/시작/재개 시 seq 커서 delta-fetch (스테일 캐시·1000행 캡도 함께 해결)
- **[수정]** 영구 실패 op(RLS/제약 위반)이 큐 선두를 영원히 막음 → Postgres 22*/23*/42* 에러는 op 폐기 후 계속 진행 (로컬 데이터는 유지)
- **[수정]** 다른 기기에서 열람만 해도 라이브 세션의 서버 row를 'ready'로 클로버 → 다운그레이드는 로컬 전용으로 (push 제거)
- **[수정]** fullSync 병합이 열려 있는 라이브 세션 row를 교체해 엔진/스토어 desync (마이크 켜진 채 방치) → listening/paused 로컬 세션은 병합 보호 + onSegment null 가드
- **[수정]** 중단된 OAuth 시도의 잔여 returnHash가 나중에 라우트를 하이재킹 → ?code= 콜백 로드에서만 복원
- **[수정]** supabase-js CDN top-level await가 앱 부팅 전체를 블로킹 → route() 후 비동기 초기화로 이동
- **[수정]** signOut 기본 scope 'global'이 다른 기기 세션까지 무효화 → scope 'local'
- **[수정]** 계정 전환 시 이전 계정 데이터 혼입/유출 → 다른 계정 로그인 시 store.clearLocal()
- **[수정]** syncedUserId 래치가 실패/예외 시 영구 고착 → try/catch + 해제, 무처리 rejection에 .catch
- **[수정]** 로그아웃 상태 'SYNC PENDING' 오표기, 네트워크 오류에 'SIGN IN' 안내 → signedIn 신호 + 메시지 분기

**남은 알려진 한계 (미수정, 낮은 우선순위)**:
- LWW 충돌 해소가 클라이언트 시계 기반 — 기기 간 시계가 수 분 어긋나면 최신 편집이 뒤집힐 수 있음 (서버 트리거 도입 시 해결, Phase 3)
- relay.queue 다중 탭 동시 쓰기 경합 (단일 탭 사용 전제)
- engine.js의 @google/genai esm.run static import는 여전히 부팅 블로킹 (기존부터 존재 — 벤더링이 근본 해결, Phase 3)
- 세그먼트 push가 op당 1 요청 (배치 upsert로 개선 가능 — drain 계약 재작업 필요)
- test fake client가 에러 경로 일부만 커버 (영구실패 드롭 테스트는 추가됨)

## Minor findings (최종 리뷰 때 triage — 원장 사본)

- [T1] 디자인 레퍼런스 2벌 중복 추적 (~4,766줄) — 하우스키핑 후보
- [T3] mergeRemoteSessions 동률은 로컬 승리 (단일 사용자라 무해)
- [T6] outCtx/nextPlayTime 미리셋 (legacy 동일) — 재생 QA 항목
- [T7] ended 상태에서 lang/src/playback 상호작용 가능 (소프트 종료 정책과 함께 최종 UX triage)
- [T7] start await 중 소스 토글 시 UI/실제 캡처 불일치 가능
- [T8] COPY 연타 타임아웃 미해제 / clipboard 실패 무음 / revokeObjectURL 동기 호출
