// 모델명/Supabase 접속 정보 단일 정의처.
// Supabase 값이 비어 있으면 앱은 로컬 전용으로 동작한다.
// 브라우저에는 publishable key만 사용한다. service_role key나 Google Client Secret은 절대 넣지 않는다.
export const MODEL = 'gemini-3.5-live-translate-preview';
export const BATCH_MODEL = 'gemini-2.5-flash'; // 사후 전사/번역용 (오디오 이해)
export const SUPABASE_URL = 'https://dcnestmacaotvtwrbljh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ziBJn-03QdskHRp8Q3ulLw_a-sidz1b';

// Gemini 3.5 Live Translate 유료 등급 단가 (2026-07 공식 가격표).
// 오디오 초당 25토큰: 입력 $3.50/1M + 출력 $21.00/1M → 입·출력 연속 시 분당 $0.0368.
// 출력(번역 발화)이 없는 구간은 과금이 줄므로, 이 값으로 계산한 비용은 상한 추정치다.
export const COST_PER_MIN_USD = 0.0368;
