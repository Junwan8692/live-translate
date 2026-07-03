// 순수 헬퍼 — 브라우저/Node 공용. DOM/window 접근 금지.
const p2 = n => String(n).padStart(2, '0');

export const shortId = id => id.replaceAll('-', '').slice(0, 8);
export const timeLabel = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const autoTitle = d => `Session ${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${timeLabel(d)}`;
export const fmtTimer = ms => {
  const s = Math.floor(ms / 1000);
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
};
export const fmtDateHeader = d => `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} — SEOUL`;
export const fmtIndexMeta = s => {
  const c = new Date(s.createdAt);
  const mins = Math.round((s.elapsedMs || 0) / 60000);
  return `${p2(c.getMonth() + 1)}.${p2(c.getDate())} · ${(s.srcLang || 'AUTO').toUpperCase()}→${s.targetLang.toUpperCase()} · ${mins} MIN`;
};
export const countWords = segs =>
  segs.reduce((n, g) => n + (g.originalText.trim() ? g.originalText.trim().split(/\s+/).length : 0), 0);

// 상태머신: 디자인 README "State Management" 절의 전이만 허용
const TRANSITIONS = {
  ready: { start: 'listening' },
  listening: { pause: 'paused', end: 'ended' },
  paused: { resume: 'listening', end: 'ended' },
};
export const transition = (status, action) => TRANSITIONS[status]?.[action] ?? null;

export const toTxt = (session, segs) =>
  segs.map(g => `[${g.timeLabel}]\n원문: ${g.originalText}\n번역: ${g.translatedText}\n`).join('\n');
