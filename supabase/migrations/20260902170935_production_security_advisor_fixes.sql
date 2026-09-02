-- Production security hardening identified by Supabase Advisor.

-- chain_heads is an internal serialization table.
-- Keep it inaccessible through the public Data API.
alter table public.chain_heads enable row level security;

revoke all on table public.chain_heads from public;
revoke all on table public.chain_heads from anon;
revoke all on table public.chain_heads from authenticated;

-- append_event is a privileged SECURITY DEFINER boundary.
-- Anonymous/public callers must never execute it.
revoke execute on function public.append_event(
  uuid,
  text,
  uuid,
  text,
  jsonb,
  text,
  text
) from public;

revoke execute on function public.append_event(
  uuid,
  text,
  uuid,
  text,
  jsonb,
  text,
  text
) from anon;

-- Signed-in callers are intentionally allowed through append_event's
-- explicit JWT org/actor validation boundary.
grant execute on function public.append_event(
  uuid,
  text,
  uuid,
  text,
  jsonb,
  text,
  text
) to authenticated;	
-- events is the immutable internal event store.
-- Application roles must use controlled views/RPC boundaries instead of
-- reading or manipulating the ledger directly.
revoke all on table public.events from public;
revoke all on table public.events from anon;
revoke all on table public.events from authenticated;