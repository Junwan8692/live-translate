# Live 번역기

Gemini `gemini-3.5-live-translate-preview` 모델로 영어 발표를 실시간 한국어 자막 + (선택) 음성으로 번역하는 단일 HTML 웹툴.

## 준비

1. API 키 발급: https://aistudio.google.com/apikey
2. 실행: `start.cmd` 더블클릭 (또는 `npx -y http-server -p 8787`) → http://localhost:8787

## 사용

- API 키 입력(브라우저 localStorage에 저장됨) → **🎤 마이크 시작**
- 왼쪽 = 원문(영어) 자막, 오른쪽 = 한국어 번역 자막
- **번역 음성 재생** 체크 시 한국어 음성도 출력 (미팅에서는 이어폰 권장)
- **💾 기록 저장**: 원문/번역 전체를 txt로 다운로드 (미팅 노트용)

## 사전 테스트 (혼자서)

**🖥️ 탭 오디오 시작** → 영어 YouTube 영상 탭 선택 + "탭 오디오 공유" 체크 → 실시간 번역 확인.
출장 전에 이 방법으로 충분히 리허설할 것.

## 참고

- 모델이 preview라 출장 전 주 단위로 동작 재확인 권장
- 연결이 끊기면 자동 재연결됨 (자막 기록은 유지)
- 언어 변경은 실행 중에도 즉시 반영됨 (세션 자동 전환)
- 원문과 목표 언어가 같으면 아무 출력도 나오지 않음 (정상 — 번역할 게 없음). 한국어로 혼자 테스트하려면 목표 언어를 English로.
- 공식 문서: https://ai.google.dev/gemini-api/docs/live-api/live-translate
- 공식 예제: https://github.com/google-gemini/gemini-live-api-examples
- AI Studio 데모(설치 불필요): https://aistudio.google.com/live?model=gemini-3.5-live-translate-preview
