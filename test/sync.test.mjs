import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import {
  createSync,
  sessionFromRow,
  sessionToRow,
  segmentFromRow,
  segmentToRow,
} from '../js/sync.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
};

const fakeWindow = () => {
  const listeners = new Map();
  return {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  };
};

function fakeClient({ signedIn = true, sessions = [], segments = [], upsertError = null } = {}) {
  const tables = { sessions: [...sessions], segments: [...segments] };

  const selectQuery = table => {
    const filters = [];
    let sortKey = null, max = Infinity;
    const result = () => {
      let rows = tables[table].filter(row => filters.every(f => f(row)));
      if (sortKey) rows = [...rows].sort((a, b) => a[sortKey] - b[sortKey]);
      return { data: max === Infinity ? rows : rows.slice(0, max), error: null };
    };
    const query = {
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      gt(key, value) { filters.push(row => row[key] > value); return query; },
      order(key) { sortKey = key; return query; },
      limit(n) { max = n; return query; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return query;
  };

  return {
    tables,
    auth: {
      getSession: async () => ({ data: { session: signedIn ? { user: { id: 'user-1' } } : null }, error: null }),
      getUser: async () => ({ data: { user: signedIn ? { id: 'user-1' } : null }, error: null }),
    },
    from(table) {
      return {
        async upsert(row) {
          const error = upsertError?.(table, row);
          if (error) return { error };
          const keys = table === 'sessions' ? ['id'] : ['session_id', 'seq'];
          const index = tables[table].findIndex(current => keys.every(key => current[key] === row[key]));
          if (index < 0) tables[table].push({ ...row });
          else tables[table][index] = { ...tables[table][index], ...row };
          return { error: null };
        },
        select: () => selectQuery(table),
      };
    },
  };
}

test('Supabase 행 매핑: camelCase와 snake_case를 왕복한다', () => {
  const session = {
    id: '5c4556b8-2a15-4db7-82ec-51fefea7d696',
    title: 'Talk',
    targetLang: 'ko',
    source: 'mic',
    status: 'ended',
    elapsedMs: 1234,
    createdAt: Date.parse('2026-07-03T01:00:00.000Z'),
    endedAt: Date.parse('2026-07-03T01:01:00.000Z'),
    updatedAt: Date.parse('2026-07-03T01:01:00.000Z'),
  };
  assert.deepEqual(sessionFromRow(sessionToRow(session)), session);

  const segment = {
    seq: 1,
    tsMs: 1234,
    timeLabel: '10:00',
    originalText: 'Hello',
    translatedText: '안녕하세요',
    srcLang: null,
  };
  const row = segmentToRow(session.id, segment);
  assert.equal(row.session_id, session.id);
  assert.deepEqual(segmentFromRow(row), segment);
});

test('fullSync: 로컬 큐를 push한 뒤 원격 세션을 병합한다', async t => {
  globalThis.window = fakeWindow();
  t.after(() => { delete globalThis.window; });

  const store = createStore(memStorage());
  const local = store.createSession();
  store.addSegment(local.id, {
    tsMs: 10,
    timeLabel: '10:00',
    originalText: 'Hello',
    translatedText: '안녕하세요',
    srcLang: null,
  });
  const remoteRow = {
    id: '8e543186-54da-4c2b-a217-c086280f77de',
    title: 'Remote',
    target_lang: 'ko',
    source: 'mic',
    status: 'ended',
    elapsed_ms: 100,
    created_at: '2026-07-03T01:00:00.000Z',
    ended_at: '2026-07-03T01:01:00.000Z',
    updated_at: '2026-07-03T01:01:00.000Z',
  };
  const client = fakeClient({ sessions: [remoteRow] });
  const sync = createSync({ client, store });

  assert.equal(await sync.fullSync(), true);
  assert.equal(store.pendingOps().length, 0);
  assert.ok(client.tables.sessions.some(row => row.id === local.id));
  assert.ok(client.tables.segments.some(row => row.session_id === local.id && row.seq === 1));
  assert.equal(store.getSession(remoteRow.id).title, 'Remote');
  assert.equal(store.isRemoteSession(remoteRow.id), true);
  sync.dispose();
});

test('hydrateSegments: 원격 전사를 순서대로 로컬 캐시한다', async t => {
  globalThis.window = fakeWindow();
  t.after(() => { delete globalThis.window; });

  const store = createStore(memStorage());
  const id = '8e543186-54da-4c2b-a217-c086280f77de';
  const client = fakeClient({
    segments: [
      { session_id: id, seq: 2, ts_ms: 20, time_label: '10:01', original_text: 'B', translated_text: '나', src_lang: null },
      { session_id: id, seq: 1, ts_ms: 10, time_label: '10:00', original_text: 'A', translated_text: '가', src_lang: null },
    ],
  });
  const sync = createSync({ client, store });

  assert.equal(store.hasSegments(id), false);
  assert.equal(await sync.hydrateSegments(id), true);
  assert.deepEqual(store.getSegments(id).map(segment => segment.seq), [1, 2]);
  assert.equal(store.hasSegments(id), true);
  sync.dispose();
});

test('flush: 로그아웃 상태에서는 로컬 큐를 보존한다', async t => {
  globalThis.window = fakeWindow();
  t.after(() => { delete globalThis.window; });

  const store = createStore(memStorage());
  store.createSession();
  const sync = createSync({ client: fakeClient({ signedIn: false }), store });

  assert.equal(await sync.flush(), 1);
  assert.equal(store.pendingOps().length, 1);
  sync.dispose();
});

test('hydrateSegments: 로컬 캐시 뒤의 새 세그먼트만 덧붙인다 (재조회/덮어쓰기 없음)', async t => {
  globalThis.window = fakeWindow();
  t.after(() => { delete globalThis.window; });

  const store = createStore(memStorage());
  const id = '8e543186-54da-4c2b-a217-c086280f77de';
  const localSeg = { seq: 1, tsMs: 10, timeLabel: '10:00', originalText: 'LOCAL-A', translatedText: '가', srcLang: null };
  store.setSegments(id, [localSeg]);
  const client = fakeClient({
    segments: [
      { session_id: id, seq: 1, ts_ms: 10, time_label: '10:00', original_text: 'REMOTE-A', translated_text: '가', src_lang: null },
      { session_id: id, seq: 2, ts_ms: 20, time_label: '10:01', original_text: 'B', translated_text: '나', src_lang: null },
    ],
  });
  const sync = createSync({ client, store });

  assert.equal(await sync.hydrateSegments(id), true);
  assert.deepEqual(store.getSegments(id).map(g => g.seq), [1, 2]);
  assert.equal(store.getSegments(id)[0].originalText, 'LOCAL-A'); // 기존 로컬 seq는 그대로
  sync.dispose();
});

test('drain: 영구 실패(RLS/제약) op은 버리고 뒤의 op을 계속 push한다', async t => {
  globalThis.window = fakeWindow();
  t.after(() => { delete globalThis.window; });

  const store = createStore(memStorage());
  const bad = store.createSession();
  const good = store.createSession();
  const client = fakeClient({
    upsertError: (table, row) =>
      table === 'sessions' && row.id === bad.id ? { code: '42501', message: 'RLS violation' } : null,
  });
  const sync = createSync({ client, store });

  assert.equal(await sync.flush(), 0);      // bad는 폐기, good은 push, 큐는 빈다
  assert.ok(client.tables.sessions.some(row => row.id === good.id));
  assert.ok(!client.tables.sessions.some(row => row.id === bad.id));
  sync.dispose();
});
