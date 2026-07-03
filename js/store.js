// 세션/세그먼트 영속화 + write-behind 큐. storage는 주입(localStorage 또는 테스트 심). DOM 금지.
export function createStore(storage) {
  const read = (k, fallback) => { const v = storage.getItem(k); return v ? JSON.parse(v) : fallback; };
  const write = (k, v) => storage.setItem(k, JSON.stringify(v));
  const sessions = () => read('relay.sessions', []);

  const store = {
    listSessions: () => sessions().sort((a, b) => b.createdAt - a.createdAt),
    getSession: id => sessions().find(s => s.id === id) ?? null,

    createSession({ targetLang = 'ko', source = 'mic' } = {}) {
      const now = Date.now();
      const s = { id: crypto.randomUUID(), title: null, targetLang, source, status: 'ready', elapsedMs: 0, createdAt: now, endedAt: null, updatedAt: now };
      write('relay.sessions', [...sessions(), s]);
      store.enqueue({ type: 'session', id: s.id });
      return s;
    },

    updateSession(id, patch) {
      const all = sessions();
      const i = all.findIndex(s => s.id === id);
      if (i < 0) return null;
      all[i] = { ...all[i], ...patch, updatedAt: Date.now() };
      write('relay.sessions', all);
      store.enqueue({ type: 'session', id });
      return all[i];
    },

    getSegments: id => read(`relay.segments.${id}`, []),

    addSegment(id, seg) {
      const segs = store.getSegments(id);
      const full = { seq: segs.length + 1, ...seg };
      write(`relay.segments.${id}`, [...segs, full]);
      store.enqueue({ type: 'segment', id, seq: full.seq });
      return full;
    },

    setSegments: (id, segs) => write(`relay.segments.${id}`, segs),

    mergeRemoteSessions(remote) {
      const byId = new Map(sessions().map(s => [s.id, s]));
      for (const r of remote) {
        const l = byId.get(r.id);
        if (!l || r.updatedAt > l.updatedAt) byId.set(r.id, r);
      }
      write('relay.sessions', [...byId.values()]);
    },

    // ---- write-behind 큐: 페이로드가 아닌 참조만 저장, push 시점에 최신 데이터 조회 ----
    pendingOps: () => read('relay.queue', []),

    enqueue(op) {
      const q = store.pendingOps();
      if (!q.some(o => o.type === op.type && o.id === op.id && o.seq === op.seq)) write('relay.queue', [...q, op]);
    },

    async drain(push) {
      let q = store.pendingOps();
      while (q.length) {
        try { await push(q[0], store); } catch { break; } // 실패 시 중단 — 다음 drain에서 재시도
        q = q.slice(1);
        write('relay.queue', q);
      }
      return q.length;
    },
  };
  return store;
}
