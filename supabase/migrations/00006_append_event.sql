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

  -- 2. GATES.
  -- GATE: Change-Order Gate — implemented in a later step, once
  -- proj_engagements (hours_logged / planned_hours / approved_co_hours,
  -- migration 00004) is wired up via apply_event(). Belongs here:
  --
  --   trigger:     p_event_type = 'time_entry.logged' on an engagement
  --                whose fee_model = 'fixed'
  --   predicate:   would this entry push hours_logged past
  --                1.10 * planned_hours, net of approved_co_hours?
  --   enforcement: raise exception with structured detail
  --                {"gate":"CHANGE_ORDER","deficit_hours":n}
  --                UNLESS payload->'override'->>'change_order_id' references
  --                an approved change_order.decided(approve), OR a prior
  --                change_order.decided(absorb) event covers the deficit.
  --                Absorbing scope is allowed — silently absorbing it is not.

  -- 3. Insert into events; the chain trigger (00003) computes
  --    prev_hash/hash and enforces linear ordering per org.
  insert into events (
    org_id, stream_type, stream_id, event_type, payload, actor_type, actor_id
  ) values (
    p_org, p_stream_type, p_stream_id, p_event_type, p_payload,
    p_actor_type, p_actor_id
  )
  returning seq into v_seq;

  -- 4. Projection/signal fan-out (apply_event, recompute_signals) will run
  --    via triggers on events once 00004/00005 are implemented. Nothing to
  --    call here yet — do not touch projections or signals in this step.

  -- 5. Return seq.
  return v_seq;
end $$;

grant execute on function append_event(
  uuid, text, uuid, text, jsonb, text, text
) to authenticated;
