# Signet — Agent Constitution

Signet is a margin & delivery-risk engine for service firms, built on a
**verified operations kernel**: an append-only, hash-chained event log is the
only source of truth; everything else is a deterministic projection.
Full design: `docs/phase1-spec.md`. Read it before writing any code.

## Invariants — NEVER violate these

1. The `events` table is the ONLY writable surface. All state changes go
   through the `append_event()` RPC. No client, API route, or migration may
   INSERT/UPDATE/DELETE projection tables or signals directly (except the
   reducer functions themselves).
2. Never disable, drop, or work around the `events_no_update` trigger or the
   hash chain to make a test pass. If a test fails, the bug is in the code,
   not the constraint.
3. One reducer code path: `apply_event()` is called by BOTH the live insert
   trigger and `rebuild_projections()`. Never fork the logic.
4. The AI narration role (`ai_narrator`) may SELECT from `signals` and
   `trust_ledger` ONLY. Never grant it anything else. Never route AI output
   into the system except as an `ai.narrated` event via `append_event()`.
5. Signals are deterministic recomputations with `evidence_seqs`. Never write
   a signal from application code or from an LLM response.
6. Enforcement gates (Change-Order Gate) live inside `append_event()`. Never
   move gate logic to the client, and never add a bypass flag that isn't
   itself recorded as an event.
7. Events are immutable history. To correct a mistake, append a compensating
   event (`*.corrected`, `*.voided`). Never rewrite the past.

## Build order — make acceptance tests pass IN ORDER

Work through `tests/acceptance.test.ts` top to bottom. Do not skip ahead.
Do not modify a test to make it pass; if a test is genuinely wrong, stop and
say so with reasoning before touching it.

1. `00002` events table + hardening → test 1
2. `00003` chain trigger + verify_chain → tests 2, 4
3. `00004` projections + apply_event + rebuild → test 3
4. `00005` signals + recompute → test 7 (partially)
5. `00006` append_event RPC + Change-Order Gate → tests 5, 7
6. `00007` ai_narrator role → test 6
7. UI (Next.js) only after all seven pass.

## Commands

```bash
supabase start                 # local stack (Postgres on 54322)
supabase db reset              # replay all migrations from scratch — use freely
npm test                       # vitest acceptance suite
```

`supabase db reset` is cheap and always safe. Prefer it over hand-editing
database state while iterating on triggers and reducers.

## Conventions

- Migrations: numbered `NNNNN_name.sql`, forward-only, idempotent where possible.
- SQL style: lowercase keywords ok, but be consistent; every function gets a
  comment stating which invariant(s) it upholds.
- Money: `numeric`, never float. Hours: `numeric(8,2)`.
- Timestamps: `timestamptz`, UTC canonical form in hashes (see spec §3.2).
- UI: Signalworks "Instrument Panel" system — IBM Plex Mono for data/hashes,
  Signal Amber as the sole action accent. No other accent colors.
