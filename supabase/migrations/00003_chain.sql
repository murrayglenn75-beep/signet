-- ============================================================
-- 00003: hash chain + verification.
-- Upholds invariant 2. Canonical serialization order is part of the
-- contract; never reorder.
--
-- History — three acts to get concurrency right:
--
-- Act 1 (original): "FULLY SPECIFIED — implement exactly as written",
-- with `select ... order by seq desc limit 1 for update` as the sole
-- concurrency guard. Race: when writer B blocks on writer A's row lock,
-- Postgres unblocks B by re-checking that SAME row rather than re-running
-- the query — and since events rows are never updated, B just gets the
-- stale hash A already consumed as prev_hash. Two children then claim the
-- same parent, forking the chain (caught by acceptance test 4).
--
-- Act 2: a per-org `pg_advisory_xact_lock` taken as the first statement
-- in this trigger, per spec §11's noted trade-off. Still forks under
-- load: this is a BEFORE INSERT trigger, so it runs inside the snapshot
-- of the INSERT that fired it — a snapshot fixed *before* the trigger
-- body runs. Blocking mid-trigger on the advisory lock serializes
-- correctly, but waking up does not refresh that snapshot, so the
-- following `select` can still miss a write another session just
-- committed while this one was queued. Verified empirically: 5/5 trials
-- reproduced duplicate prev_hash values with the lock in this position.
--
-- Act 3 (current): `chain_heads(org_id, hash)` below — a genuinely-
-- mutated row per org (spec §11's "per-tenant chain head table" revisit
-- item, pulled forward). `select ... for update` against a row that
-- actually gets `update`d makes Postgres re-fetch the latest committed
-- version on wake-up (EvalPlanQual) — unlike the append-only `events`
-- table, where the locked row never changes and Act 1/2's snapshot
-- problem applies. Per-org because the lock is a real row keyed by
-- org_id, not a hashed key, so it also can't collide across orgs the way
-- hashtext() could. Verified empirically: 5/5 trials, zero duplicate
-- prev_hash values.
--
-- chain_heads is a serialization device and cache, not part of the
-- verified surface: verify_chain() below still validates purely from
-- events, and chain_heads is fully rebuildable from events at any time
-- (it holds nothing verify_chain or the Trust Ledger depend on).
--
-- One more gap chain_heads exposed: events.seq (00002, `generated always
-- as identity`) is assigned via nextval() while Postgres builds the row's
-- default values — which happens *before* this BEFORE INSERT trigger
-- runs, i.e. before the chain_heads lock is even requested. Under
-- concurrency a transaction can grab a lower seq but lose the race for
-- the lock, landing later in the actual (unforked, correct) hash chain
-- than a transaction holding a higher seq. verify_chain() assumes seq
-- order == chain order (`lag(hash) over (order by seq)`), so this
-- produced false positives — real chain, wrong-looking verify_chain().
-- Fixed below by re-assigning new.seq from the identity sequence AFTER
-- the chain_heads lock is held, so seq order is pinned to true causal
-- order for the org. A BEFORE ROW trigger may legally override even a
-- `generated always as identity` column's NEW value — that restriction
-- only blocks explicit client-supplied values in the INSERT statement
-- text, not later trigger-side reassignment — so 00002 stays untouched.
-- ============================================================

create table chain_heads (
  org_id uuid primary key,
  hash text not null
);

revoke insert, update, delete on chain_heads from authenticated, anon;

create or replace function chain_event() returns trigger
language plpgsql as $$
declare
  last_hash text;
begin
  insert into chain_heads (org_id, hash) values (new.org_id, 'GENESIS')
    on conflict (org_id) do nothing;

  select hash into last_hash
  from chain_heads
  where org_id = new.org_id
  for update;                        -- blocks writers for this org; wake-up
                                      -- re-fetches since this row IS updated below

  -- Pin seq to true causal order (see History note): the identity default
  -- already assigned a value before this trigger ran; re-assign it here,
  -- now that we hold the per-org lock, so seq order matches chain order.
  new.seq := nextval(pg_get_serial_sequence('events', 'seq'));

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

  update chain_heads set hash = new.hash where org_id = new.org_id;

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
