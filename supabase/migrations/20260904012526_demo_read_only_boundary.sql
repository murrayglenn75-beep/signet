-- ============================================================
-- Demo workspace read-only boundary
--
-- Security goal:
--   Authenticated sessions carrying demo_mode=true may read their
--   isolated organization, but may not mutate kernel or command state.
--
-- Enforcement is database-side. The UI is not trusted as the security
-- boundary.
--
-- Trusted DB/service/test contexts without a Supabase authenticated JWT
-- remain able to seed demo data through append_event().
-- ============================================================


-- ----------------------------------------------------------------
-- Central demo-write guard.
--
-- auth.jwt() exposes the claims minted by the Custom Access Token hook.
-- Only an explicit boolean-like "true" value activates the demo guard.
--
-- Missing claim => normal trusted/production behavior.
-- ----------------------------------------------------------------

create or replace function public.reject_demo_write()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_jwt_role  text;
  v_demo_mode text;
begin
  v_jwt_role :=
    coalesce(auth.jwt() ->> 'role', '');

  v_demo_mode :=
    lower(coalesce(auth.jwt() ->> 'demo_mode', 'false'));

  if v_jwt_role = 'authenticated'
     and v_demo_mode = 'true' then
    raise exception
      'Signet demo workspace is read-only'
      using
        errcode = '42501',
        detail = 'demo_mode sessions cannot mutate operational state';
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  return NEW;
end;
$$;


-- Browser roles must never call the guard function directly.
revoke all on function public.reject_demo_write()
from public, anon, authenticated;


-- ----------------------------------------------------------------
-- Event kernel boundary.
--
-- append_event() ultimately inserts into public.events.
-- Blocking here guarantees demo sessions cannot append operational
-- history even if a future UI/API accidentally exposes a write action.
--
-- Trusted DB/test/service contexts have no authenticated demo JWT and
-- therefore remain able to seed data through the real kernel.
-- ----------------------------------------------------------------

drop trigger if exists trg_reject_demo_event_write
on public.events;

create trigger trg_reject_demo_event_write
before insert or update or delete
on public.events
for each row
execute function public.reject_demo_write();


-- ----------------------------------------------------------------
-- Change-order command boundary.
--
-- decide_change_order() reserves its idempotency key in
-- change_order_commands before appending the immutable event.
--
-- Guarding this table rejects demo decisions immediately and prevents
-- demo sessions from creating internal command-control state.
-- ----------------------------------------------------------------

drop trigger if exists trg_reject_demo_change_order_command
on public.change_order_commands;

create trigger trg_reject_demo_change_order_command
before insert or update or delete
on public.change_order_commands
for each row
execute function public.reject_demo_write();


-- ----------------------------------------------------------------
-- Defensive documentation.
-- ----------------------------------------------------------------

comment on function public.reject_demo_write()
is
'Database enforcement boundary that rejects writes from authenticated JWT sessions carrying demo_mode=true.';

comment on trigger trg_reject_demo_event_write
on public.events
is
'Prevents read-only demo sessions from mutating the append-only operational ledger.';

comment on trigger trg_reject_demo_change_order_command
on public.change_order_commands
is
'Prevents read-only demo sessions from mutating internal change-order command state.';