-- ============================================================
-- 00010: authenticated read access for deterministic projections.
-- ============================================================

alter table public.proj_engagements enable row level security;
drop policy if exists proj_engagements_read on public.proj_engagements;
create policy proj_engagements_read
on public.proj_engagements
for select
to authenticated
using (org_id = (auth.jwt() ->> 'org_id')::uuid);

alter table public.proj_budget_lines enable row level security;
drop policy if exists proj_budget_lines_read on public.proj_budget_lines;
create policy proj_budget_lines_read
on public.proj_budget_lines
for select
to authenticated
using (org_id = (auth.jwt() ->> 'org_id')::uuid);

alter table public.proj_invoices enable row level security;
drop policy if exists proj_invoices_read on public.proj_invoices;
create policy proj_invoices_read
on public.proj_invoices
for select
to authenticated
using (org_id = (auth.jwt() ->> 'org_id')::uuid);

alter table public.proj_change_orders enable row level security;
drop policy if exists proj_change_orders_read on public.proj_change_orders;
create policy proj_change_orders_read
on public.proj_change_orders
for select
to authenticated
using (org_id = (auth.jwt() ->> 'org_id')::uuid);

grant select on table
  public.proj_engagements,
  public.proj_budget_lines,
  public.proj_invoices,
  public.proj_change_orders
to authenticated;

revoke all on table
  public.proj_engagements,
  public.proj_budget_lines,
  public.proj_invoices,
  public.proj_change_orders
from anon;

revoke insert, update, delete, truncate, references, trigger on table
  public.proj_engagements,
  public.proj_budget_lines,
  public.proj_invoices,
  public.proj_change_orders
from authenticated;
