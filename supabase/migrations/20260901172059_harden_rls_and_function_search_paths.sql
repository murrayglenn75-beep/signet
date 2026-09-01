-- ============================================================
-- Signet DB hardening
-- 1. Optimize org-scoped RLS JWT evaluation.
-- 2. Pin search_path for security-sensitive public functions.
-- ============================================================

-- ------------------------------------------------------------
-- RLS performance hardening
-- ------------------------------------------------------------

drop policy if exists events_read on public.events;
create policy events_read
on public.events
for select
to authenticated
using (
  org_id = (((select auth.jwt()) ->> 'org_id')::uuid)
);

drop policy if exists signals_read on public.signals;
create policy signals_read
on public.signals
for select
to authenticated
using (
  org_id = (((select auth.jwt()) ->> 'org_id')::uuid)
);

drop policy if exists proj_engagements_read on public.proj_engagements;
create policy proj_engagements_read
on public.proj_engagements
for select
to authenticated
using (
  org_id = (((select auth.jwt()) ->> 'org_id')::uuid)
);

drop policy if exists proj_budget_lines_read on public.proj_budget_lines;
create policy proj_budget_lines_read
on public.proj_budget_lines
for select
to authenticated
using (
  org_id = (((select auth.jwt()) ->> 'org_id')::uuid)
);

drop policy if exists proj_invoices_read on public.proj_invoices;
create policy proj_invoices_read
on public.proj_invoices
for select
to authenticated
using (
  org_id = (((select auth.jwt()) ->> 'org_id')::uuid)
);

drop policy if exists proj_change_orders_read on public.proj_change_orders;
create policy proj_change_orders_read
on public.proj_change_orders
for select
to authenticated
using (
  org_id = (((select auth.jwt()) ->> 'org_id')::uuid)
);

-- ------------------------------------------------------------
-- Function search_path hardening
-- Keep public available because existing functions use
-- unqualified public objects.
-- ------------------------------------------------------------

alter function public.chain_event()
  set search_path = public, pg_catalog;

alter function public.verify_chain(uuid)
  set search_path = public, pg_catalog;

alter function public.forbid_mutation()
  set search_path = public, pg_catalog;

alter function public.validate_event_payload(text, jsonb)
  set search_path = public, pg_catalog;

alter function public.apply_event(public.events)
  set search_path = public, pg_catalog;

alter function public.fanout_apply_event()
  set search_path = public, pg_catalog;

alter function public.rebuild_projections(uuid)
  set search_path = public, pg_catalog;

alter function public.upsert_signal(
  uuid,
  text,
  uuid,
  text,
  text,
  jsonb,
  bigint[]
)
  set search_path = public, pg_catalog;

alter function public.clear_signal(uuid, text, uuid, text)
  set search_path = public, pg_catalog;

alter function public.recompute_signals(text, uuid)
  set search_path = public, pg_catalog;

alter function public.fanout_recompute_signals()
  set search_path = public, pg_catalog;

alter function public.sweep_time_decay_signals()
  set search_path = public, pg_catalog;

alter function public.check_change_order_gate(uuid, numeric, uuid)
  set search_path = public, pg_catalog;

alter function public.custom_access_token_hook(jsonb)
  set search_path = public, pg_catalog;
