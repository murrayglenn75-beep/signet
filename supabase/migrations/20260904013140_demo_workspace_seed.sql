-- ============================================================
-- Signet isolated demo workspace
--
-- Seeds realistic portfolio/demo operational history through the
-- production event kernel.
--
-- IMPORTANT:
--   * No projection tables are written directly.
--   * No generated auth user IDs are hard-coded here.
--   * The demo org is separate from the production org.
--   * Demo browser sessions are read-only, but trusted migration
--     context may seed through append_event().
-- ============================================================

do $$
declare
  v_org uuid := 'd0000000-0000-0000-0000-000000000001';

  -- Engagement 1: fixed-fee implementation
  v_eng_fixed uuid := 'd1000000-0000-0000-0000-000000000001';
  v_budget_fixed uuid := 'd1100000-0000-0000-0000-000000000001';
  v_co_fixed uuid := 'd1c00000-0000-0000-0000-000000000001';

  -- Engagement 2: T&M integration
  v_eng_tm uuid := 'd2000000-0000-0000-0000-000000000001';
  v_budget_tm uuid := 'd2100000-0000-0000-0000-000000000001';
  v_invoice_tm uuid := 'd2f00000-0000-0000-0000-000000000001';

  -- Engagement 3: healthy retainer
  v_eng_retainer uuid := 'd3000000-0000-0000-0000-000000000001';
  v_budget_retainer uuid := 'd3100000-0000-0000-0000-000000000001';

  v_actor text := 'signet-demo-seed';
begin

  -- ----------------------------------------------------------
  -- Idempotency guard for persistent environments.
  --
  -- A migration should normally execute once, but this also prevents
  -- accidental duplicate demo history if the body is replayed manually.
  -- ----------------------------------------------------------

  if exists (
    select 1
    from public.events
    where org_id = v_org
    limit 1
  ) then
    raise notice 'Signet demo workspace already seeded; skipping.';
    return;
  end if;


  -- ==========================================================
  -- ENGAGEMENT 1
  -- Atlas Commerce Platform
  --
  -- Fixed fee.
  -- Scope grew during implementation.
  -- A real change order is requested and approved before the
  -- additional hours are logged.
  -- Budget ultimately crosses 100%, producing a RED budget signal,
  -- while the approved CO keeps the fixed-fee scope gate valid.
  -- ==========================================================

  perform public.append_event(
    v_org,
    'engagement',
    v_eng_fixed,
    'engagement.created',
    jsonb_build_object(
      'name', 'Atlas Commerce Platform',
      'client', 'Atlas Retail Group',
      'fee_model', 'fixed',
      'fee_amount', 25000,
      'planned_cost', 12000,
      'planned_hours', 100
    ),
    'human',
    v_actor
  );

  perform public.append_event(
    v_org,
    'budget_line',
    v_budget_fixed,
    'budget_line.created',
    jsonb_build_object(
      'engagement_id', v_eng_fixed,
      'label', 'Platform engineering',
      'budget_hours', 100,
      'rate', 250,
      'cost_rate', 120
    ),
    'human',
    v_actor
  );

  perform public.append_event(
    v_org,
    'time_entry',
    gen_random_uuid(),
    'time_entry.logged',
    jsonb_build_object(
      'engagement_id', v_eng_fixed,
      'budget_line_id', v_budget_fixed,
      'hours', 60,
      'person', 'Delivery Team',
      'cost_rate', 120,
      'billable', true,
      'note', 'Core commerce implementation'
    ),
    'human',
    v_actor
  );

  perform public.append_event(
    v_org,
    'change_order',
    v_co_fixed,
    'change_order.requested',
    jsonb_build_object(
      'engagement_id', v_eng_fixed,
      'description', 'Expanded checkout and fulfilment integration',
      'est_hours', 20,
      'est_fee', 5000
    ),
    'human',
    v_actor
  );

  perform public.append_event(
    v_org,
    'change_order',
    v_co_fixed,
    'change_order.decided',
    jsonb_build_object(
      'change_order_id', v_co_fixed,
      'decision', 'approve',
      'approved_hours', 20,
      'approved_fee', 5000
    ),
    'human',
    v_actor
  );

  perform public.append_event(
    v_org,
    'time_entry',
    gen_random_uuid(),
    'time_entry.logged',
    jsonb_build_object(
      'engagement_id', v_eng_fixed,
      'budget_line_id', v_budget_fixed,
      'hours', 45,
      'person', 'Delivery Team',
      'cost_rate', 120,
      'billable', true,
      'note', 'Approved expanded scope implementation'
    ),
    'human',
    v_actor
  );


  -- ==========================================================
  -- ENGAGEMENT 2
  -- Meridian Data Integration
  --
  -- T&M project sitting at 90% of its budget.
  -- This produces an AMBER OVER_BUDGET signal.
  --
  -- The invoice deliberately contains line totals that do not equal
  -- the invoice total, producing a RED UNRECONCILED signal.
  -- ==========================================================

  perform public.append_event(
    v_org,
    'engagement',
    v_eng_tm,
    'engagement.created',
    jsonb_build_object(
      'name', 'Meridian Data Integration',
      'client', 'Meridian Health',
      'fee_model', 'tm',
      'fee_amount', 18000,
      'planned_cost', 8000,
      'planned_hours', 80
    ),
    'human',
    v_actor
  );

  perform public.append_event(
    v_org,
    'budget_line',
    v_budget_tm,
    'budget_line.created',
    jsonb_build_object(
      'engagement_id', v_eng_tm,
      'label', 'Integration engineering',
      'budget_hours', 80,
      'rate', 225,
      'cost_rate', 105
    ),
    'human',
    v_actor
  );

  perform public.append_event(
    v_org,
    'time_entry',
    gen_random_uuid(),
    'time_entry.logged',
    jsonb_build_object(
      'engagement_id', v_eng_tm,
      'budget_line_id', v_budget_tm,
      'hours', 72,
      'person', 'Integration Team',
      'cost_rate', 105,
      'billable', true,
      'note', 'API, mapping, validation and integration work'
    ),
    'human',
    v_actor
  );

  perform public.append_event(
    v_org,
    'invoice',
    v_invoice_tm,
    'invoice.drafted',
    jsonb_build_object(
      'engagement_id', v_eng_tm,
      'amount', 12000,
      'lines', jsonb_build_array(
        jsonb_build_object(
          'description', 'Integration engineering',
          'amount', 9000
        ),
        jsonb_build_object(
          'description', 'Architecture and QA',
          'amount', 2000
        )
      )
    ),
    'human',
    v_actor
  );


  -- ==========================================================
  -- ENGAGEMENT 3
  -- Northstar Operations Retainer
  --
  -- Healthy low-burn engagement included so the demo is not merely
  -- a wall of red alerts.
  -- ==========================================================

  perform public.append_event(
    v_org,
    'engagement',
    v_eng_retainer,
    'engagement.created',
    jsonb_build_object(
      'name', 'Northstar Operations Retainer',
      'client', 'Northstar Logistics',
      'fee_model', 'retainer',
      'fee_amount', 15000,
      'planned_cost', 6500,
      'planned_hours', 60
    ),
    'human',
    v_actor
  );

  perform public.append_event(
    v_org,
    'budget_line',
    v_budget_retainer,
    'budget_line.created',
    jsonb_build_object(
      'engagement_id', v_eng_retainer,
      'label', 'Operations support',
      'budget_hours', 60,
      'rate', 250,
      'cost_rate', 100
    ),
    'human',
    v_actor
  );

  perform public.append_event(
    v_org,
    'time_entry',
    gen_random_uuid(),
    'time_entry.logged',
    jsonb_build_object(
      'engagement_id', v_eng_retainer,
      'budget_line_id', v_budget_retainer,
      'hours', 20,
      'person', 'Operations Team',
      'cost_rate', 100,
      'billable', true,
      'note', 'Monthly operations support and optimization'
    ),
    'human',
    v_actor
  );


  raise notice 'Signet demo workspace seeded successfully.';
end;
$$;