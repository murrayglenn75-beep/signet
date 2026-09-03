create or replace function public.get_trust_ledger_window(
  p_limit integer default 50
)
returns table (
  seq bigint,
  event_id uuid,
  stream_type text,
  stream_id uuid,
  event_type text,
  actor_type text,
  actor_id text,
  occurred_at timestamptz,
  prev_hash text,
  hash text
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_org_id uuid;
  v_limit integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  v_org_id := nullif(auth.jwt() ->> 'org_id', '')::uuid;

  if v_org_id is null then
    raise exception 'org_id claim required';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  return query
  select
    e.seq,
    e.event_id,
    e.stream_type,
    e.stream_id,
    e.event_type,
    e.actor_type,
    e.actor_id,
    e.occurred_at,
    e.prev_hash,
    e.hash
  from public.events e
  where e.org_id = v_org_id
  order by e.seq desc
  limit v_limit;
end;
$$;

revoke all on function public.get_trust_ledger_window(integer) from public;
revoke all on function public.get_trust_ledger_window(integer) from anon;
grant execute on function public.get_trust_ledger_window(integer) to authenticated;