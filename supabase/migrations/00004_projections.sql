-- ============================================================
-- 00004: projections.
-- Upholds invariants 1, 3. See spec §4 and event taxonomy §3.3.
-- RULES:
--   * apply_event(e events) is the ONLY reducer. The live trigger and
--     rebuild_projections() both call it. One code path.
--   * Every projection row carries last_event_seq.
--   * Projections are delete-and-replay rebuildable per org at any time.
--   * apply_event must be deterministic: every value comes from the event
--     row itself (payload, occurred_at, seq) — never from now() or other
--     wall-clock/session state. A reducer that reads the clock makes live
--     and replay diverge, which is exactly what acceptance test 3 catches.
--   * Hours: numeric(8,2). Money: numeric (no fixed scale), per CLAUDE.md.
-- ============================================================

create table proj_engagements (
  stream_id uuid primary key,
  org_id uuid not null,
  name text, client text,
  fee_model text check (fee_model in ('fixed','tm','retainer')),
  fee_amount numeric,
  planned_cost numeric,
  planned_hours numeric(8,2),
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
  budget_hours numeric(8,2),
  rate numeric,
  cost_rate numeric,
  hours_logged numeric not null default 0,
  last_event_seq bigint not null
);

create table proj_invoices (
  stream_id uuid primary key,
  org_id uuid not null,
  engagement_id uuid not null,
  status text not null default 'drafted' check (status in ('drafted','sent','paid')),
  amount numeric not null,
  lines jsonb,
  last_event_seq bigint not null
);

create table proj_change_orders (
  stream_id uuid primary key,
  org_id uuid not null,
  engagement_id uuid not null,
  description text,
  est_hours numeric(8,2),
  est_fee numeric,
  status text not null default 'requested' check (status in ('requested','approve','absorb','decline')),
  approved_hours numeric(8,2) not null default 0,
  approved_fee numeric not null default 0,
  last_event_seq bigint not null
);

-- The single reducer (invariant 3). Called by the live fan-out trigger
-- below and by rebuild_projections() — never forked into two versions.
-- Every assignment here comes from e.payload / e.occurred_at / e.seq;
-- nothing reads now() or any other non-event-sourced state.
create or replace function apply_event(e events) returns void
language plpgsql as $$
declare
  v_hours          numeric(8,2);
  v_cost_rate      numeric;
  v_rate           numeric;
  v_billable       boolean;
  v_budget_line_id uuid;
  v_engagement_id  uuid;
  v_decision       text;
  v_approved_hours numeric(8,2);
begin
  case e.event_type

    when 'engagement.created' then
      insert into proj_engagements (
        stream_id, org_id, name, client, fee_model, fee_amount,
        planned_cost, planned_hours, status, hours_logged, cost_accrued,
        unbilled_amount, approved_co_hours, last_activity_at, last_event_seq
      ) values (
        e.stream_id, e.org_id,
        e.payload->>'name', e.payload->>'client', e.payload->>'fee_model',
        (e.payload->>'fee_amount')::numeric,
        (e.payload->>'planned_cost')::numeric,
        (e.payload->>'planned_hours')::numeric(8,2),
        'active', 0, 0, 0, 0,
        e.occurred_at, e.seq
      );

    when 'engagement.status_changed' then
      update proj_engagements
      set status = e.payload->>'status',
          last_event_seq = e.seq
      where stream_id = e.stream_id;

    when 'budget_line.created' then
      insert into proj_budget_lines (
        stream_id, org_id, engagement_id, label, budget_hours, rate, cost_rate,
        hours_logged, last_event_seq
      ) values (
        e.stream_id, e.org_id, (e.payload->>'engagement_id')::uuid,
        e.payload->>'label',
        (e.payload->>'budget_hours')::numeric(8,2),
        (e.payload->>'rate')::numeric,
        (e.payload->>'cost_rate')::numeric,
        0, e.seq
      );

    when 'time_entry.logged' then
      v_hours          := (e.payload->>'hours')::numeric(8,2);
      v_cost_rate      := (e.payload->>'cost_rate')::numeric;
      v_billable       := (e.payload->>'billable')::boolean;
      v_budget_line_id := (e.payload->>'budget_line_id')::uuid;
      v_engagement_id  := (e.payload->>'engagement_id')::uuid;

      update proj_engagements
      set hours_logged = hours_logged + v_hours,
          cost_accrued = cost_accrued + (v_hours * v_cost_rate),
          last_activity_at = e.occurred_at,
          last_event_seq = e.seq
      where stream_id = v_engagement_id;

      if v_budget_line_id is not null then
        update proj_budget_lines
        set hours_logged = hours_logged + v_hours,
            last_event_seq = e.seq
        where stream_id = v_budget_line_id;

        if v_billable then
          select rate into v_rate from proj_budget_lines where stream_id = v_budget_line_id;
          update proj_engagements
          set unbilled_amount = unbilled_amount + (v_hours * v_rate)
          where stream_id = v_engagement_id;
        end if;
      end if;

    when 'change_order.requested' then
      insert into proj_change_orders (
        stream_id, org_id, engagement_id, description, est_hours, est_fee,
        status, approved_hours, approved_fee, last_event_seq
      ) values (
        e.stream_id, e.org_id, (e.payload->>'engagement_id')::uuid,
        e.payload->>'description',
        (e.payload->>'est_hours')::numeric(8,2),
        (e.payload->>'est_fee')::numeric,
        'requested', 0, 0, e.seq
      );

    when 'change_order.decided' then
      v_decision       := e.payload->>'decision';
      v_approved_hours := (e.payload->>'approved_hours')::numeric(8,2);

      -- stream_id IS the change_order_id for this stream (spec §3.3);
      -- payload's change_order_id is redundant with it, not authoritative.
      update proj_change_orders
      set status = v_decision,
          approved_hours = v_approved_hours,
          approved_fee = (e.payload->>'approved_fee')::numeric,
          last_event_seq = e.seq
      where stream_id = e.stream_id
      returning engagement_id into v_engagement_id;

      -- Absorb still covers the hours (spec §6: "absorbing scope is
      -- allowed — silently absorbing it is not"), so both approve and
      -- absorb count toward approved_co_hours; decline counts nothing.
      if v_decision in ('approve', 'absorb') then
        update proj_engagements
        set approved_co_hours = approved_co_hours + v_approved_hours,
            last_event_seq = e.seq
        where stream_id = v_engagement_id;
      end if;

    when 'invoice.drafted' then
      insert into proj_invoices (
        stream_id, org_id, engagement_id, status, amount, lines, last_event_seq
      ) values (
        e.stream_id, e.org_id, (e.payload->>'engagement_id')::uuid,
        'drafted', (e.payload->>'amount')::numeric, e.payload->'lines', e.seq
      );
      -- Drafting moves the amount from unbilled into invoiced.
      update proj_engagements
      set unbilled_amount = unbilled_amount - (e.payload->>'amount')::numeric,
          last_event_seq = e.seq
      where stream_id = (e.payload->>'engagement_id')::uuid;

    when 'invoice.sent' then
      update proj_invoices
      set status = 'sent', last_event_seq = e.seq
      where stream_id = e.stream_id;

    when 'invoice.paid' then
      update proj_invoices
      set status = 'paid', last_event_seq = e.seq
      where stream_id = e.stream_id;

    when 'ai.narrated' then
      null; -- narration carries no projection state (spec §7).

    else
      raise exception 'apply_event: unhandled event_type "%"', e.event_type;
  end case;
end $$;

revoke execute on function apply_event(events) from public, authenticated, anon;

-- Live fan-out: AFTER INSERT so NEW already reflects chain_event()'s
-- (00003) final seq/prev_hash/hash — the same row rebuild_projections()
-- will see when it replays this event later.
create or replace function fanout_apply_event() returns trigger
language plpgsql as $$
begin
  perform apply_event(new);
  return new;
end $$;

create trigger events_apply_projection
  after insert on events
  for each row execute function fanout_apply_event();

-- Delete-and-replay rebuild for one org. Must produce state identical to
-- the live path (acceptance test 3) because both paths call apply_event.
create or replace function rebuild_projections(p_org uuid) returns void
language plpgsql as $$
declare
  e events%rowtype;
begin
  delete from proj_engagements where org_id = p_org;
  delete from proj_budget_lines where org_id = p_org;
  delete from proj_invoices where org_id = p_org;
  delete from proj_change_orders where org_id = p_org;

  for e in select * from events where org_id = p_org order by seq loop
    perform apply_event(e);
  end loop;
end $$;

revoke execute on function rebuild_projections(uuid) from public, authenticated, anon;

revoke insert, update, delete on
  proj_engagements, proj_budget_lines, proj_invoices, proj_change_orders
  from authenticated, anon;
