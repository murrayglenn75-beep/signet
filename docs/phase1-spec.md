# Signet — Phase 1 Spec: Verified Operations Kernel

**Scope:** Event-sourced core, hash-chained Trust Ledger, signal projections, one enforcement predicate (Change-Order Gate).
**Timebox:** 2 weeks. **Stack:** Supabase (Postgres 15+), Next.js/TypeScript, existing Signalworks UI.
**Non-goals (Phase 1):** SMT/formal verification, multi-tenant sharding, MCP server (Phase 3), external QTSP timestamping, blockchain anything.

---

## 1. Assumptions & Constraints

- Signet currently holds mutable rows (engagements, budget lines, time entries, invoices) in Supabase.
- Single-tenant per Supabase project for now; RLS by `org_id` is scaffolded but not the Phase 1 focus.
- AI (Claude API) is already narration-only. Phase 1 makes that boundary *structural*, not conventional.
- All writes go through Postgres functions (RPC). The Next.js app never `INSERT`s into projections directly.

**Core invariant:** the event log is the only writable surface. Everything else is a projection.

---

## 2. High-Level Design

```
                    ┌──────────────────────────────┐
  UI / API ────────▶│  append_event() RPC           │  ← ONLY write path
                    │  (validates + enforces gates)  │
                    └──────────┬───────────────────┘
                               ▼
                    ┌──────────────────────────────┐
                    │  events (append-only,         │
                    │  hash-chained by trigger)     │
                    └──────────┬───────────────────┘
                               ▼  (trigger fan-out)
             ┌─────────────────┼──────────────────┐
             ▼                 ▼                  ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
     │ projections  │  │ signals      │  │ trust_ledger view │
     │ (current     │  │ (STALE, OVER │  │ (chain-verified   │
     │  state)      │  │  BUDGET, ...)│  │  provenance)      │
     └──────────────┘  └──────┬───────┘  └──────────────────┘
                              ▼
                    ┌──────────────────────────────┐
                    │  AI narration (read-only:     │
                    │  signals + ledger, never raw) │
                    └──────────────────────────────┘
```

---

## 3. Data Model

### 3.1 `events` — the kernel

```sql
create table events (
  seq          bigint generated always as identity primary key,
  event_id     uuid not null default gen_random_uuid(),
  org_id       uuid not null,
  stream_type  text not null,          -- 'engagement' | 'budget_line' | 'time_entry' | 'invoice' | 'change_order'
  stream_id    uuid not null,          -- the entity this event belongs to
  event_type   text not null,          -- e.g. 'time_entry.logged', 'change_order.approved'
  payload      jsonb not null,
  actor_type   text not null check (actor_type in ('human','system','ai')),
  actor_id     text not null,          -- auth.uid() for humans; model string for AI
  occurred_at  timestamptz not null default now(),
  prev_hash    text not null,          -- hash of previous event (per org chain)
  hash         text not null           -- SHA-256 over canonical content
);

create index on events (org_id, stream_type, stream_id, seq);
create index on events (org_id, event_type, occurred_at);
```

**Hardening (do all three):**

```sql
-- 1. No update/delete, ever. Applies to table owner too via trigger.
create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'events is append-only';
end $$;

create trigger events_no_update before update or delete on events
  for each row execute function forbid_mutation();

-- 2. Revoke direct INSERT from app roles; only the RPC (security definer) writes.
revoke insert, update, delete on events from authenticated, anon;

-- 3. RLS: read own org only.
alter table events enable row level security;
create policy events_read on events for select
  using (org_id = (auth.jwt() ->> 'org_id')::uuid);
```

### 3.2 Hash chain trigger

Canonical serialization matters more than the hash function. Fix the field order, hash the concatenation.

```sql
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
    new.payload::text || '|' ||       -- jsonb::text is canonical in PG (sorted keys)
    new.actor_type || '|' ||
    new.actor_id || '|' ||
    to_char(new.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  , 'sha256'), 'hex');
  return new;
end $$;

create trigger events_chain before insert on events
  for each row execute function chain_event();
```

Notes:
- `for update` on the last row serializes concurrent inserts per org. At Signet's write volume this is fine; revisit with per-org advisory locks (`pg_advisory_xact_lock(hashtext(org_id::text))`) if you ever see contention.
- Requires `pgcrypto` (enabled by default on Supabase): `create extension if not exists pgcrypto;`
- **Chain verification function** (run nightly + on demand from the Trust Ledger UI):

```sql
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
```

### 3.3 Event taxonomy (Phase 1 minimum)

| stream_type | event_type | payload (keys) |
|---|---|---|
| engagement | engagement.created | name, client, fee_model ('fixed'\|'tm'\|'retainer'), fee_amount, planned_cost, start, end |
| engagement | engagement.status_changed | status |
| budget_line | budget_line.created | engagement_id, label, budget_hours, rate, cost_rate |
| time_entry | time_entry.logged | engagement_id, budget_line_id, hours, person, cost_rate, billable, note |
| change_order | change_order.requested | engagement_id, description, est_hours, est_fee |
| change_order | change_order.decided | change_order_id, decision ('approve'\|'absorb'\|'decline'), approved_hours, approved_fee |
| invoice | invoice.drafted / invoice.sent / invoice.paid | engagement_id, amount, lines[] |

Every past state question ("what did we believe the margin was on May 3?") becomes a replay query. Don't build time-travel UI in Phase 1 — just don't foreclose it.

---

## 4. Projections

Materialized as ordinary tables, rebuilt by trigger fan-out on `events` insert (synchronous is fine at this scale). Each projection row carries `last_event_seq` for provenance.

```sql
create table proj_engagements (
  stream_id uuid primary key,
  org_id uuid not null,
  name text, client text, fee_model text, fee_amount numeric,
  planned_cost numeric, status text,
  hours_logged numeric default 0,
  cost_accrued numeric default 0,
  unbilled_amount numeric default 0,
  last_activity_at timestamptz,
  last_event_seq bigint not null
);
```

Rebuild-from-zero function is **mandatory** (this is your credibility demo — "delete the projection, replay the log, identical state"):

```sql
create or replace function rebuild_projections(p_org uuid) returns void ...
-- truncate proj_* for org, iterate events in seq order, apply same reducers.
```

Keep reducers in one place: a single `apply_event(event)` plpgsql function called by both the live trigger and the rebuild loop. Divergence between live and replay paths is the classic event-sourcing bug; one code path eliminates it.

---

## 5. Signal Engine

Signals are **derived rows, recomputed deterministically**, each carrying the event seqs that justify it. Table, not view, so signals can be referenced by seq in the ledger and by the AI layer.

```sql
create table signals (
  signal_id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  stream_type text not null,
  stream_id uuid not null,
  code text not null,            -- 'OVER_BUDGET' | 'SCOPE_DRIFT' | 'STALE' | 'UNBILLED' | 'UNRECONCILED'
  severity text not null check (severity in ('amber','red')),
  detail jsonb not null,         -- computed numbers: {burn_pct: 118, budget_hours: 40, logged: 47.2}
  evidence_seqs bigint[] not null,  -- events that produced this signal
  computed_at timestamptz not null default now(),
  cleared_at timestamptz          -- null = active
);
create unique index on signals (org_id, stream_type, stream_id, code) where cleared_at is null;
```

**Phase 1 signal definitions (exact thresholds — no vibes):**

| Code | Rule | Severity |
|---|---|---|
| OVER_BUDGET | budget_line: `hours_logged > budget_hours` → red; `> 0.85 * budget_hours` → amber | amber/red |
| SCOPE_DRIFT | engagement (fixed-fee): `hours_logged > 1.10 * planned_hours` with no `change_order.decided(approve)` covering the delta | red |
| STALE | engagement active and `now() - last_activity_at > 14 days` | amber |
| UNBILLED | `unbilled_amount > 0` and no `invoice.drafted` in 30 days | amber; red > 60 days |
| UNRECONCILED | any invoice whose lines don't sum to underlying logged/approved amounts | red |

Recompute on relevant event insert (trigger calls `recompute_signals(stream_type, stream_id)`); full sweep nightly via `pg_cron` for time-decay signals (STALE, UNBILLED).

---

## 6. Enforcement: the Change-Order Gate

The one Phase 1 predicate. AgentSpec-shaped: **(trigger event, predicates, enforcement).**

- **Trigger:** `time_entry.logged` where engagement is fixed-fee.
- **Predicate:** would this entry push `hours_logged` past `1.10 × planned_hours` for the engagement, net of approved change-order hours?
- **Enforcement:** the `append_event` RPC **rejects** the event with a structured error `{gate: 'CHANGE_ORDER', deficit_hours: n}` unless the payload carries `override: {change_order_id}` referencing an approved CO — or the caller first records `change_order.decided(absorb)` (an explicit, logged decision to eat the cost).

Key design point: **absorbing scope is allowed — silently absorbing it is not.** The gate doesn't stop work; it forces the decision to become an event. That's the honest version of enforcement for a services firm, it demos in ten seconds, and it directly attacks the largest named leakage source (informal scope absorption).

Implementation lives inside `append_event()` (security definer), so it cannot be bypassed by any client, including the AI layer:

```sql
create or replace function append_event(
  p_stream_type text, p_stream_id uuid, p_event_type text,
  p_payload jsonb, p_actor_type text default 'human'
) returns bigint
language plpgsql security definer as $$
begin
  -- 1. schema-validate payload per event_type (reject unknown types)
  -- 2. run gates (Phase 1: change_order_gate)
  -- 3. insert into events (chain trigger fires)
  -- 4. apply_event → projections; recompute_signals
  -- 5. return seq
end $$;
```

---

## 7. AI Boundary

Phase 1 rule, enforced by grant structure: the AI narration layer (existing Claude API calls) is a **client of two read-only views** — `signals` (active) and `trust_ledger`. It has no access to `proj_*` or raw `events`. Create a dedicated Postgres role / Supabase service key scoped to exactly those two views.

Every AI-generated narrative is itself recorded: `ai.narrated` event with payload `{signal_ids[], model, prompt_hash, output_hash}`. The narration becomes part of the chain it narrates — this is the Trust Ledger's closing move.

---

## 8. Trust Ledger UI (Signalworks / Instrument Panel)

One new page + one widget:

1. **Ledger view:** reverse-chron event stream; each row shows seq, event_type, actor badge (human/system/AI), truncated hash, chain-status pip (green = verified). "Verify chain" button calls `verify_chain()` and renders the first broken seq if any. IBM Plex Mono for hashes/seqs; Signal Amber only on the verify action.
2. **Signal provenance drawer:** tapping any signal flag opens its `evidence_seqs` — the exact events that produced it. This is the thirty-second demo: flag → evidence → hash → verified.

---

## 9. Migration from current Signet

1. Freeze writes. Export current rows.
2. Synthesize a genesis event per entity (`*.imported` event types carrying full current state, `actor_type='system'`, `actor_id='migration-v1'`).
3. Rebuild projections from the log; diff against the export — must be byte-identical.
4. Cut the app's write paths over to `append_event` RPC. Delete all other write code.

---

## 10. Acceptance Tests (definition of done)

1. `update events set ...` and `delete from events` fail for every role including service.
2. Manually corrupting one payload via superuser makes `verify_chain()` flag that seq and every subsequent row.
3. `rebuild_projections()` after 500 mixed events yields projections identical to live tables (hash the row sets).
4. Two concurrent `append_event` calls for the same org never produce duplicate `prev_hash` (chain is linear).
5. Fixed-fee engagement at 110%+ burn rejects a plain `time_entry.logged`; same entry succeeds with an approved CO reference or after an explicit `absorb` decision — and both paths are visible in the ledger.
6. AI role can `select` from `signals` and `trust_ledger` only; any other table errors.
7. Signal drawer for an OVER_BUDGET flag lists evidence events whose hours sum to the computed burn.

---

## 11. Trade-offs (explicit)

- **Synchronous projections** over async workers: simpler, transactionally consistent; costs write latency (irrelevant at this volume). Revisit if event rate exceeds ~50/sec.
- **Per-org row lock for chaining** over advisory locks: simplest correct thing; known serialization point.
- **Postgres-only ledger** over external timestamping (QTSP/eIDAS-style): tamper-*evident*, not tamper-*proof* against a malicious DBA. Honest claim for Phase 1; anchor a daily chain-head hash to an external write-once store (even a Git commit) in Phase 2 if a client demands stronger custody.
- **Gates in the RPC** over Postgres constraints: gates need cross-row logic and structured errors; constraints can't express them cleanly.

**Revisit as it grows:** advisory-lock chaining, async projection workers, per-tenant chain heads table (O(1) last-hash lookup), snapshot events every N for fast replay.
