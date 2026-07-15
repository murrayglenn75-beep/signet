# Signet

Signet — margin & delivery-risk engine for service firms, built on a **verified
operations kernel**: an append-only, hash-chained event log is the only
source of truth. Signals are computed deterministically with evidence
pointers. AI narrates over signals — it never touches raw state.

**Signals before AI. Truth → state → judgment → enforcement → proof → narration.**

## Architecture

- `docs/phase1-spec.md` — full Phase 1 design (read this first)
- `CLAUDE.md` — build invariants and order for agent-assisted development
- `supabase/migrations/` — the kernel. 00002/00003/00007 are fully specified;
  00004/00005/00006 are skeletons with TODOs
- `tests/acceptance.test.ts` — the seven tests that define done

## Quickstart

```bash
npm install
supabase start          # local Postgres on 54322
supabase db reset       # apply migrations
npm test                # 7 acceptance tests — failing until kernel is built
```

## Status

- [ ] Test 1 — events append-only
- [ ] Test 2 — hash chain detects corruption
- [ ] Test 3 — projections rebuild identically from replay
- [ ] Test 4 — chain linear under concurrent writers
- [ ] Test 5 — Change-Order Gate (silent scope absorption impossible)
- [ ] Test 6 — AI role scoped to signals + trust_ledger only
- [ ] Test 7 — signal evidence sums to computed values
