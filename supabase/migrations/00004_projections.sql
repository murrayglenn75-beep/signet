-- ============================================================
-- 00004: projections. SKELETON — Claude Code implements reducers.
-- Upholds invariants 1, 3. See spec §4 and event taxonomy §3.3.
-- RULES:
--   * apply_event(e events) is the ONLY reducer. The live trigger and
--     rebuild_projections() must both call it. One code path.
--   * Every projection row carries last_event_seq.
--   * Projections are truncate-and-replay rebuildable at any time.
-- ============================================================

create table proj_engagements (
  stream_id uuid primary key,
  org_id uuid not null,
  name text, client text,
  fee_model text check (fee_model in ('fixed','tm','retainer')),
  fee_amount numeric,
  planned_cost numeric,
  planned_hours numeric,
  status text not null default 'active',
  hours_logged numeric not null default 0,
  cost_accrued numeric not null default 0,
  unbilled_amount numeric not null default 0,
  approved_co_hours numeric not null default 0,
  last_activity_at timestamptz,
  last_event_seq bigint not null
);

create table proj_budget_lines (
  stream_id uuid primary key,
  org_id uuid not null,
  engagement_id uuid not null,
  label text,
  budget_hours numeric,
  rate numeric,
  cost_rate numeric,
  hours_logged numeric not null default 0,
  last_event_seq bigint not null
);

-- TODO(claude-code): proj_invoices, proj_change_orders (see spec §3.3)

-- TODO(claude-code): implement the single reducer.
-- create or replace function apply_event(e events) returns void ...

-- TODO(claude-code): live fan-out trigger on events insert → apply_event(new).

-- TODO(claude-code): rebuild_projections(p_org uuid) — truncate org rows in
-- all proj_* tables, iterate events in seq order, call apply_event for each.
-- MUST produce byte-identical state to the live path (acceptance test 3).

revoke insert, update, delete on proj_engagements, proj_budget_lines
  from authenticated, anon;
