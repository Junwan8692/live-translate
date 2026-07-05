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
