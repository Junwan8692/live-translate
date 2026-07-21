// 순수 헬퍼 — 브라우저/Node 공용. DOM/window 접근 금지.
import { COST_PER_MIN_USD } from './config.js';

const p2 = n => String(n).padStart(2, '0');

export const shortId = id => id.replaceAll('-', '').slice(0, 8);
export const timeLabel = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const autoTitle = d => `Session ${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${timeLabel(d)}`;
export const fmtTimer = ms => {
  const s = Math.floor(ms / 1000);
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
};
export const fmtDateHeader = d => `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} — SEOUL`;
export const fmtCost = ms => `~$${(ms / 60000 * COST_PER_MIN_USD).toFixed(2)}`;
export const fmtIndexMeta = s => {
  const c = new Date(s.createdAt);
  const mins = Math.round((s.elapsedMs || 0) / 60000);
  return `${p2(c.getMonth() + 1)}.${p2(c.getDate())} · ${(s.srcLang || 'AUTO').toUpperCase()}→${s.targetLang.toUpperCase()} · ${mins} MIN · ${fmtCost(s.elapsedMs || 0)}`;
};
export const countWords = segs =>
  segs.reduce((n, g) => n + (g.originalText.trim() ? g.originalText.trim().split(/\s+/).length : 0), 0);

// 상태머신: 디자인 README "State Management" 절의 전이 + ended→resume 재개(소프트 종료)
// ended는 read-only가 기본이지만, resume으로 같은 세션에 이어 담기 허용 (End 오조작 복구용)
const TRANSITIONS = {
  ready: { start: 'listening' },
  listening: { pause: 'paused', end: 'ended' },
  paused: { resume: 'listening', end: 'ended' },
  ended: { resume: 'listening' },
};
export const transition = (status, action) => TRANSITIONS[status]?.[action] ?? null;

export const toTxt = (session, segs) =>
  segs.map(g => `[${g.timeLabel}]\n원문: ${g.originalText}\n번역: ${g.translatedText}\n`).join('\n');

// ---- 녹음/사후 전사 ----
// parts: {seq, startMs} 오름차순. tsMs가 속한 파트(startMs<=tsMs인 마지막) 선택.
export const findPart = (parts, tsMs) =>
  parts.filter(p => p.startMs <= tsMs).at(-1) ?? parts[0] ?? null;

// 배치 전사 응답 [{startSec, original, translated}] → 세그먼트 필드로 변환
export const transcriptToSegments = (items, partStartMs) =>
  items
    .map(t => ({
      tsMs: partStartMs + Math.max(0, Math.round((t.startSec || 0) * 1000)),
      originalText: (t.original || '').trim(),
      translatedText: (t.translated || '').trim(),
    }))
    .sort((a, b) => a.tsMs - b.tsMs);

// iOS 등이 AudioContext({sampleRate:16000})를 무시할 때의 선형보간 다운샘플 폴백
export const downsampleTo16k = (f32, srcRate) => {
  if (srcRate === 16000) return f32;
  const ratio = srcRate / 16000;
  const out = new Float32Array(Math.floor(f32.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio, lo = Math.floor(pos), hi = Math.min(lo + 1, f32.length - 1);
    out[i] = f32[lo] + (f32[hi] - f32[lo]) * (pos - lo);
  }
  return out;
};
