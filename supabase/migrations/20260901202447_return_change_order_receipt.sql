-- ============================================================
-- Stage 9: narrow verified receipt boundary for change orders
--
-- Authenticated application callers must not receive direct
-- SELECT access to public.events.
--
-- This SECURITY DEFINER wrapper:
--   1. executes the existing idempotent command boundary
--   2. reads the resulting immutable event internally
--   3. returns only the verified receipt fields needed by UI
-- ============================================================

create or replace function public.decide_change_order_with_receipt(
  p_org uuid,
  p_change_order_id uuid,
  p_decision text,
  p_approved_hours numeric,
  p_approved_fee numeric,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_seq      bigint;
  v_receipt  jsonb;
begin
  -- The existing command boundary performs authentication,
  -- org authorization, semantic validation and idempotency.
  v_seq := public.decide_change_order(
    p_org,
    p_change_order_id,
    p_decision,
    p_approved_hours,
    p_approved_fee,
    p_idempotency_key
  );

  if v_seq is null or v_seq <= 0 then
    raise exception
      'decide_change_order_with_receipt: invalid event sequence'
      using errcode = 'P0002';
  end if;

  -- Read the immutable event internally. Application roles still
  -- receive no direct SELECT privilege on public.events.
  select jsonb_build_object(
    'seq', e.seq,
    'event_id', e.event_id,
    'hash', e.hash,
    'occurred_at', e.occurred_at,
    'stream_type', e.stream_type,
    'stream_id', e.stream_id,
    'event_type', e.event_type
  )
  into v_receipt
  from public.events e
  where e.seq = v_seq
    and e.org_id = p_org
    and e.stream_type = 'change_order'
    and e.stream_id = p_change_order_id
    and e.event_type = 'change_order.decided';

  if v_receipt is null then
    raise exception
      'decide_change_order_with_receipt: verified receipt unavailable'
      using errcode = 'P0002';
  end if;

  return v_receipt;
end;
$$;

revoke all on function public.decide_change_order_with_receipt(
  uuid, uuid, text, numeric, numeric, uuid
) from public, anon;

grant execute on function public.decide_change_order_with_receipt(
  uuid, uuid, text, numeric, numeric, uuid
) to authenticated;
