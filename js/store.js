// 세션/세그먼트 영속화 + write-behind 큐. storage는 주입(localStorage 또는 테스트 심). DOM 금지.
export function createStore(storage) {
  const read = (k, fallback) => { const v = storage.getItem(k); return v ? JSON.parse(v) : fallback; };
  const write = (k, v) => storage.setItem(k, JSON.stringify(v));
  const sessions = () => read('relay.sessions', []);
  const segmentsKey = id => `relay.segments.${id}`;

  const store = {
    listSessions: () => sessions().sort((a, b) => b.createdAt - a.createdAt),
    getSession: id => sessions().find(s => s.id === id) ?? null,

    createSession({ targetLang = 'ko', source = 'mic' } = {}) {
      const now = Date.now();
      const s = { id: crypto.randomUUID(), title: null, targetLang, source, status: 'ready', elapsedMs: 0, createdAt: now, endedAt: null, updatedAt: now };
      write('relay.sessions', [...sessions(), s]);
      write(segmentsKey(s.id), []);
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

    hasSegments: id => storage.getItem(segmentsKey(id)) !== null,

    getSegments: id => read(segmentsKey(id), []),

    addSegment(id, seg) {
      const segs = store.getSegments(id);
      const full = { seq: (segs[segs.length - 1]?.seq ?? 0) + 1, ...seg }; // length가 아닌 마지막 seq 기준 — 원격 병합 캐시와의 충돌 방지

      write(segmentsKey(id), [...segs, full]);
      store.enqueue({ type: 'segment', id, seq: full.seq });
      return full;
    },

    setSegments: (id, segs) => write(segmentsKey(id), segs),

    markRemoteSessions(ids) {
      const known = new Set(read('relay.remoteSessions', []));
      ids.forEach(id => known.add(id));
      write('relay.remoteSessions', [...known]);
    },

    isRemoteSession: id => read('relay.remoteSessions', []).includes(id),

    // 다른 계정 로그인 시 이전 계정 로컬 캐시 폐기 (프라이버시 + 타 계정 큐 op의 RLS 거부 방지)
    clearLocal() {
      sessions().forEach(s => storage.removeItem(segmentsKey(s.id)));
      ['relay.sessions', 'relay.queue', 'relay.remoteSessions'].forEach(k => storage.removeItem(k));
    },

    mergeRemoteSessions(remote) {
      const byId = new Map(sessions().map(s => [s.id, s]));
      for (const r of remote) {
        const l = byId.get(r.id);
        if (l && (l.status === 'listening' || l.status === 'paused')) continue; // 이 기기에서 라이브 중인 세션은 원격 row가 못 덮음 — 엔진/스토어 desync 방지
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

    // pop-first인 이유: 스냅샷을 잡고 끝에 덮어쓰면 push가 await 중일 때 enqueue된 op이
    // 유실되고, op을 큐에 남겨둔 채 push하면 같은 세션의 진행 중 갱신이 dedupe에 막힘.
    async drain(push) {
      for (;;) {
        const q = store.pendingOps();
        if (!q.length) return 0;
        const op = q[0];
        write('relay.queue', q.slice(1));
        try { await push(op, store); }
        catch { // 실패: op을 앞에 복원하고 중단 — 다음 drain에서 재시도
          const rest = store.pendingOps().filter(o => !(o.type === op.type && o.id === op.id && o.seq === op.seq));
          write('relay.queue', [op, ...rest]);
          return store.pendingOps().length;
        }
      }
    },
  };
  return store;
}
