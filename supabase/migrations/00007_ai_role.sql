-- ============================================================
-- 00007: AI narration boundary. Upholds invariant 4.
-- FULLY SPECIFIED — implement exactly as written.
-- ============================================================

-- Read model for the ledger UI and the AI layer.
create or replace view trust_ledger as
  select seq, event_id, org_id, stream_type, stream_id, event_type,
         actor_type, actor_id, occurred_at, prev_hash, hash
  from events;   -- payload deliberately excluded from AI-visible surface

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ai_narrator') then
    create role ai_narrator nologin;
  end if;
end $$;

grant usage on schema public to ai_narrator;
grant select on signals to ai_narrator;
grant select on trust_ledger to ai_narrator;
-- Nothing else. Ever. (Acceptance test 6 enforces this.)
