import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
};

let store;
beforeEach(() => { store = createStore(memStorage()); });

test('createSession: 기본값과 uuid', () => {
  const s = store.createSession();
  assert.match(s.id, /^[0-9a-f-]{36}$/);
  assert.equal(s.status, 'ready');
  assert.equal(s.targetLang, 'ko');
  assert.equal(s.source, 'mic');
  assert.equal(s.title, null);
  assert.equal(store.getSession(s.id).id, s.id);
});

test('listSessions: createdAt 내림차순', () => {
  const a = store.createSession();
  store.updateSession(a.id, {});               // updatedAt만 변경
  const b = store.createSession();
  b.createdAt += 1000;                          // 강제로 더 늦게
  store.updateSession(b.id, { createdAt: b.createdAt });
  assert.equal(store.listSessions()[0].id, b.id);
});

test('updateSession: 병합 + updatedAt 증가, 없는 id는 null', () => {
  const s = store.createSession();
  const before = s.updatedAt;
  const u = store.updateSession(s.id, { title: 'My talk', status: 'listening' });
  assert.equal(u.title, 'My talk');
  assert.equal(u.status, 'listening');
  assert.ok(u.updatedAt >= before);
  assert.equal(store.updateSession('nope', {}), null);
});

test('addSegment: seq 자동 부여, getSegments 순서 유지', () => {
  const s = store.createSession();
  const g1 = store.addSegment(s.id, { tsMs: 0, timeLabel: '14:02', originalText: 'Hi', translatedText: '안녕', srcLang: null });
  const g2 = store.addSegment(s.id, { tsMs: 5000, timeLabel: '14:02', originalText: 'Bye', translatedText: '잘가', srcLang: null });
  assert.equal(g1.seq, 1);
  assert.equal(g2.seq, 2);
  assert.deepEqual(store.getSegments(s.id).map(g => g.originalText), ['Hi', 'Bye']);
});

test('mergeRemoteSessions: updatedAt 최신 승리', () => {
  const s = store.createSession();
  const localTitle = store.updateSession(s.id, { title: 'local' });
  store.mergeRemoteSessions([{ ...localTitle, title: 'remote-old', updatedAt: localTitle.updatedAt - 100 }]);
  assert.equal(store.getSession(s.id).title, 'local');
  store.mergeRemoteSessions([{ ...localTitle, title: 'remote-new', updatedAt: localTitle.updatedAt + 100 }]);
  assert.equal(store.getSession(s.id).title, 'remote-new');
  store.mergeRemoteSessions([{ id: 'brand-new', title: null, targetLang: 'ko', source: 'mic', status: 'ended', elapsedMs: 0, createdAt: 1, endedAt: 2, updatedAt: 3 }]);
  assert.ok(store.getSession('brand-new'));
});

test('큐: create/update/addSegment가 op을 쌓고 중복은 제거', () => {
  const s = store.createSession();
  store.updateSession(s.id, { title: 't' });    // 같은 session op → dedupe
  store.addSegment(s.id, { tsMs: 0, timeLabel: '14:02', originalText: 'a', translatedText: 'b', srcLang: null });
  const ops = store.pendingOps();
  assert.equal(ops.filter(o => o.type === 'session').length, 1);
  assert.equal(ops.filter(o => o.type === 'segment').length, 1);
});

test('drain: 성공 시 비움, 실패 시 중단하고 잔여 보존', async () => {
  const s = store.createSession();
  store.addSegment(s.id, { tsMs: 0, timeLabel: '14:02', originalText: 'a', translatedText: 'b', srcLang: null });
  const pushed = [];
  let failNext = true;
  const push = async op => { if (failNext) { failNext = false; throw new Error('offline'); } pushed.push(op); };
  const remain1 = await store.drain(push);      // 첫 op에서 실패 → 전부 보존
  assert.equal(remain1, 2);
  assert.equal(pushed.length, 0);
  const remain2 = await store.drain(push);      // 재시도 → 전부 성공
  assert.equal(remain2, 0);
  assert.equal(pushed.length, 2);
  assert.equal(store.pendingOps().length, 0);
});

test('drain: push 도중 enqueue된 op 유실 없음', async () => {
  const s = store.createSession();
  const pushed = [];
  let injected = false;
  await store.drain(async op => {
    pushed.push(op);
    if (!injected) { injected = true; store.addSegment(s.id, { tsMs: 0, timeLabel: '14:02', originalText: 'a', translatedText: 'b', srcLang: null }); }
  });
  assert.ok(pushed.some(o => o.type === 'segment'));
  assert.equal(store.pendingOps().length, 0);
});

test('drain: push 중 같은 세션이 갱신되면 op이 다시 큐에 들어가 재push됨', async () => {
  const s = store.createSession();
  const pushed = [];
  let updated = false;
  await store.drain(async op => {
    pushed.push(op);
    if (!updated) { updated = true; store.updateSession(s.id, { title: 'mid-flight' }); }
  });
  assert.equal(pushed.filter(o => o.type === 'session' && o.id === s.id).length, 2);
  assert.equal(store.pendingOps().length, 0);
});
