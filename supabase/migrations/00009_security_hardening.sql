-- ============================================================
-- 00009: authenticated write-boundary + gate hardening.
--
-- Preserves all Phase 1 invariants:
--   * events remains the only writable surface
--   * append_event() remains the only application write path
--   * gate enforcement remains inside append_event()
--   * existing event history is untouched
--
-- Adds:
--   1. authenticated org binding
--   2. authenticated actor binding
--   3. fixed-fee gate serialization under the existing chain-head lock
--   4. removal of change-order override as an arithmetic bypass
--   5. time-entry engagement/org reference validation
-- ============================================================

-- Harden the Change-Order Gate without changing its public signature.
--
-- Important lock ordering:
--   chain_heads -> proj_engagements
--
-- Every normal event INSERT already takes chain_heads first in
-- chain_event() and may update projections afterward. Taking the same
-- lock first here prevents two concurrent time entries from evaluating
-- against the same stale burn while also avoiding the reverse-lock-order
-- deadlock that could occur if we locked proj_engagements first.
create or replace function check_change_order_gate(
  p_engagement_id uuid,
  p_new_hours numeric,
  p_override_co_id uuid
) returns void
language plpgsql as $$
declare
  v_org_id        uuid;
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
  v_chain_hash    text;
begin
  if p_new_hours is null or p_new_hours <= 0 then
    raise exception 'CHANGE_ORDER: time-entry hours must be greater than zero'
      using errcode = '22023';
  end if;

  -- First resolve the org. This read is only used to locate the
  -- serialization row; authoritative engagement state is re-read after
  -- the lock is held.
  select org_id
  into v_org_id
  from proj_engagements
  where stream_id = p_engagement_id;

  if not found then
    raise exception 'CHANGE_ORDER: unknown engagement %', p_engagement_id
      using errcode = '23503';
  end if;

  -- Acquire the SAME per-org serialization point used by chain_event().
  -- Once this succeeds, every earlier event for this org has either
  -- committed or rolled back, so the projection read below observes the
  -- latest committed burn before this entry is evaluated.
  select hash
  into v_chain_hash
  from chain_heads
  where org_id = v_org_id
  for update;

  if not found then
    raise exception 'CHANGE_ORDER: missing chain head for org %', v_org_id
      using errcode = '23503';
  end if;

  select fee_model, planned_hours, approved_co_hours, hours_logged, name
  into v_fee_model, v_planned_hours, v_approved_co, v_hours_logged, v_eng_name
  from proj_engagements
  where stream_id = p_engagement_id
  for update;

  if not found then
    raise exception 'CHANGE_ORDER: unknown engagement %', p_engagement_id
      using errcode = '23503';
  end if;

  -- Optional override is now provenance only, never an arithmetic bypass.
  -- If supplied, it must cite a real decided CO for this engagement.
  if p_override_co_id is not null then
    select true
    into v_override_ok
    from proj_change_orders
    where stream_id = p_override_co_id
      and engagement_id = p_engagement_id
      and org_id = v_org_id
      and status in ('approve', 'absorb')
    limit 1;

    if not coalesce(v_override_ok, false) then
      raise exception
        'CHANGE_ORDER: override % is not an approved/absorbed change order for engagement %',
        p_override_co_id, p_engagement_id
        using errcode = '23503';
    end if;
  end if;

  -- Gate applies only to fixed-fee engagements.
  if v_fee_model is distinct from 'fixed' then
    return;
  end if;

  v_hours_after := v_hours_logged + p_new_hours;
  v_threshold   := 1.10 * v_planned_hours;
  v_net         := v_hours_after - v_approved_co;

  -- Approved/absorbed CO hours form a finite pooled allowance.
  -- An override may identify the source of authority, but cannot create
  -- more authority than the decided hours actually granted.
  if v_net <= v_threshold then
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
        detail = jsonb_build_object(
          'gate', 'CHANGE_ORDER',
          'deficit_hours', round(v_deficit, 2)
        )::text;
end $$;

revoke execute on function check_change_order_gate(uuid, numeric, uuid)
  from public, authenticated, anon;


-- Replace append_event() in place so existing callers and the frozen
-- Phase 1 acceptance suite retain the same function signature.
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
  v_seq                bigint;
  v_jwt_role           text;
  v_claim_org_text     text;
  v_claim_org          uuid;
  v_auth_uid           uuid;
  v_effective_actor_id text;
  v_ref_org            uuid;
begin
  -- Determine whether this call came through a Supabase authenticated
  -- JWT. Direct trusted DB/test/service contexts have no authenticated
  -- JWT and retain the explicit actor/org parameters required by the
  -- Phase 1 harness.
  v_jwt_role := coalesce(auth.jwt() ->> 'role', '');

  if v_jwt_role = 'authenticated' then
    v_claim_org_text := auth.jwt() ->> 'org_id';

    if v_claim_org_text is null or v_claim_org_text = '' then
      raise exception 'append_event: authenticated session has no org_id claim'
        using errcode = '42501';
    end if;

    begin
      v_claim_org := v_claim_org_text::uuid;
    exception
      when invalid_text_representation then
        raise exception 'append_event: authenticated session has malformed org_id claim'
          using errcode = '42501';
    end;

    if v_claim_org is distinct from p_org then
      raise exception
        'append_event: requested org does not match authenticated org'
        using errcode = '42501';
    end if;

    -- Browser/authenticated users represent humans only. System/AI events
    -- must originate from a trusted server-side execution context.
    if p_actor_type is distinct from 'human' then
      raise exception
        'append_event: authenticated clients may only append human-attributed events'
        using errcode = '42501';
    end if;

    v_auth_uid := auth.uid();

    if v_auth_uid is null then
      raise exception 'append_event: authenticated session has no user id'
        using errcode = '42501';
    end if;

    v_effective_actor_id := v_auth_uid::text;

    -- Explicit spoof attempts fail rather than being silently rewritten.
    if p_actor_id is not null
       and p_actor_id is distinct from v_effective_actor_id then
      raise exception
        'append_event: actor_id does not match authenticated user'
        using errcode = '42501';
    end if;
  else
    -- Trusted DB/service/test path.
    if p_actor_id is null then
      raise exception 'append_event: actor_id is required';
    end if;

    v_effective_actor_id := p_actor_id;
  end if;

  -- Existing Phase 1 payload taxonomy validation.
  perform validate_event_payload(p_event_type, p_payload);

  -- Preserve the structural AI boundary.
  if (p_event_type = 'ai.narrated') <> (p_actor_type = 'ai') then
    raise exception
      'append_event: ai.narrated events must have actor_type ''ai'', and '
      'actor_type ''ai'' may only be used for ai.narrated events '
      '(got event_type="%", actor_type="%")',
      p_event_type, p_actor_type
      using errcode = '22023';
  end if;

  -- Time entries must reference an engagement belonging to the SAME org
  -- as the event being appended. This prevents a valid caller org from
  -- being paired with another org's engagement UUID.
  if p_event_type = 'time_entry.logged' then
    select org_id
    into v_ref_org
    from proj_engagements
    where stream_id = (p_payload->>'engagement_id')::uuid;

    if not found then
      raise exception 'append_event: time entry references unknown engagement'
        using errcode = '23503';
    end if;

    if v_ref_org is distinct from p_org then
      raise exception
        'append_event: time entry engagement does not belong to event org'
        using errcode = '42501';
    end if;

    perform check_change_order_gate(
      (p_payload->>'engagement_id')::uuid,
      (p_payload->>'hours')::numeric(8,2),
      (p_payload->'override'->>'change_order_id')::uuid
    );
  end if;

  insert into events (
    org_id,
    stream_type,
    stream_id,
    event_type,
    payload,
    actor_type,
    actor_id
  ) values (
    p_org,
    p_stream_type,
    p_stream_id,
    p_event_type,
    p_payload,
    p_actor_type,
    v_effective_actor_id
  )
  returning seq into v_seq;

  return v_seq;
end $$;

grant execute on function append_event(
  uuid, text, uuid, text, jsonb, text, text
) to authenticated;
