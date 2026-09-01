-- ============================================================
-- Stage 9: idempotent change-order command boundary
--
-- Guarantees:
--   same org + same idempotency key + same command
--     -> returns the original event seq
--
--   same org + same idempotency key + different command
--     -> rejects as an idempotency conflict
--
--   new idempotency key
--     -> executes normally through append_event()
-- ============================================================

create table public.change_order_commands (
  org_id            uuid not null,
  idempotency_key   uuid not null,
  change_order_id   uuid not null,
  decision          text not null
                    check (decision in ('approve', 'absorb', 'decline')),
  approved_hours    numeric(8,2) not null,
  approved_fee      numeric not null,
  event_seq         bigint,
  created_at        timestamptz not null default now(),

  primary key (org_id, idempotency_key)
);

-- This table is internal command-control state, not application data.
alter table public.change_order_commands enable row level security;

revoke all on table public.change_order_commands
from anon, authenticated;

create or replace function public.decide_change_order(
  p_org uuid,
  p_change_order_id uuid,
  p_decision text,
  p_approved_hours numeric,
  p_approved_fee numeric,
  p_idempotency_key uuid
) returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_jwt_role        text;
  v_claim_org_text  text;
  v_claim_org       uuid;
  v_existing        public.change_order_commands%rowtype;
  v_seq             bigint;
  v_hours           numeric(8,2);
  v_fee             numeric;
  v_inserted        boolean := false;
  v_append_actor_id text;
begin
  -- ----------------------------------------------------------
  -- 1. Authenticated callers may only operate inside JWT org.
  -- ----------------------------------------------------------
  v_jwt_role := coalesce(auth.jwt() ->> 'role', '');

  if v_jwt_role = 'authenticated' then
    v_append_actor_id := null;
    v_claim_org_text := auth.jwt() ->> 'org_id';

    if v_claim_org_text is null or v_claim_org_text = '' then
      raise exception
        'decide_change_order: authenticated session has no org_id claim'
        using errcode = '42501';
    end if;

    begin
      v_claim_org := v_claim_org_text::uuid;
    exception
      when invalid_text_representation then
        raise exception
          'decide_change_order: authenticated session has malformed org_id claim'
          using errcode = '42501';
    end;

    if v_claim_org is distinct from p_org then
      raise exception
        'decide_change_order: requested org does not match authenticated org'
        using errcode = '42501';
    end if;
  else
    -- Trusted DB/test context has no Supabase JWT. Preserve explicit
    -- provenance because append_event() requires actor_id in this path.
    v_append_actor_id := session_user;
  end if;

  -- ----------------------------------------------------------
  -- 2. Validate command semantics before reserving the key.
  -- ----------------------------------------------------------
  if p_idempotency_key is null then
    raise exception
      'decide_change_order: idempotency key is required'
      using errcode = '22023';
  end if;

  if p_decision not in ('approve', 'absorb', 'decline') then
    raise exception
      'decide_change_order: invalid decision'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.proj_change_orders
    where org_id = p_org
      and stream_id = p_change_order_id
  ) then
    raise exception
      'decide_change_order: unknown change order'
      using errcode = '23503';
  end if;

  if p_decision = 'approve' then
    if p_approved_hours is null or p_approved_hours < 0 then
      raise exception
        'decide_change_order: approved hours must be nonnegative'
        using errcode = '22023';
    end if;

    if p_approved_fee is null or p_approved_fee < 0 then
      raise exception
        'decide_change_order: approved fee must be nonnegative'
        using errcode = '22023';
    end if;

    v_hours := p_approved_hours::numeric(8,2);
    v_fee := p_approved_fee;

  elsif p_decision = 'absorb' then
    if p_approved_hours is null or p_approved_hours < 0 then
      raise exception
        'decide_change_order: absorbed hours must be nonnegative'
        using errcode = '22023';
    end if;

    v_hours := p_approved_hours::numeric(8,2);
    v_fee := 0;

  else
    v_hours := 0;
    v_fee := 0;
  end if;

  -- ----------------------------------------------------------
  -- 3. Reserve the idempotency key.
  --
  -- The unique PK serializes concurrent requests using the
  -- same key. If this insert wins, this transaction owns the
  -- command. If it loses, read the committed original.
  -- ----------------------------------------------------------
  insert into public.change_order_commands (
    org_id,
    idempotency_key,
    change_order_id,
    decision,
    approved_hours,
    approved_fee
  )
  values (
    p_org,
    p_idempotency_key,
    p_change_order_id,
    p_decision,
    v_hours,
    v_fee
  )
  on conflict (org_id, idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;

  if not v_inserted then
    select *
    into v_existing
    from public.change_order_commands
    where org_id = p_org
      and idempotency_key = p_idempotency_key;

    if not found then
      raise exception
        'decide_change_order: idempotency reservation disappeared'
        using errcode = '40001';
    end if;

    if v_existing.change_order_id is distinct from p_change_order_id
       or v_existing.decision is distinct from p_decision
       or v_existing.approved_hours is distinct from v_hours
       or v_existing.approved_fee is distinct from v_fee then
      raise exception
        'decide_change_order: idempotency key reused for a different command'
        using errcode = '23505';
    end if;

    if v_existing.event_seq is null then
      raise exception
        'decide_change_order: original command has no event receipt'
        using errcode = '40001';
    end if;

    return v_existing.event_seq;
  end if;

  -- ----------------------------------------------------------
  -- 4. Execute through the existing kernel.
  -- ----------------------------------------------------------
  v_seq := public.append_event(
    p_org,
    'change_order',
    p_change_order_id,
    'change_order.decided',
    jsonb_build_object(
      'change_order_id', p_change_order_id,
      'decision', p_decision,
      'approved_hours', v_hours,
      'approved_fee', v_fee
    ),
    'human',
    v_append_actor_id
  );

  if v_seq is null or v_seq <= 0 then
    raise exception
      'decide_change_order: append_event returned invalid sequence';
  end if;

  -- ----------------------------------------------------------
  -- 5. Bind the reservation to its immutable ledger receipt.
  -- ----------------------------------------------------------
  update public.change_order_commands
  set event_seq = v_seq
  where org_id = p_org
    and idempotency_key = p_idempotency_key;

  return v_seq;
end;
$$;

revoke all on function public.decide_change_order(
  uuid, uuid, text, numeric, numeric, uuid
) from public, anon;

grant execute on function public.decide_change_order(
  uuid, uuid, text, numeric, numeric, uuid
) to authenticated;
