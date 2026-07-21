// Supabase 행 매핑 + localStorage write-behind 동기화.
// Google provider token은 사용하지 않는다. Supabase Auth 세션만 DB 접근에 사용한다.

export const sessionFromRow = r => ({
  id: r.id,
  title: r.title,
  targetLang: r.target_lang,
  source: r.source,
  status: r.status,
  elapsedMs: r.elapsed_ms,
  createdAt: Date.parse(r.created_at),
  endedAt: r.ended_at ? Date.parse(r.ended_at) : null,
  updatedAt: Date.parse(r.updated_at),
  mode: r.mode ?? 'live',
});

export const sessionToRow = s => ({
  id: s.id,
  title: s.title,
  target_lang: s.targetLang,
  source: s.source,
  status: s.status,
  elapsed_ms: s.elapsedMs,
  created_at: new Date(s.createdAt).toISOString(),
  ended_at: s.endedAt ? new Date(s.endedAt).toISOString() : null,
  updated_at: new Date(s.updatedAt).toISOString(),
  mode: s.mode ?? 'live',
});

export const segmentFromRow = r => ({
  seq: r.seq,
  tsMs: r.ts_ms,
  timeLabel: r.time_label,
  originalText: r.original_text,
  translatedText: r.translated_text,
  srcLang: r.src_lang,
});

export const segmentToRow = (sessionId, g) => ({
  session_id: sessionId,
  seq: g.seq,
  ts_ms: g.tsMs,
  time_label: g.timeLabel,
  original_text: g.originalText,
  translated_text: g.translatedText,
  src_lang: g.srcLang,
});

export const recordingFromRow = r => ({
  seq: r.seq,
  startMs: r.start_ms,
  durMs: r.dur_ms,
  path: r.path,
});

// Postgres 제약/권한 위반(22*/23*/42*)은 재시도해도 영원히 실패한다.
// 이런 op은 버려서 큐 선두 정체를 막는다 — 원본 데이터는 localStorage에 그대로 남는다.
export const isPermanentError = e => typeof e?.code === 'string' && /^(22|23|42)/.test(e.code);

const PAGE = 1000; // Supabase 기본 max-rows — seq 커서로 페이지 페치

export function createSync({ client, store, onSessionsChanged = () => {}, onState = () => {}, debounceMs = 800 }) {
  let drainTimer = null;
  let activeDrain = null;

  async function pushOp(op, st) {
    if (op.type === 'session') {
      const session = st.getSession(op.id);
      if (!session) return;
      const { error } = await client
        .from('sessions')
        .upsert(sessionToRow(session), { onConflict: 'id' });
      if (error) throw error;
      st.markRemoteSessions([session.id]);
      return;
    }

    const segment = st.getSegments(op.id).find(g => g.seq === op.seq);
    if (!segment) return;
    const { error } = await client
      .from('segments')
      .upsert(segmentToRow(op.id, segment), { onConflict: 'session_id,seq' });
    if (error) throw error;
  }

  async function drainQueue({ authenticated = false } = {}) {
    if (!client) return store.pendingOps().length;
    if (activeDrain) return activeDrain;

    activeDrain = (async () => {
      if (!authenticated) {
        const { data, error } = await client.auth.getSession();
        if (error || !data.session) {
          onState({ pending: store.pendingOps().length, error: error ?? null, signedIn: false });
          return store.pendingOps().length;
        }
      }

      let pushError = null;
      const pending = await store.drain(async (op, st) => {
        try {
          await pushOp(op, st);
        } catch (error) {
          if (isPermanentError(error)) {
            console.error('sync: 동기화 불가 op 폐기 (로컬 데이터는 유지)', op, error);
            return;                        // op 소비 — 뒤의 op들이 계속 나가게 한다
          }
          pushError = error;
          throw error;                     // 일시 오류: op 복원 + 중단, 다음 drain에서 재시도
        }
      });
      onState({ pending, error: pushError, signedIn: true });
      return pending;
    })();

    try {
      return await activeDrain;
    } finally {
      activeDrain = null;
    }
  }

  function queueChanged() {
    if (!client) return;
    clearTimeout(drainTimer);
    drainTimer = setTimeout(() => {
      drainQueue().catch(error => console.error('sync: drain 실패', error));
    }, debounceMs);
  }

  async function fullSync() {
    if (!client) return false;
    clearTimeout(drainTimer);

    const { data: authData, error: authError } = await client.auth.getSession();
    if (authError || !authData.session) {
      onState({ pending: store.pendingOps().length, error: authError ?? null, signedIn: false });
      return false;
    }

    await drainQueue({ authenticated: true });
    const { data, error } = await client.from('sessions').select('*');
    if (error) {
      onState({ pending: store.pendingOps().length, error, signedIn: true });
      return false;
    }

    const remote = (data ?? []).map(sessionFromRow);
    store.markRemoteSessions(remote.map(session => session.id));
    store.mergeRemoteSessions(remote);
    onSessionsChanged();
    return true;
  }

  // 로컬 캐시 뒤(seq 커서)의 새 세그먼트만 페치해 덧붙인다.
  // — 다른 기기가 추가한 세그먼트 반영, 1000행 캡 페이지네이션, 빈 캐시 재페치 문제를 함께 해결.
  async function hydrateSegments(id) {
    if (!client) return false;

    const { data: authData, error: authError } = await client.auth.getSession();
    if (authError || !authData.session) {
      onState({ pending: store.pendingOps().length, error: authError ?? null, signedIn: false });
      return false;
    }

    const local = store.getSegments(id);
    let after = local.length ? local[local.length - 1].seq : 0;
    const fetched = [];
    for (;;) {
      const { data, error } = await client
        .from('segments')
        .select('*')
        .eq('session_id', id)
        .gt('seq', after)
        .order('seq')
        .limit(PAGE);
      if (error) {
        onState({ pending: store.pendingOps().length, error, signedIn: true });
        return false;
      }
      const rows = data ?? [];
      fetched.push(...rows);
      if (rows.length < PAGE) break;
      after = rows[rows.length - 1].seq;
    }
    if (fetched.length || !store.hasSegments(id))
      store.setSegments(id, [...local, ...fetched.map(segmentFromRow)]);
    return true;
  }

  // 녹음 파트 업로드 — write-behind 큐를 타지 않는다 (Blob은 localStorage에 못 담음).
  // 실패 시 throw — 호출자(app)가 Blob을 들고 RETRY UPLOAD를 노출한다.
  async function uploadRecording({ sessionId, seq, startMs, durMs, blob, mime, ext }) {
    const { data: authData, error: authError } = await client.auth.getSession();
    if (authError || !authData.session) throw authError ?? new Error('NOT_SIGNED_IN');
    const path = `${authData.session.user.id}/${sessionId}/${seq}.${ext}`;
    const { error: upErr } = await client.storage.from('recordings')
      .upload(path, blob, { contentType: mime, upsert: true }); // upsert: 재시도 안전
    if (upErr) throw upErr;
    const { error: insErr } = await client.from('recordings')
      .upsert({ session_id: sessionId, seq, start_ms: startMs, dur_ms: durMs, path },
              { onConflict: 'session_id,seq' });
    if (insErr) throw insErr;
    return true;
  }

  async function listRecordings(sessionId) {
    if (!client) return [];
    const { data, error } = await client.from('recordings')
      .select('*').eq('session_id', sessionId).order('seq');
    if (error || !data?.length) return [];
    const parts = data.map(recordingFromRow);
    const { data: signed, error: sigErr } = await client.storage.from('recordings')
      .createSignedUrls(parts.map(p => p.path), 3600);
    if (sigErr) return [];
    return parts.map((p, i) => ({ ...p, url: signed[i]?.signedUrl ?? null }));
  }

  function dispose() {
    clearTimeout(drainTimer);
    window.removeEventListener('online', handleOnline);
  }

  function handleOnline() {
    fullSync().catch(error => onState({ pending: store.pendingOps().length, error, signedIn: true }));
  }

  if (client) window.addEventListener('online', handleOnline);
  return { queueChanged, fullSync, hydrateSegments, uploadRecording, listRecordings, flush: drainQueue, dispose };
}
