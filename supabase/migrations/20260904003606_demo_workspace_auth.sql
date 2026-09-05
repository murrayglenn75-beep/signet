-- ============================================================
-- Demo workspace authentication boundary
--
-- Goals:
--   1. Stop assigning every authenticated user to one hard-coded org.
--   2. Source org_id from protected auth app_metadata.
--   3. Add an explicit demo_mode JWT claim.
--   4. Preserve the existing production account during migration.
--   5. Fail closed when a user has no org assignment.
--
-- Public signup remains disabled. Users are provisioned deliberately.
-- ============================================================

-- ----------------------------------------------------------------
-- Preserve existing production users.
--
-- At the time this migration was created, production contains one
-- existing authenticated user. Any existing user without an org_id
-- is assigned to the original Signet production organization.
--
-- Future users must be provisioned with an explicit org_id.
-- ----------------------------------------------------------------

update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'org_id', '00000000-0000-0000-0000-000000000001',
    'demo_mode', false
  )
where coalesce(raw_app_meta_data ->> 'org_id', '') = '';

-- Ensure existing non-demo users have an explicit demo flag.
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('demo_mode', false)
where raw_app_meta_data -> 'demo_mode' is null;


-- ----------------------------------------------------------------
-- Custom Access Token hook
--
-- Supabase Auth provides app_metadata in event.claims.
-- org_id therefore comes from server-controlled user app_metadata,
-- rather than being hard-coded for every user.
--
-- demo_mode is copied into a top-level claim so application/database
-- boundaries can distinguish portfolio-demo sessions.
--
-- Missing org_id fails closed: no valid tenant-scoped JWT is issued.
-- ----------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  claims       jsonb;
  app_metadata jsonb;
  org_id_text  text;
  demo_mode    boolean;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);

  app_metadata :=
    coalesce(claims -> 'app_metadata', '{}'::jsonb);

  org_id_text :=
    nullif(app_metadata ->> 'org_id', '');

  if org_id_text is null then
    raise exception
      'custom_access_token_hook: user has no org_id assignment'
      using errcode = '42501';
  end if;

  -- Validate the tenant identifier before adding it to the JWT.
  begin
    perform org_id_text::uuid;
  exception
    when invalid_text_representation then
      raise exception
        'custom_access_token_hook: user has malformed org_id assignment'
        using errcode = '42501';
  end;

  demo_mode :=
    coalesce((app_metadata ->> 'demo_mode')::boolean, false);

  claims :=
    jsonb_set(
      claims,
      '{org_id}',
      to_jsonb(org_id_text),
      true
    );

  claims :=
    jsonb_set(
      claims,
      '{demo_mode}',
      to_jsonb(demo_mode),
      true
    );

  return jsonb_build_object('claims', claims);
end;
$$;


-- ----------------------------------------------------------------
-- Auth Hook permissions
--
-- Supabase Auth may execute the hook.
-- Browser roles may not call it directly.
-- ----------------------------------------------------------------

grant usage on schema public to supabase_auth_admin;

grant execute
  on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;

revoke execute
  on function public.custom_access_token_hook(jsonb)
  from public, authenticated, anon;