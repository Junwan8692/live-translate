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
  assert.equal(store.hasSegments(s.id), true);
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

test('addSegment: seq는 length가 아니라 마지막 seq를 잇는다', () => {
  const id = 'seq-id';
  store.setSegments(id, [{ seq: 7, originalText: 'x', translatedText: 'y' }]);
  assert.equal(store.addSegment(id, { originalText: 'a', translatedText: 'b' }).seq, 8);
});

test('mergeRemoteSessions: 라이브(listening/paused) 로컬 세션은 원격이 못 덮는다', () => {
  const s = store.createSession();
  store.updateSession(s.id, { status: 'listening' });
  const local = store.getSession(s.id);
  store.mergeRemoteSessions([{ ...local, status: 'ready', updatedAt: local.updatedAt + 99999 }]);
  assert.equal(store.getSession(s.id).status, 'listening');
});

test('clearLocal: 세션/세그먼트/큐/원격표시를 모두 제거한다', () => {
  const s = store.createSession();
  store.addSegment(s.id, { originalText: 'a', translatedText: 'b' });
  store.markRemoteSessions([s.id]);
  store.clearLocal();
  assert.equal(store.listSessions().length, 0);
  assert.equal(store.pendingOps().length, 0);
  assert.equal(store.hasSegments(s.id), false);
  assert.equal(store.isRemoteSession(s.id), false);
});

test('원격 세션 표시와 빈 세그먼트 캐시를 구분한다', () => {
  const id = 'remote-id';
  assert.equal(store.isRemoteSession(id), false);
  assert.equal(store.hasSegments(id), false);
  store.markRemoteSessions([id]);
  store.setSegments(id, []);
  assert.equal(store.isRemoteSession(id), true);
  assert.equal(store.hasSegments(id), true);
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

test('createSession: mode 기본 live, rec 지정 가능', () => {
  const store2 = createStore(memStorage());
  assert.equal(store2.createSession().mode, 'live');
  assert.equal(store2.createSession({ mode: 'rec' }).mode, 'rec');
});
