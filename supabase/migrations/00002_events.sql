-- ============================================================
-- 00002: events — the kernel. Append-only, hardened.
-- Upholds invariants 1, 2, 7 (CLAUDE.md).
-- FULLY SPECIFIED — implement exactly as written.
-- ============================================================

create table events (
  seq          bigint generated always as identity primary key,
  event_id     uuid not null default gen_random_uuid(),
  org_id       uuid not null,
  stream_type  text not null check (stream_type in
                 ('engagement','budget_line','time_entry','invoice','change_order','ai')),
  stream_id    uuid not null,
  event_type   text not null,
  payload      jsonb not null,
  actor_type   text not null check (actor_type in ('human','system','ai')),
  actor_id     text not null,
  occurred_at  timestamptz not null default now(),
  prev_hash    text not null,
  hash         text not null
);

create index events_stream_idx on events (org_id, stream_type, stream_id, seq);
create index events_type_time_idx on events (org_id, event_type, occurred_at);

-- Hardening 1: no mutation, ever (fires for table owner too).
create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'events is append-only';
end $$;

create trigger events_no_update
  before update or delete on events
  for each row execute function forbid_mutation();

-- Hardening 2: app roles cannot write directly; only append_event() (security definer).
revoke insert, update, delete on events from authenticated, anon;

-- Hardening 3: RLS — read own org only.
alter table events enable row level security;
create policy events_read on events for select
  using (org_id = (auth.jwt() ->> 'org_id')::uuid);
