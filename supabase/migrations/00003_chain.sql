-- ============================================================
-- 00003: hash chain + verification.
-- Upholds invariant 2. FULLY SPECIFIED — implement exactly as written.
-- Canonical serialization order is part of the contract; never reorder.
-- ============================================================

create or replace function chain_event() returns trigger
language plpgsql as $$
declare
  last_hash text;
begin
  select hash into last_hash
  from events
  where org_id = new.org_id
  order by seq desc
  limit 1
  for update;                        -- serialize writers per org

  new.prev_hash := coalesce(last_hash, 'GENESIS');
  new.hash := encode(digest(
    new.prev_hash || '|' ||
    new.event_id::text || '|' ||
    new.org_id::text || '|' ||
    new.stream_type || '|' ||
    new.stream_id::text || '|' ||
    new.event_type || '|' ||
    new.payload::text || '|' ||
    new.actor_type || '|' ||
    new.actor_id || '|' ||
    to_char(new.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  , 'sha256'), 'hex');
  return new;
end $$;

create trigger events_chain before insert on events
  for each row execute function chain_event();

-- Verify the whole chain for an org. Returns one row per event with ok flag.
create or replace function verify_chain(p_org uuid)
returns table (seq bigint, ok boolean) language sql stable as $$
  select e.seq,
         e.hash = encode(digest(
           e.prev_hash || '|' || e.event_id::text || '|' || e.org_id::text || '|' ||
           e.stream_type || '|' || e.stream_id::text || '|' || e.event_type || '|' ||
           e.payload::text || '|' || e.actor_type || '|' || e.actor_id || '|' ||
           to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
         ,'sha256'),'hex')
         and e.prev_hash = coalesce(lag(e.hash) over (order by e.seq), 'GENESIS')
  from events e
  where e.org_id = p_org
  order by e.seq;
$$;
