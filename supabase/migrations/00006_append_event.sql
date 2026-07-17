-- ============================================================
-- 00006: append_event RPC + Change-Order Gate.
-- Upholds invariants 1, 6 (CLAUDE.md). This is the ONLY write path
-- into the system. Spec §3.3 (taxonomy), §6 (gate semantics).
-- ============================================================

-- Schema validation per event_type (spec §3.3, Phase 1 taxonomy).
-- Rejects unknown event types and payloads missing required keys.
create or replace function validate_event_payload(
  p_event_type text, p_payload jsonb
) returns void
language plpgsql as $$
declare
  required text[];
  key text;
begin
  required := case p_event_type
    when 'engagement.created' then
      array['name', 'client', 'fee_model', 'fee_amount', 'planned_cost', 'planned_hours']
    when 'engagement.status_changed' then
      array['status']
    when 'budget_line.created' then
      array['engagement_id', 'label', 'budget_hours', 'rate', 'cost_rate']
    when 'time_entry.logged' then
      array['engagement_id', 'budget_line_id', 'hours', 'person', 'cost_rate', 'billable', 'note']
    when 'change_order.requested' then
      array['engagement_id', 'description', 'est_hours', 'est_fee']
    when 'change_order.decided' then
      array['change_order_id', 'decision', 'approved_hours', 'approved_fee']
    when 'invoice.drafted' then
      array['engagement_id', 'amount', 'lines']
    when 'invoice.sent' then
      array['engagement_id', 'amount', 'lines']
    when 'invoice.paid' then
      array['engagement_id', 'amount', 'lines']
    when 'ai.narrated' then
      array['signal_ids', 'model', 'prompt_hash', 'output_hash']
    else null
  end;

  if required is null then
    raise exception 'append_event: unknown event_type "%"', p_event_type
      using errcode = '22023';
  end if;

  foreach key in array required loop
    if not (p_payload ? key) then
      raise exception 'append_event: payload for "%" missing required key "%"',
        p_event_type, key
        using errcode = '22023';
    end if;
  end loop;
end $$;

-- Change-Order Gate (spec §6, invariant 6). Fires only on
-- time_entry.logged for fixed-fee engagements. Reads proj_engagements —
-- that's what projections are for, so the gate doesn't re-derive burn
-- from the raw event log on every call. approved_co_hours already
-- accumulates BOTH 'approve' and 'absorb' decisions (00004's
-- apply_event), so the aggregate "net of approved CO hours" check alone
-- correctly passes an entry once enough decided hours cover it — no
-- override needed for that to work arithmetically. The override check
-- below is a second, independent path: an explicit per-entry citation of
-- a decided CO, honored even if the aggregate hasn't (for whatever
-- reason) covered it yet. Either path is enough; absorbing scope is
-- allowed, silently absorbing it is not — the decision must already be
-- a change_order.decided event before this call, never invented here.
--
-- Threshold formula — deliberate reading of "past 1.10 × planned_hours
-- net of approved_co_hours": allowed = (1.10 × planned_hours) +
-- approved_co_hours. The 10% tolerance belongs to the ORIGINAL estimate
-- only; approved change-order hours are exact grants, added on top, not
-- themselves padded by another 10%. (The other defensible reading —
-- 1.10 × (planned_hours + approved_co_hours) — would also pass test 5's
-- numbers; this file commits to the first on purpose.)
--
-- Known race (documented, not fixed, same honesty standard as 00003's
-- History note): this function reads proj_engagements.hours_logged
-- BEFORE the caller's INSERT, but the only real serialization point in
-- the system is the chain_heads lock inside chain_event() (00003),
-- acquired DURING that INSERT. Two concurrent time_entry.logged calls on
-- the same engagement can both read the same pre-entry burn, both pass
-- the check, and both land — briefly overshooting the threshold before
-- the next entry gets gated on the now-updated projection. Accepted for
-- Phase 1: the overshoot is small (bounded by one concurrent write),
-- transient, and every entry that lands is still in the ledger with a
-- verifiable hash chain — nothing is silently lost or hidden, which is
-- the property this whole system exists to guarantee. Closing this
-- fully would mean moving the burn check inside the same lock as the
-- hash chain itself, which couples the gate to 00003's internals in a
-- way Phase 1 doesn't need yet.
create or replace function check_change_order_gate(
  p_engagement_id uuid, p_new_hours numeric, p_override_co_id uuid
) returns void
language plpgsql as $$
declare
  v_fee_model     text;
  v_planned_hours numeric;
  v_approved_co   numeric;
  v_hours_logged  numeric;
  v_eng_name      text;
  v_hours_after   numeric;
  v_threshold     numeric;
  v_net           numeric;
  v_deficit       numeric;
  v_override_ok   boolean := false;
begin
  select fee_model, planned_hours, approved_co_hours, hours_logged, name
  into v_fee_model, v_planned_hours, v_approved_co, v_hours_logged, v_eng_name
  from proj_engagements where stream_id = p_engagement_id;

  if not found or v_fee_model is distinct from 'fixed' then
    return; -- gate only applies to fixed-fee engagements
  end if;

  v_hours_after := v_hours_logged + p_new_hours;
  v_threshold   := 1.10 * v_planned_hours;
  v_net         := v_hours_after - v_approved_co;

  if v_net <= v_threshold then
    return; -- within scope, net of whatever's already been decided
  end if;

  if p_override_co_id is not null then
    select true into v_override_ok
    from proj_change_orders
    where stream_id = p_override_co_id
      and engagement_id = p_engagement_id
      and status in ('approve', 'absorb')
    limit 1;
  end if;

  if coalesce(v_override_ok, false) then
    return;
  end if;

  v_deficit := v_net - v_threshold;
  raise exception
    'CHANGE_ORDER: logging % more hour(s) would bring "%" to % hours logged against a '
    '% hour scope (110%% allowed = %h; % already covered by approved change orders) — '
    '% hour(s) over. Get a change order approved by the client, or record an explicit '
    'decision to absorb the cost, before logging this time.',
    to_char(p_new_hours, 'FM999990.00'),
    v_eng_name,
    to_char(v_hours_after, 'FM999990.00'),
    to_char(v_planned_hours, 'FM999990.00'),
    to_char(v_threshold, 'FM999990.00'),
    to_char(v_approved_co, 'FM999990.00'),
    to_char(v_deficit, 'FM999990.00')
  using errcode = 'P0001',
        detail = jsonb_build_object('gate', 'CHANGE_ORDER', 'deficit_hours', round(v_deficit, 2))::text;
end $$;

revoke execute on function check_change_order_gate(uuid, numeric, uuid)
  from public, authenticated, anon;

-- The only write path into events (invariant 1). Security definer so app
-- roles (which have insert revoked on events, see 00002) can only ever
-- write through this validated, gated entry point.
create or replace function append_event(
  p_org uuid,
  p_stream_type text,
  p_stream_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_actor_type text default 'human',
  p_actor_id text default null
) returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_seq bigint;
begin
  if p_actor_id is null then
    raise exception 'append_event: actor_id is required';
  end if;

  -- 1. Schema-validate payload per event_type; reject unknown types.
  perform validate_event_payload(p_event_type, p_payload);

  -- 1b. AI boundary (spec §7, invariant 4): ai.narrated events must be
  -- attributed to the AI actor, and actor_type 'ai' must never appear on
  -- anything else. Without this, an AI-attributed time_entry.logged
  -- would sail through, or a human could file an ai.narrated event under
  -- their own name — both violate "never route AI output into the
  -- system except as an ai.narrated event via append_event()".
  if (p_event_type = 'ai.narrated') <> (p_actor_type = 'ai') then
    raise exception
      'append_event: ai.narrated events must have actor_type ''ai'', and '
      'actor_type ''ai'' may only be used for ai.narrated events '
      '(got event_type="%", actor_type="%")', p_event_type, p_actor_type
      using errcode = '22023';
  end if;

  -- 2. GATES. Phase 1: the Change-Order Gate (spec §6).
  if p_event_type = 'time_entry.logged' then
    perform check_change_order_gate(
      (p_payload->>'engagement_id')::uuid,
      (p_payload->>'hours')::numeric(8,2),
      (p_payload->'override'->>'change_order_id')::uuid
    );
  end if;

  -- 3. Insert into events; the chain trigger (00003) computes
  --    prev_hash/hash and enforces linear ordering per org.
  insert into events (
    org_id, stream_type, stream_id, event_type, payload, actor_type, actor_id
  ) values (
    p_org, p_stream_type, p_stream_id, p_event_type, p_payload,
    p_actor_type, p_actor_id
  )
  returning seq into v_seq;

  -- 4. Projection/signal fan-out (apply_event via 00004's
  --    events_apply_projection, recompute_signals via 00005's
  --    events_recompute_signals) already ran synchronously as part of
  --    the INSERT above, through the AFTER INSERT triggers on events.

  -- 5. Return seq.
  return v_seq;
end $$;

grant execute on function append_event(
  uuid, text, uuid, text, jsonb, text, text
) to authenticated;
