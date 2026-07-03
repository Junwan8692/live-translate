# _To-do — Relay 재구축 남은 작업

> 2026-07-03 실행 중단 시점 기록. Task 1~8 완료 (Phase 1 전체), Task 9~11 미착수.
> 재개 방법: `docs/superpowers/plans/2026-07-03-relay-rebuild.md` 계획서를 superpowers:subagent-driven-development로 계속 실행.
> 진행 원장: `.superpowers/sdd/progress.md` (git 미추적 — 각 태스크 브리프/리포트도 같은 폴더).

## 완료된 것 (Task 1~8, 커밋 2ac30ba..4b36b27)

- Relay 디자인 SPA 완성: Main(세션 인덱스) + Session(레일+2단 전사) 뷰, 해시 라우팅
- 상태머신(ready/listening/paused/ended) + 타이머 + 라이브 전사 + localStorage 영속화
- Gemini Live 엔진 이식 (2.5s flush 디바운스·gen 카운터·언어 전환 보존, 바이트 단위 검증)
- .TXT 다운로드 / COPY / 제목 인라인 rename
- 유닛 테스트 16/16 (`node --test test/*.test.mjs`)
- 리뷰에서 잡은 실버그 3건 픽스 완료: drain() 큐 유실, doAction 재진입, rename 상태 리셋

## 남은 작업

### 1. Task 9 — Supabase 스키마 + 클라이언트 + 이메일 OTP 로그인
- `supabase/schema.sql` 작성 (계획서 Task 9 Step 1에 SQL 전문)
- **사용자 작업 (코드보다 먼저 가능)**:
  1. https://supabase.com 프로젝트 생성 — 리전 Seoul(ap-northeast-2)
  2. SQL Editor에서 schema.sql 실행
  3. Auth > URL Configuration에 `http://localhost:8787` redirect 추가
  4. Project URL + anon key를 `js/config.js`에 입력
- app.js에 클라이언트 초기화 + SIGN IN/OUT (코드 전문 계획서에 있음)
- config 비어 있으면 `LOCAL ONLY` 표시 — 앱은 지금도 로컬 전용으로 완전 동작

### 2. Task 10 — write-behind 동기화 어댑터
- queueChanged() 스텁을 실제 drain으로 교체, pushOp 어댑터(camelCase↔snake_case), fullSync 병합, online 재시도
- ⚠️ 계약 노트 (T3 리뷰): **pushOp는 store에 역기입 금지** (매 push마다 enqueue 유발 시 drain 무한루프)
- ⚠️ 크래시-mid-push 시 segment op 재enqueue 경로 없음 → 필요 시 시작 시 reconcile (Phase 3 후보)

### 3. Task 11 — ended 세션 원격 lazy 로드 + 최종 E2E
- hydrateSegments (코드 계획서에 있음) + 기획서 완료 기준 체크리스트

### 4. HUMAN VERIFY — 마이크 실기기 테스트 (Task 7에서 이월, 코드와 무관하게 지금 가능)
`start.cmd` 실행 → Create session → API 키 입력 → Start translation:
- [ ] 2.5s 침묵 → 세그먼트 정확히 1회 확정 (빠른 발화 중 조기 flush 없음)
- [ ] Pause→Resume: 같은 mediaStream 유지 (탭 픽커 재출현 없음), 타이머 누적 이어짐
- [ ] 청취 중 언어 변경 → 다음 세그먼트부터 새 언어
- [ ] 탭 공유 "오디오 공유" 미체크 → 안내 캡션
- [ ] 공유 중단(TRACK_ENDED) → 자동 PAUSED
- [ ] 재생 토글 켠 채 start→stop→start 반복 시 오디오 정상
- [ ] End session → ENDED 읽기 전용, .TXT/COPY 동작
- [ ] Start 더블클릭에도 단일 세션 (busy 가드)

### 5. 최종 whole-branch 리뷰 (superpowers:requesting-code-review, 최상위 모델)
- 리뷰 패키지: `scripts/review-package 4b825dc642cb6eb9a060e54bf8d69288fbee4904 HEAD` (루트가 empty-tree)
- 아래 Minor findings 목록을 함께 전달해 triage

## Minor findings (최종 리뷰 때 triage — 원장 사본)

- [T1] 빈 test/·supabase/ 디렉토리 git 미추적 (fresh clone 시 없음)
- [T1] 디자인 레퍼런스 2벌 중복 추적 (~4,766줄) — 하우스키핑 후보
- [T3] mergeRemoteSessions 동률은 로컬 승리 (단일 사용자라 무해)
- [T6] outCtx/nextPlayTime 미리셋 (legacy 동일) — 재생 QA 항목
- [T7] ended 상태에서 lang/src/playback 여전히 상호작용 가능 (READ ONLY 불일치, 기능 영향 없음)
- [T7] start await 중 소스 토글 시 UI/실제 캡처 불일치 가능
- [T8] COPY 연타 타임아웃 미해제 / clipboard 실패 무음 / revokeObjectURL 동기 호출
