-- ============================================================
-- 00005: signal engine. Upholds invariant 5. Definitions and exact
-- thresholds: spec §5. Signals are deterministic derived rows; each
-- carries the event seqs that justify it (acceptance test 7).
--
-- Determinism boundary — two different families of signal:
--   * Event-triggered-only, correctly clock-free: OVER_BUDGET,
--     SCOPE_DRIFT, UNRECONCILED. Their truth value can only change when
--     a relevant event arrives (hours logged, a CO decided, an invoice
--     drafted) — recomputing on insert, and never touching now(), is
--     both correct and sufficient. Same discipline as apply_event in
--     00004: no clock, ever.
--   * Time-based, require periodic sweeping to function AT ALL: STALE,
--     UNBILLED. Per spec §5 ("no activity > 14 days", "no
--     invoice.drafted in 30/60 days"), their truth value can flip purely
--     from elapsed wall-clock time, with NO new event ever arriving — an
--     engagement that goes quiet generates no event to recompute on.
--     Event-triggered recompute alone can only detect this
--     retroactively, the instant something finally happens — exactly
--     the case it exists to catch. So this file also schedules a
--     periodic sweep (below) that recomputes every engagement's signals
--     regardless of event activity. Without it, STALE/UNBILLED would be
--     structurally correct but functionally dead.
-- recompute_signals() itself has no replay/rebuild path (unlike
-- apply_event, which must satisfy byte-identical live-vs-replay, test 3)
-- — it's called from the live trigger and from the sweep below, both of
-- which are allowed to read now().
--
-- Scheduling: evaluated three candidates against this local stack before
-- choosing (pg_cron scheduled job / Supabase Edge Function on its own
-- schedule / unscheduled callable function documented for deploy-time
-- wiring). pg_cron won on evidence, not by default: registered a real
-- job at a short interval, let it fire with NO manual invocation, and
-- confirmed via cron.job_run_details (status 'succeeded') that it
-- flipped a STALE signal on a backdated-but-otherwise-quiet engagement.
-- Verified on local Supabase this way; re-verify on hosted Supabase at
-- deploy (walkthrough Step 9), since hosted pg_cron configuration can
-- differ. `supabase db reset` wipes the pg_cron extension and all
-- registered jobs completely (confirmed empirically — not just the
-- migration-registered job, the extension itself) — so `create
-- extension` and `cron.schedule` both live below and re-run in full on
-- every reset; the unschedule-if-exists guard before scheduling makes
-- that safe on a persistent Postgres too, where the extension and any
-- prior job survive across migration re-runs.
--
-- Wiring: a SECOND `after insert on events` trigger (this file doesn't
-- touch 00004's `events_apply_projection`). Postgres fires same-event
-- triggers in alphabetical order by trigger name, so naming this one
-- `events_recompute_signals` guarantees it runs after
-- `events_apply_projection` ('a' < 'r') — proj_* state is already
-- updated for this event by the time signals recompute.
--
-- Two scoping assumptions, undocumented further in the spec and not
-- exercised by any acceptance test (called out here rather than
-- guessed silently):
--   * UNBILLED's "no invoice.drafted in N days" is measured from the
--     most recent invoice.drafted event for the engagement, or from
--     engagement.created if none exists yet.
--   * UNRECONCILED compares sum(lines[].amount) against the invoice's
--     own top-level `amount` — the spec doesn't specify a canonical
--     "underlying logged/approved amount" source beyond the invoice
--     event's own payload.
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

revoke insert, update, delete on signals from authenticated, anon;

-- Upsert the single active row for (org,stream_type,stream_id,code).
-- No-ops (touches nothing, not even computed_at) if severity/detail/
-- evidence_seqs are unchanged from the current active row — recompute
-- must be idempotent when nothing about the underlying state moved.
create or replace function upsert_signal(
  p_org_id uuid, p_stream_type text, p_stream_id uuid, p_code text,
  p_severity text, p_detail jsonb, p_evidence_seqs bigint[]
) returns void
language plpgsql as $$
declare
  v_existing signals%rowtype;
begin
  select * into v_existing from signals
  where org_id = p_org_id and stream_type = p_stream_type and stream_id = p_stream_id
    and code = p_code and cleared_at is null;

  if found then
    if v_existing.severity is distinct from p_severity
       or v_existing.detail is distinct from p_detail
       or v_existing.evidence_seqs is distinct from p_evidence_seqs then
      update signals
      set severity = p_severity, detail = p_detail, evidence_seqs = p_evidence_seqs,
          computed_at = now()
      where signal_id = v_existing.signal_id;
    end if;
  else
    insert into signals (org_id, stream_type, stream_id, code, severity, detail, evidence_seqs)
    values (p_org_id, p_stream_type, p_stream_id, p_code, p_severity, p_detail, p_evidence_seqs);
  end if;
end $$;

-- Clear the active row, if any. No-op if already cleared/never existed.
create or replace function clear_signal(
  p_org_id uuid, p_stream_type text, p_stream_id uuid, p_code text
) returns void
language plpgsql as $$
begin
  update signals set cleared_at = now()
  where org_id = p_org_id and stream_type = p_stream_type and stream_id = p_stream_id
    and code = p_code and cleared_at is null;
end $$;

revoke execute on function upsert_signal(uuid, text, uuid, text, text, jsonb, bigint[])
  from public, authenticated, anon;
revoke execute on function clear_signal(uuid, text, uuid, text)
  from public, authenticated, anon;

-- The recompute entry point (spec §5: "trigger calls
-- recompute_signals(stream_type, stream_id)"). Dispatches by stream_type
-- to whichever signal rules apply to that kind of stream.
create or replace function recompute_signals(p_stream_type text, p_stream_id uuid) returns void
language plpgsql as $$
declare
  v_org_id          uuid;
  v_evidence        bigint[];
  v_detail          jsonb;
  -- budget_line / OVER_BUDGET
  v_budget_hours    numeric;
  v_hours_logged    numeric;
  -- engagement / SCOPE_DRIFT, STALE, UNBILLED
  v_fee_model       text;
  v_planned_hours   numeric;
  v_approved_co_hrs numeric;
  v_status          text;
  v_last_activity   timestamptz;
  v_unbilled_amount numeric;
  v_last_seq        bigint;
  v_last_invoice_at timestamptz;
  v_engagement_at   timestamptz;
  v_reference_at    timestamptz;
  -- invoice / UNRECONCILED
  v_amount          numeric;
  v_lines           jsonb;
  v_lines_sum       numeric;
begin

  if p_stream_type = 'budget_line' then
    select org_id, budget_hours, hours_logged
    into v_org_id, v_budget_hours, v_hours_logged
    from proj_budget_lines where stream_id = p_stream_id;

    if not found then
      return;
    end if;

    select coalesce(array_agg(seq order by seq), '{}') into v_evidence
    from events
    where org_id = v_org_id
      and event_type = 'time_entry.logged'
      and (payload->>'budget_line_id')::uuid = p_stream_id;

    v_detail := jsonb_build_object(
      'hours_logged', v_hours_logged,
      'budget_hours', v_budget_hours,
      'burn_pct', case when v_budget_hours > 0
                    then round((v_hours_logged / v_budget_hours) * 100, 1)
                    else null end
    );

    if v_budget_hours is not null and v_hours_logged > v_budget_hours then
      perform upsert_signal(v_org_id, 'budget_line', p_stream_id, 'OVER_BUDGET', 'red', v_detail, v_evidence);
    elsif v_budget_hours is not null and v_hours_logged > 0.85 * v_budget_hours then
      perform upsert_signal(v_org_id, 'budget_line', p_stream_id, 'OVER_BUDGET', 'amber', v_detail, v_evidence);
    else
      perform clear_signal(v_org_id, 'budget_line', p_stream_id, 'OVER_BUDGET');
    end if;

  elsif p_stream_type = 'engagement' then
    select org_id, fee_model, planned_hours, approved_co_hours, hours_logged,
           status, last_activity_at, unbilled_amount
    into v_org_id, v_fee_model, v_planned_hours, v_approved_co_hrs, v_hours_logged,
         v_status, v_last_activity, v_unbilled_amount
    from proj_engagements where stream_id = p_stream_id;

    if not found then
      return;
    end if;

    -- SCOPE_DRIFT: fixed-fee only. No clock anywhere in this branch.
    if v_fee_model = 'fixed' then
      select coalesce(array_agg(seq order by seq), '{}') into v_evidence
      from (
        select seq from events
        where org_id = v_org_id and event_type = 'time_entry.logged'
          and (payload->>'engagement_id')::uuid = p_stream_id
        union
        select seq from events
        where org_id = v_org_id and event_type = 'change_order.decided'
          and payload->>'decision' in ('approve','absorb')
          and stream_id in (select stream_id from proj_change_orders where engagement_id = p_stream_id)
      ) sub;

      v_detail := jsonb_build_object(
        'hours_logged', v_hours_logged,
        'planned_hours', v_planned_hours,
        'approved_co_hours', v_approved_co_hrs,
        'threshold_hours', round(1.10 * v_planned_hours, 2)
      );

      if (v_hours_logged - v_approved_co_hrs) > (1.10 * v_planned_hours) then
        perform upsert_signal(v_org_id, 'engagement', p_stream_id, 'SCOPE_DRIFT', 'red', v_detail, v_evidence);
      else
        perform clear_signal(v_org_id, 'engagement', p_stream_id, 'SCOPE_DRIFT');
      end if;
    else
      perform clear_signal(v_org_id, 'engagement', p_stream_id, 'SCOPE_DRIFT');
    end if;

    -- STALE: genuinely time-relative — now() belongs here per spec §5.
    if v_status = 'active' and v_last_activity is not null
       and now() - v_last_activity > interval '14 days' then
      select e.seq into v_last_seq
      from events e
      where e.org_id = v_org_id
        and (
          (e.stream_type = 'engagement' and e.stream_id = p_stream_id and e.event_type = 'engagement.created')
          or (e.event_type = 'time_entry.logged' and (e.payload->>'engagement_id')::uuid = p_stream_id)
        )
      order by e.occurred_at desc, e.seq desc
      limit 1;

      v_detail := jsonb_build_object(
        'last_activity_at', v_last_activity,
        'days_since_activity', round(extract(epoch from (now() - v_last_activity)) / 86400, 1),
        'threshold_days', 14
      );
      perform upsert_signal(v_org_id, 'engagement', p_stream_id, 'STALE', 'amber', v_detail,
        case when v_last_seq is null then '{}'::bigint[] else array[v_last_seq] end);
    else
      perform clear_signal(v_org_id, 'engagement', p_stream_id, 'STALE');
    end if;

    -- UNBILLED: genuinely time-relative — now() belongs here per spec §5.
    if v_unbilled_amount > 0 then
      select max(occurred_at) into v_last_invoice_at
      from events
      where org_id = v_org_id and event_type = 'invoice.drafted'
        and (payload->>'engagement_id')::uuid = p_stream_id;

      select occurred_at into v_engagement_at
      from events
      where org_id = v_org_id and stream_type = 'engagement' and stream_id = p_stream_id
        and event_type = 'engagement.created';

      v_reference_at := coalesce(v_last_invoice_at, v_engagement_at);

      select coalesce(array_agg(seq order by seq), '{}') into v_evidence
      from events
      where org_id = v_org_id and event_type = 'time_entry.logged'
        and (payload->>'engagement_id')::uuid = p_stream_id
        and (payload->>'billable')::boolean = true;

      v_detail := jsonb_build_object(
        'unbilled_amount', v_unbilled_amount,
        'reference_at', v_reference_at,
        'days_since_reference', round(extract(epoch from (now() - v_reference_at)) / 86400, 1)
      );

      if v_reference_at is not null and now() - v_reference_at > interval '60 days' then
        perform upsert_signal(v_org_id, 'engagement', p_stream_id, 'UNBILLED', 'red', v_detail, v_evidence);
      elsif v_reference_at is not null and now() - v_reference_at > interval '30 days' then
        perform upsert_signal(v_org_id, 'engagement', p_stream_id, 'UNBILLED', 'amber', v_detail, v_evidence);
      else
        perform clear_signal(v_org_id, 'engagement', p_stream_id, 'UNBILLED');
      end if;
    else
      perform clear_signal(v_org_id, 'engagement', p_stream_id, 'UNBILLED');
    end if;

  elsif p_stream_type = 'invoice' then
    select org_id, amount, lines into v_org_id, v_amount, v_lines
    from proj_invoices where stream_id = p_stream_id;

    if not found then
      return;
    end if;

    select coalesce(sum((line->>'amount')::numeric), 0) into v_lines_sum
    from jsonb_array_elements(coalesce(v_lines, '[]'::jsonb)) as line;

    select coalesce(array_agg(seq order by seq), '{}') into v_evidence
    from events
    where org_id = v_org_id and stream_type = 'invoice' and stream_id = p_stream_id;

    v_detail := jsonb_build_object('invoice_amount', v_amount, 'lines_sum', v_lines_sum);

    if v_lines_sum is distinct from v_amount then
      perform upsert_signal(v_org_id, 'invoice', p_stream_id, 'UNRECONCILED', 'red', v_detail, v_evidence);
    else
      perform clear_signal(v_org_id, 'invoice', p_stream_id, 'UNRECONCILED');
    end if;
  end if;
end $$;

revoke execute on function recompute_signals(text, uuid) from public, authenticated, anon;

-- Live fan-out: a SECOND after-insert trigger on events, alongside
-- 00004's events_apply_projection (not modified here). Trigger name
-- ensures firing order — see header note.
create or replace function fanout_recompute_signals() returns trigger
language plpgsql as $$
declare
  v_engagement_id  uuid;
  v_budget_line_id uuid;
begin
  case new.event_type
    when 'engagement.created', 'engagement.status_changed' then
      perform recompute_signals('engagement', new.stream_id);

    when 'budget_line.created' then
      perform recompute_signals('budget_line', new.stream_id);

    when 'time_entry.logged' then
      v_engagement_id  := (new.payload->>'engagement_id')::uuid;
      v_budget_line_id := (new.payload->>'budget_line_id')::uuid;
      perform recompute_signals('engagement', v_engagement_id);
      if v_budget_line_id is not null then
        perform recompute_signals('budget_line', v_budget_line_id);
      end if;

    when 'change_order.decided' then
      select engagement_id into v_engagement_id
      from proj_change_orders where stream_id = new.stream_id;
      if v_engagement_id is not null then
        perform recompute_signals('engagement', v_engagement_id);
      end if;

    when 'invoice.drafted', 'invoice.sent', 'invoice.paid' then
      v_engagement_id := (new.payload->>'engagement_id')::uuid;
      perform recompute_signals('invoice', new.stream_id);
      perform recompute_signals('engagement', v_engagement_id);

    else
      null; -- change_order.requested, ai.narrated: no signal impact.
  end case;

  return new;
end $$;

create trigger events_recompute_signals
  after insert on events
  for each row execute function fanout_recompute_signals();

-- Periodic sweep for time-decay signals (STALE, UNBILLED) — see header.
-- Calls the SAME recompute_signals() the live trigger uses above; no
-- forked sweep-specific logic. Only proj_engagements needs sweeping:
-- OVER_BUDGET (budget_line) and UNRECONCILED (invoice) are not
-- time-decay — their truth value only ever changes in response to a
-- real event, which the live trigger already recomputes on.
create or replace function sweep_time_decay_signals() returns void
language plpgsql as $$
declare
  r record;
begin
  for r in select stream_id from proj_engagements loop
    perform recompute_signals('engagement', r.stream_id);
  end loop;
end $$;

revoke execute on function sweep_time_decay_signals() from public, authenticated, anon;

create extension if not exists pg_cron;

-- Idempotent regardless of whether the extension/job survives across
-- migration re-runs (it does not, locally — see header) or persists on
-- a long-lived Postgres instance (it would, elsewhere).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'signet-sweep-time-decay-signals') then
    perform cron.unschedule('signet-sweep-time-decay-signals');
  end if;
end $$;

select cron.schedule(
  'signet-sweep-time-decay-signals',
  '0 * * * *',  -- hourly; spec §5 calls for a nightly sweep, hourly is a
                -- tighter and equally cheap bound at this event volume.
  $sweep$select sweep_time_decay_signals()$sweep$
);
