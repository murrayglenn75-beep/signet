-- Replace the owner-privileged trust_ledger view with explicit,
-- least-privilege SECURITY DEFINER read boundaries.

-- The browser must never read the owner-privileged view directly.
revoke all on public.trust_ledger from public;
revoke all on public.trust_ledger from anon;
revoke all on public.trust_ledger from authenticated;
revoke all on public.trust_ledger from ai_narrator;

drop view public.trust_ledger;


-- ------------------------------------------------------------
-- Browser boundary 1:
-- Latest ledger head for the authenticated caller's organisation.
-- ------------------------------------------------------------
create or replace function public.get_trust_ledger_head()
returns table (
  seq bigint,
  hash text
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  v_org_id := nullif(auth.jwt() ->> 'org_id', '')::uuid;

  if v_org_id is null then
    raise exception 'org_id claim required';
  end if;

  return query
  select e.seq, e.hash
  from public.events e
  where e.org_id = v_org_id
  order by e.seq desc
  limit 1;
end;
$$;

revoke all on function public.get_trust_ledger_head() from public;
revoke all on function public.get_trust_ledger_head() from anon;
grant execute on function public.get_trust_ledger_head() to authenticated;


-- ------------------------------------------------------------
-- Browser boundary 2:
-- Resolve event types only for explicitly requested evidence seqs
-- belonging to the authenticated caller's organisation.
-- ------------------------------------------------------------
create or replace function public.get_trust_ledger_evidence(
  p_seqs bigint[]
)
returns table (
  seq bigint,
  event_type text
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  v_org_id := nullif(auth.jwt() ->> 'org_id', '')::uuid;

  if v_org_id is null then
    raise exception 'org_id claim required';
  end if;

  if p_seqs is null or cardinality(p_seqs) = 0 then
    return;
  end if;

  return query
  select e.seq, e.event_type
  from public.events e
  where e.org_id = v_org_id
    and e.seq = any(p_seqs);
end;
$$;

revoke all on function public.get_trust_ledger_evidence(bigint[]) from public;
revoke all on function public.get_trust_ledger_evidence(bigint[]) from anon;
grant execute on function public.get_trust_ledger_evidence(bigint[]) to authenticated;


-- ------------------------------------------------------------
-- AI boundary:
-- AI may inspect ledger metadata but never event payloads and never
-- receive direct SELECT privileges on public.events.
-- ------------------------------------------------------------
create or replace function public.get_trust_ledger_for_ai()
returns table (
  seq bigint,
  event_id uuid,
  org_id uuid,
  stream_type text,
  stream_id uuid,
  event_type text,
  actor_type text,
  actor_id text,
  occurred_at timestamptz,
  prev_hash text,
  hash text
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select
    e.seq,
    e.event_id,
    e.org_id,
    e.stream_type,
    e.stream_id,
    e.event_type,
    e.actor_type,
    e.actor_id,
    e.occurred_at,
    e.prev_hash,
    e.hash
  from public.events e
  order by e.seq;
$$;

revoke all on function public.get_trust_ledger_for_ai() from public;
revoke all on function public.get_trust_ledger_for_ai() from anon;
revoke all on function public.get_trust_ledger_for_ai() from authenticated;
grant execute on function public.get_trust_ledger_for_ai() to ai_narrator;
