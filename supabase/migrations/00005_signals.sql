-- ============================================================
-- 00005: signal engine. SKELETON — Claude Code implements recompute.
-- Upholds invariant 5. Definitions and exact thresholds: spec §5.
-- Signals are deterministic. evidence_seqs must contain the event seqs
-- that justify the flag (acceptance test 7).
-- ============================================================

create table signals (
  signal_id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  stream_type text not null,
  stream_id uuid not null,
  code text not null check (code in
    ('OVER_BUDGET','SCOPE_DRIFT','STALE','UNBILLED','UNRECONCILED')),
  severity text not null check (severity in ('amber','red')),
  detail jsonb not null,
  evidence_seqs bigint[] not null,
  computed_at timestamptz not null default now(),
  cleared_at timestamptz
);
create unique index signals_active_uniq
  on signals (org_id, stream_type, stream_id, code) where cleared_at is null;

-- TODO(claude-code): recompute_signals(p_stream_type text, p_stream_id uuid)
-- implementing the five rules in spec §5 with exact thresholds:
--   OVER_BUDGET  budget_line hours_logged > budget_hours (red) / > 0.85x (amber)
--   SCOPE_DRIFT  fixed-fee engagement hours_logged > 1.10 * planned_hours
--                net of approved CO hours (red)
--   STALE        active engagement, no activity > 14 days (amber)
--   UNBILLED     unbilled_amount > 0 with no invoice.drafted in 30d (amber) / 60d (red)
--   UNRECONCILED invoice lines don't sum to underlying amounts (red)
-- Called from the events fan-out trigger; nightly sweep for time-decay
-- signals via pg_cron is Phase 1.5 — leave a stub.

revoke insert, update, delete on signals from authenticated, anon;
