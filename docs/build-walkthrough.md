# Signet — Phase 1 Build Walkthrough

**Signet** is a margin & delivery-risk engine for service firms built on a
verified operations kernel: an append-only, hash-chained event log is the only
source of truth. Signals are computed deterministically with evidence pointers;
AI narrates over signals and never touches raw state. Every record carries its
seal.

This walkthrough takes you from an empty GitHub repo to seven green acceptance
tests, a working Trust Ledger, and the 30-second demo. Follow in order. Each
step has: what you do, what you tell Claude Code (copy-paste prompts in
blockquotes), and how you verify before moving on.

**Rule of the build:** never advance past a step with a red checkpoint. The
whole point of this architecture is that state is verifiable — practice that
discipline on the build itself.

---

## Step 0 — Prerequisites (~20 min, once)

Install and verify:

```bash
node --version        # ≥ 20
docker --version      # Docker Desktop running (Supabase local needs it)
npm i -g supabase     # or brew install supabase/tap/supabase
supabase --version    # ≥ 1.200
claude --version      # Claude Code CLI installed and authenticated
```

**Checkpoint:** all four commands print versions; Docker Desktop is running.

---

## Step 1 — Repo setup (~10 min)

1. On GitHub: **New repository** → `signet`. Private. Do **not** initialize
   with a README, .gitignore, or license — the scaffold has all three, and an
   initialized repo forces a merge on first push.
2. Quick name hygiene while you're at it: confirm the `signet` name is free
   where you care (npm, domain/subdomain like `signet.signalworks.*`).
3. Unzip the scaffold, initialize, push:

```bash
unzip signet-scaffold.zip && cd signet
git init && git add -A
git commit -m "Scaffold: kernel spec, migrations 1-7, acceptance suite"
git branch -M main
git remote add origin git@github.com:<you>/signet.git
git push -u origin main
npm install
```

4. Read `CLAUDE.md` yourself once, top to bottom. You're about to hold Claude
   Code to it; know what it says.

Keep the old Margin Desk repo — rename it `margin-desk-legacy` and archive it.
You'll raid it in Step 8 for Signalworks UI components and design tokens, but
its write paths are exactly what Signet exists to escape, so nothing from it
enters the kernel steps.

**Checkpoint:** repo on GitHub, `npm install` clean, constitution read.

---

## Step 2 — Boot the local stack, confirm the suite fails correctly (~10 min)

```bash
supabase start        # first run pulls images; takes a few minutes
supabase db reset     # applies migrations 00001–00007
npm test
```

Expected right now:

- Migrations 00001–00003 and 00007 apply cleanly (they're fully written).
- 00004–00006 apply (tables exist) but reducers/RPC are TODO stubs.
- **Tests 1 and 2 may already pass** (events hardening + chain are complete).
- Tests 3–7 fail with "function append_event does not exist" or similar.

That failure pattern is correct — it's the map of what's left.

**Checkpoint:** `supabase db reset` exits 0; test output shows the expected
split. If a *migration* errors, fix that before anything else (likely a
Supabase CLI version quirk — see Troubleshooting).

Commit: `git commit -am "Local stack boots; suite fails as designed"`

---

## Step 3 — Claude Code session 1: the write path (`append_event`) (~half day)

Start Claude Code in the repo root: `claude`

Paste:

> Read CLAUDE.md and docs/phase1-spec.md fully before writing anything.
> Implement migration 00006_append_event.sql: the `append_event()` RPC per
> spec §3.3 and §6, but **stub the Change-Order Gate for now** (leave a
> clearly-marked `-- GATE: implemented in a later step` comment where it goes).
> Include payload schema validation per event type — reject unknown event
> types and missing required keys with clear errors.
> Do not touch projections or signals yet. Verify with `supabase db reset`,
> then confirm the append helper in tests/acceptance.test.ts can insert an
> event (write a tiny throwaway script if useful, delete it after).
> Do not modify any test.

Why gate-last: the gate depends on projections (it reads `hours_logged` and
`approved_co_hours`), which don't exist yet. Write path → read models →
enforcement matches the dependency order.

**Checkpoint:**
```bash
supabase db reset && npm test
```
Tests 1, 2 pass. Tests 3–7 now fail on *missing reducers*, not missing RPC.
Review the diff yourself before committing — especially that `append_event`
is `security definer` and that nothing was granted beyond `execute` to
`authenticated`.

Commit: `git commit -am "append_event RPC with payload validation (gate stubbed)"`

---

## Step 4 — Session 2: reducers + replay (test 3) (~half day)

> Implement migration 00004: the `apply_event(e events)` reducer, the live
> fan-out trigger on events insert, `rebuild_projections(p_org uuid)`, and the
> proj_invoices / proj_change_orders tables per spec §3.3–§4.
> Constitution invariant 3 is the critical constraint: apply_event is the ONLY
> reducer, called by BOTH the live trigger and the rebuild loop. One code path.
> Target: make acceptance test 3 pass without breaking 1, 2, or 4.
> Run `supabase db reset && npm test` yourself and iterate until green.
> Do not modify any test.

Watch for the classic failure: Claude writing slightly different logic in the
rebuild loop than the live path. If test 3 fails on a subtle diff (e.g.
`last_activity_at` or numeric rounding), that's almost always a forked code
path or a `now()` leaking into a reducer. Reducers must derive everything
from the event row (`occurred_at`, payload) — never from wall-clock time.

**Checkpoint:** tests 1–4 pass (4 should come free with 2+3 — the chain
trigger already serializes; if 4 flakes, see Troubleshooting: advisory locks).

Commit: `git commit -am "Reducers + replay: projections rebuild deterministically"`

---

## Step 5 — Session 3: the signal engine (test 7) (~half day)

> Implement migration 00005: `recompute_signals(p_stream_type, p_stream_id)`
> with the five signal rules and exact thresholds in spec §5. Wire it into the
> events fan-out (after apply_event). Requirements:
> - evidence_seqs must contain the exact event seqs that justify each signal
>   (for OVER_BUDGET: the time_entry.logged events on that budget line).
> - detail must contain the computed numbers (hours_logged, budget_hours, burn_pct).
> - Signals clear (set cleared_at) when their condition no longer holds.
> - Deterministic: recomputing twice with no new events changes nothing.
> Target: make test 7 pass without breaking 1–4. Do not modify any test.

**Checkpoint:** tests 1–4 and 7 pass. Then eyeball one signal row in Studio
(`supabase status` prints the Studio URL, usually :54323): open `signals`,
pick the OVER_BUDGET row, and manually check its `evidence_seqs` against
`events`. You're about to demo this to humans — verify it by hand once.

Commit: `git commit -am "Signal engine: five deterministic signals with evidence"`

---

## Step 6 — Session 4: the Change-Order Gate (test 5) (~2–3 hours)

> Implement the Change-Order Gate inside append_event per spec §6, replacing
> the stub. Semantics:
> - Fires on time_entry.logged for fixed-fee engagements only.
> - Rejects if the entry pushes hours_logged past 1.10 × planned_hours net of
>   approved_co_hours, with a structured error containing "CHANGE_ORDER" and
>   the deficit.
> - Passes if payload.override.change_order_id references a change order with
>   a decided event (approve OR absorb) covering the hours.
> - Absorbing is allowed; silent absorbing is not — the decision must already
>   exist as an event.
> Target: make test 5 pass without breaking 1–4 or 7. Do not modify any test.

**Checkpoint:** tests 1–5 and 7 green. Manual sanity check: try to log
over-budget hours on a fixed-fee engagement via the RPC yourself and read the
error message — it should be clear enough that a non-engineer PM would
understand what to do next. If it's cryptic, have Claude improve the message
(that error text IS the product experience).

Commit: `git commit -am "Change-Order Gate: silent scope absorption impossible"`

---

## Step 7 — Session 5: AI boundary + narration events (test 6) (~2 hours)

> Verify migration 00007 applies and make acceptance test 6 pass. On local
> Supabase you may need `grant ai_narrator to postgres;` so the test harness
> can SET ROLE — if so, add it to 00007 guarded by a role-existence check.
> Then add the 'ai.narrated' event type to append_event's taxonomy per spec
> §7: payload {signal_ids[], model, prompt_hash, output_hash}, actor_type 'ai'.
> Do not build the actual Claude API call yet — just the event plumbing.
> Do not modify any test.

**Checkpoint:** **all seven tests green.** Run the suite three times in a row
(the concurrency test must be stable, not lucky).

```bash
npm test && npm test && npm test
```

Commit + tag: `git commit -am "Kernel complete: 7/7 acceptance" && git tag kernel-v1`

This tag is your demo fallback. Everything after this is UI; the kernel is done.

---

## Step 8 — Session 6: Trust Ledger UI (~1–2 days)

Now, and only now, the Next.js app. Two screens per spec §8. Port the
Signalworks tokens and any reusable components from `margin-desk-legacy` here.

> Scaffold a Next.js 14 (App Router, TypeScript) app in /app of this repo,
> connected to local Supabase. Signalworks Instrument Panel system: near-black
> ground, IBM Plex Mono for all data/hashes/seqs, Signal Amber as the SOLE
> action accent. Build:
> 1. /ledger — reverse-chron event stream from trust_ledger: seq, event_type,
>    actor badge (human/system/ai), truncated hash with copy, chain-status pip.
>    A "Verify chain" button calling verify_chain() that renders either
>    all-green or the first broken seq in red.
> 2. Signal board — active signals as flags; tapping one opens a provenance
>    drawer listing its evidence events (join evidence_seqs → events) with
>    hashes. This is Signet's signature interaction: flag → evidence → seal.
> All reads via the anon/authenticated client through RLS. Zero write paths
> in the UI except calls to the append_event RPC.

**Checkpoint:** the 30-second demo works end-to-end locally (script below).

Commit: `git commit -am "Trust Ledger UI: flag → evidence → seal → verified"`

---

## Step 9 — Deploy (~2 hours)

1. `supabase link --project-ref <ref>` → `supabase db push` (migrations to
   hosted project).
2. Re-run the acceptance suite against hosted:
   `DATABASE_URL=<hosted-pooler-url> npm test` — same seven tests, production
   database. (Use a throwaway org UUID; the suite writes events.)
3. Vercel: import the `signet` repo, set `NEXT_PUBLIC_SUPABASE_URL` / anon
   key, deploy.
4. **Vercel Deployment Protection: set it correctly now.** This exact setting
   cost a demo once — make it part of the deploy checklist, then load the URL
   in an incognito window from your phone to confirm it's reachable the way a
   prospect would reach it.

**Checkpoint:** hosted URL loads in incognito on mobile; Verify Chain returns green.

---

## Step 10 — The 30-second demo script

Rehearse until it's muscle memory:

1. Open the signal board: *"These flags aren't AI opinions — they're computed.
   Here's an OVER_BUDGET."*
2. Tap it → provenance drawer: *"Every flag carries its evidence — these exact
   time entries, these exact hours. They sum. Check them."*
3. Ledger view, hit **Verify chain** → green: *"And the history they come from
   is sealed. Nobody edited it after the fact — not us, not the AI. That's
   why it's called Signet."*
4. The kicker, live in SQL (or a pre-recorded 10s clip): tamper with one old
   event as superuser, re-verify → red from that seq. *"If anyone ever does,
   it shows."*
5. Close: *"AI narrates on top of this. It can't see anything that isn't
   already proven."*

---

## Troubleshooting

- **Migration fails on `revoke ... from authenticated`:** roles exist only
  after Supabase's own bootstrap; use `supabase db reset` (which bootstraps
  first), not raw psql against bare Postgres.
- **Test 4 flakes under concurrency:** the `for update` on the last chain row
  can deadlock-retry under high parallelism. Switch to
  `pg_advisory_xact_lock(hashtext(new.org_id::text))` at the top of
  `chain_event()` — spec §11 anticipates this.
- **Test 3 diff on numerics:** cast consistently (`numeric(8,2)` for hours) in
  the reducer, and never compute values from `now()` inside `apply_event`.
- **Test 6 permission oddities:** `grant ai_narrator to postgres;` locally;
  on hosted, create a dedicated connection for the narrator instead of SET ROLE.
- **Claude Code proposes editing a test:** the answer is no, per CLAUDE.md.
  If it argues the test is wrong, make it state the reasoning in plain terms
  and evaluate yourself before touching anything.
- **Claude Code proposes disabling the append-only trigger "temporarily":**
  hard no. That's invariant 2, and it's the one that matters most.

---

## Definition of done, Phase 1

- [ ] 7/7 acceptance tests green, three consecutive runs, local
- [ ] 7/7 green against hosted Supabase
- [ ] Ledger + signal board deployed on Vercel, reachable in incognito
- [ ] 30-second demo rehearsed with the tamper kicker
- [ ] `kernel-v1` tag pushed
