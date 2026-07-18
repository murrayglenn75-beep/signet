-- ============================================================
-- 00008: UI read access — authenticated, RLS-scoped, never anon.
-- New migration; 00001-00007 untouched. Upholds "RLS is the security
-- boundary" the same way events (00002) already does.
--
-- Why this exists: the Trust Ledger UI (spec §8) needs to read signals
-- and trust_ledger, but 00007 only ever granted those to ai_narrator —
-- there was no read path for a human/browser client at all. Two real
-- gaps found before granting anything broader:
--   * signals (00005) never had row level security enabled at all — a
--     blanket grant would have handed every org's signals to anyone.
--   * trust_ledger (00007) is a plain view with no security_invoker, so
--     by default it runs with the VIEW OWNER's privileges — a query
--     against it bypasses events' RLS (00002) entirely regardless of
--     who's asking, even though the underlying table is protected.
-- Both are fixed below before anything is granted.
--
-- trust_ledger's fix is NOT security_invoker=true. Tried that first: it
-- makes the view subject to events_read (00002), but it ALSO means the
-- underlying `events` table privilege check runs as the CALLING role —
-- and ai_narrator has never held (and per invariant 4 must never hold) a
-- direct grant on events. Turning security_invoker on breaks ai_narrator
-- with "permission denied for table events" before RLS is even
-- evaluated (caught by test 6, not guessed past). Fixed instead by
-- redefining the view itself (below) with a role-aware WHERE clause: it
-- stays owner-privileged (no direct events grant needed by anyone), and
-- does its own scoping — unrestricted for ai_narrator (its existing,
-- correct behavior, preserved exactly), org-scoped for authenticated.
-- ============================================================

-- signals never had RLS. Add it, mirroring events_read (00002) — scoped
-- explicitly `to authenticated`, unlike events_read, because signals
-- (unlike events) is also granted directly to ai_narrator (00007) with
-- no JWT/org_id claim to check (a raw SET ROLE, not a Supabase Auth
-- session) — an unscoped policy would silently block that existing,
-- already-correct grant instead of just gating the new UI read path.
alter table signals enable row level security;
create policy signals_read on signals for select
  to authenticated
  using (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- Access policy note: this view's access control lives HERE, in the
-- view body, not as an RLS policy — trust_ledger has no row in
-- pg_policies. A future reader auditing "who can see the ledger and
-- why" needs to read this WHERE clause, not just grep pg_policies.
--
-- Three deliberate properties:
--   1. ai_narrator check is exact role identity (`current_user =
--      'ai_narrator'`), not a prefix/pattern/membership check — no other
--      role, however named, can satisfy this branch.
--   2. authenticated branch is byte-identical to events_read's condition
--      (00002): `org_id = (auth.jwt() ->> 'org_id')::uuid`. Same claim,
--      same cast, same comparison — this view's org-scoping can never
--      drift from the source of truth for what "your org" means.
--   3. Default-deny: any role that is neither ai_narrator nor a session
--      with a matching org_id claim satisfies NEITHER branch, and NULL/
--      false from a missing claim never matches a row — zero rows,
--      never all rows. There is no fallback branch that admits anyone.
create or replace view trust_ledger as
  select seq, event_id, org_id, stream_type, stream_id, event_type,
         actor_type, actor_id, occurred_at, prev_hash, hash
  from events
  where current_user = 'ai_narrator'
     or org_id = (auth.jwt() ->> 'org_id')::uuid;

grant select on signals to authenticated;
grant select on trust_ledger to authenticated;
-- Never anon. anon has no session and so no org_id claim — no row would
-- match signals_read/events_read anyway — but the grant itself is
-- withheld on principle, not left to RLS alone to save us.

-- Single-tenant Phase 1 (spec §1: "single-tenant per Supabase project
-- for now"): stamp a fixed org_id onto every issued JWT via a custom
-- access token hook, so the browser can reach a real `authenticated`
-- session — and so pass signals_read/events_read/trust_ledger's RLS —
-- via Supabase anonymous sign-in, with no login screen to build. This is
-- the same hook mechanism hosted Supabase uses; multi-tenant Phase 2
-- replaces the fixed UUID with a real per-user org lookup, not the hook
-- mechanism itself.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  claims jsonb;
begin
  claims := event->'claims';
  claims := jsonb_set(claims, '{org_id}', '"00000000-0000-0000-0000-000000000001"');
  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
