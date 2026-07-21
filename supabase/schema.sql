-- Relay: Google OAuth(Supabase Auth) 사용자별 세션/세그먼트 저장소.
-- Supabase Dashboard > SQL Editor에서 프로젝트당 한 번 실행한다.

create table public.sessions (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text,
  target_lang text not null default 'ko',
  source      text not null default 'mic'
              check (source in ('mic', 'tab')),
  status      text not null default 'ready'
              check (status in ('ready', 'listening', 'paused', 'ended')),
  elapsed_ms  integer not null default 0 check (elapsed_ms >= 0),
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,
  updated_at  timestamptz not null default now()
);

create table public.segments (
  session_id      uuid not null references public.sessions on delete cascade,
  seq             integer not null check (seq > 0),
  ts_ms           integer not null check (ts_ms >= 0),
  time_label      text not null,
  original_text   text not null default '',
  translated_text text not null default '',
  src_lang        text,
  created_at      timestamptz not null default now(),
  primary key (session_id, seq)
);

create index sessions_user_created
  on public.sessions (user_id, created_at desc);

alter table public.sessions enable row level security;
alter table public.segments enable row level security;

create policy "users manage own sessions"
  on public.sessions
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users manage segments in own sessions"
  on public.segments
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.sessions s
      where s.id = session_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.sessions s
      where s.id = session_id
        and s.user_id = auth.uid()
    )
  );

revoke all on table public.sessions from anon;
revoke all on table public.segments from anon;
revoke all on table public.sessions from authenticated;
revoke all on table public.segments from authenticated;
grant select, insert, update, delete on table public.sessions to authenticated;
grant select, insert, update, delete on table public.segments to authenticated;

-- Gemini API 키 배포용: allowed_emails 명단에 있는 로그인 사용자만 app_secrets를 읽는다.
-- 명단·키 관리는 대시보드에서만 (일반 사용자용 정책 없음).
--   insert into public.allowed_emails values ('user@example.com');
--   insert into public.app_secrets values ('gemini_key', '<키>');
create table public.allowed_emails (email text primary key);
alter table public.allowed_emails enable row level security;

-- app_secrets 정책의 서브쿼리도 조회자 RLS를 적용받으므로, 자기 행은 보여야 명단 확인이 된다.
create policy "users see own allowlist row"
  on public.allowed_emails
  for select
  to authenticated
  using (email = (auth.jwt() ->> 'email'));

create table public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on table public.app_secrets from anon, authenticated;
grant select on table public.app_secrets to authenticated;

create policy "allowlisted users read secrets"
  on public.app_secrets
  for select
  to authenticated
  using (exists (select 1 from public.allowed_emails a
                 where a.email = (auth.jwt() ->> 'email')));

-- ---- 세션 녹음 (WS1) ----
alter table public.sessions add column mode text not null default 'live'
  check (mode in ('live', 'rec'));

create table public.recordings (
  session_id uuid not null references public.sessions on delete cascade,
  seq        integer not null check (seq > 0),
  start_ms   integer not null check (start_ms >= 0),
  dur_ms     integer not null check (dur_ms >= 0),
  path       text not null,
  created_at timestamptz not null default now(),
  primary key (session_id, seq)
);

alter table public.recordings enable row level security;
create policy "users manage recordings in own sessions"
  on public.recordings for all to authenticated
  using (exists (select 1 from public.sessions s
                 where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.sessions s
                      where s.id = session_id and s.user_id = auth.uid()));
revoke all on table public.recordings from anon;
grant select, insert, update, delete on table public.recordings to authenticated;

-- Storage: private 버킷, 경로 1번째 폴더 = 본인 uid 인 파일만 접근
insert into storage.buckets (id, name, public) values ('recordings', 'recordings', false);
create policy "own recordings select" on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own recordings insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own recordings delete" on storage.objects for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
