-- Restore access to pgcrypto for hash-chain functions while keeping
-- an explicit, pinned search_path.

alter function public.chain_event()
  set search_path = public, extensions, pg_catalog;

alter function public.verify_chain(uuid)
  set search_path = public, extensions, pg_catalog;
