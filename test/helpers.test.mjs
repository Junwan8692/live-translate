import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortId, timeLabel, autoTitle, fmtTimer, fmtDateHeader, fmtIndexMeta, fmtCost, countWords, transition, toTxt } from '../js/helpers.js';

const d = new Date(2026, 6, 3, 14, 2, 7); // 2026-07-03 14:02:07

test('shortId: uuid 앞 8자', () => {
  assert.equal(shortId('a93b18d4-1111-2222-3333-444455556666'), 'a93b18d4');
});

test('timeLabel / autoTitle / fmtDateHeader', () => {
  assert.equal(timeLabel(d), '14:02');
  assert.equal(autoTitle(d), 'Session 07-03 14:02');
  assert.equal(fmtDateHeader(d), '2026.07.03 — SEOUL');
});

test('fmtTimer: ms → HH:MM:SS', () => {
  assert.equal(fmtTimer(0), '00:00:00');
  assert.equal(fmtTimer(877000), '00:14:37');
  assert.equal(fmtTimer(3661000), '01:01:01');
});

test('fmtIndexMeta: 날짜 · 언어쌍 · 분 · 비용', () => {
  const s = { createdAt: d.getTime(), targetLang: 'ko', elapsedMs: 41 * 60000 };
  assert.equal(fmtIndexMeta(s), '07.03 · AUTO→KO · 41 MIN · ~$1.51');
});

test('fmtCost: 청취 시간 기반 상한 추정', () => {
  assert.equal(fmtCost(0), '~$0.00');
  assert.equal(fmtCost(10 * 60000), '~$0.37');   // 10분 × $0.0368
  assert.equal(fmtCost(41 * 60000), '~$1.51');
});

test('countWords: 원문 단어 수 합', () => {
  assert.equal(countWords([{ originalText: 'hello world' }, { originalText: ' one  two three ' }, { originalText: '' }]), 5);
});

test('transition: 디자인 명세 상태 전이만 허용', () => {
  assert.equal(transition('ready', 'start'), 'listening');
  assert.equal(transition('listening', 'pause'), 'paused');
  assert.equal(transition('paused', 'resume'), 'listening');
  assert.equal(transition('listening', 'end'), 'ended');
  assert.equal(transition('paused', 'end'), 'ended');
  assert.equal(transition('ready', 'end'), null);   // READY에서 End 비활성 (디자인 명세)
  assert.equal(transition('ended', 'resume'), 'listening'); // 소프트 종료: End 후 재개 가능
  assert.equal(transition('ended', 'start'), null); // 종료 후 재시작은 resume만 (start 아님)
});

test('toTxt: 타임스탬프 + 원문/번역 쌍', () => {
  const txt = toTxt({ title: 'T' }, [{ timeLabel: '14:02', originalText: 'Hi', translatedText: '안녕' }]);
  assert.ok(txt.includes('[14:02]'));
  assert.ok(txt.includes('Hi'));
  assert.ok(txt.includes('안녕'));
});
