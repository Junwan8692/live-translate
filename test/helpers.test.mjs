import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortId, timeLabel, autoTitle, fmtTimer, fmtDateHeader, fmtIndexMeta, fmtCost, countWords, transition, toTxt, findPart, transcriptToSegments, downsampleTo16k } from '../js/helpers.js';

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

test('findPart: tsMs가 속한 파트를 고른다', () => {
  const parts = [{ seq: 1, startMs: 0 }, { seq: 2, startMs: 60000 }];
  assert.equal(findPart(parts, 0).seq, 1);
  assert.equal(findPart(parts, 59999).seq, 1);
  assert.equal(findPart(parts, 60000).seq, 2);
  assert.equal(findPart(parts, 999999).seq, 2);
});

test('findPart: 경계 — 첫 파트 이전이면 첫 파트, 빈 배열이면 null', () => {
  assert.equal(findPart([{ seq: 1, startMs: 5000 }], 100).seq, 1);
  assert.equal(findPart([], 100), null);
});

test('transcriptToSegments: 파트 오프셋 합산 + 정렬 + 클램프', () => {
  const items = [
    { startSec: 10, original: 'b', translated: 'B' },
    { startSec: 2.5, original: 'a', translated: 'A' },
    { startSec: -3, original: 'x', translated: 'X' },
  ];
  const segs = transcriptToSegments(items, 60000);
  assert.deepEqual(segs.map(g => g.tsMs), [60000, 62500, 70000]);
  assert.equal(segs[1].originalText, 'a');
  assert.equal(segs[1].translatedText, 'A');
});

test('downsampleTo16k: 16k 입력은 그대로', () => {
  const f32 = new Float32Array([0.1, 0.2, 0.3]);
  assert.equal(downsampleTo16k(f32, 16000), f32);
});

test('downsampleTo16k: 48k→16k는 1/3 길이 + 선형보간 값', () => {
  const f32 = new Float32Array([0, 0.3, 0.6, 0.9, 1.2, 1.5]);
  const out = downsampleTo16k(f32, 48000);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0] - 0) < 1e-6);
  assert.ok(Math.abs(out[1] - 0.9) < 1e-6); // pos=3.0 → f32[3]
});

test('downsampleTo16k: 비정수 배율(44.1k)도 동작', () => {
  const out = downsampleTo16k(new Float32Array(441), 44100);
  assert.equal(out.length, 160);
});
