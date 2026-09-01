# Signet

**Verified operations infrastructure for service firms.**

Signet is a margin and delivery-risk engine built around a verified operations kernel. An append-only, hash-chained event log is the source of truth. Operational projections and risk signals are computed deterministically, while AI is restricted to read-only narration over approved evidence.

> **Signals before AI. Truth → state → judgment → enforcement → proof → narration.**

## What Signet does

Signet turns delivery operations into a verifiable system of record:

- tracks engagements, budget consumption, time, invoices, and change orders
- computes margin and delivery-risk signals deterministically
- blocks silent fixed-fee scope overrun behind an explicit change-order gate
- links every signal to exact evidence events
- maintains a tamper-evident hash chain across the operational ledger
- restricts AI to signal/evidence narration rather than operational authority
- enforces authenticated organization and actor identity at the database write boundary

## Product views

The current Next.js interface includes:

- **Command Center** — portfolio margin, revenue at risk, unbilled work, engagement health, active signals, and read-only AI narration
- **Engagements** — deterministic commercial projections across active work
- **Signals** — risk findings with event-level evidence
- **Change Orders** — explicit approve / absorb / decline scope decisions
- **Trust Ledger** — event history, chain status, actor identity, and hash evidence

Routes:

```text
/
├── /engagements
├── /signals
├── /change-orders
└── /trust-ledger
```

## Architecture

```text
Next.js UI
    │
    ▼
append_event RPC
    │
    ▼
┌──────────────────────────────────────┐
│  Append-only events                  │
│  SHA-256 hash chain                  │
│  Per-organization serialization      │
└──────────────────────────────────────┘
    │
    ├───────────────┬───────────────────┐
    ▼               ▼                   ▼
Projections      Deterministic       Trust Ledger
                 Signals
    │               │                   │
    └───────────────┴──────────────┐    │
                                   ▼    ▼
                              AI Narrator
                            read-only evidence
```

The event log is the only writable operational surface. Projections, signals, and evidence views are derived from it.

## Core invariants

1. **Events are append-only.** Application flows never update or delete historical events.
2. **One deterministic reducer.** Live projection and replay use the same state transition logic.
3. **Signals are deterministic.** The LLM cannot create, modify, or clear operational signals.
4. **Evidence is explicit.** Signals carry exact `evidence_seqs` back to ledger events.
5. **Scope authority is explicit.** Fixed-fee overrun is blocked unless a valid commercial decision is recorded.
6. **AI has no operational authority.** The narrator can read approved signal/evidence surfaces only.
7. **Corrections use compensating events.** Historical truth is never silently rewritten.

## Security hardening

The current write boundary adds:

- authenticated organization binding
- authenticated actor binding
- rejection of caller-supplied identity spoofing
- cross-organization time-entry reference checks
- serialized fixed-fee gate evaluation
- finite approved change-order allowance
- no arithmetic bypass through an override flag
- AI actor/event boundary enforcement

The security regression suite verifies:

- cross-org append attempts fail
- actor spoofing fails
- authenticated actor identity is derived from the session
- cross-org engagement references fail
- a small approved change order cannot become unlimited authorization
- concurrent fixed-fee entries cannot jointly bypass the gate

## Verification status

Current local verification:

```text
Test files: 2 passed
Tests:      15 / 15 passed

Phase 1 acceptance:      10 / 10
Security hardening:       5 / 5

npm audit:                0 vulnerabilities
Production build:         PASS
TypeScript:               PASS
Static routes:            5 application routes generated
```

The test suite is repeatable without requiring a database reset between runs.

## Trust model

Signet uses a PostgreSQL hash chain to make operational-history tampering **detectable** under the tested application model.

This is **tamper-evident**, not tamper-proof against a malicious database administrator or infrastructure owner. External WORM storage, independently signed checkpoints, and third-party timestamping are outside the current phase.

## AI boundary

AI is intentionally downstream of deterministic state.

The narrator can explain:

- why a signal exists
- which evidence supports it
- what operational decision is required

It does **not** determine financial state, authorize scope, mutate projections, or become the system of record.

```text
Deterministic state → deterministic signal → approved evidence → AI explanation
```

## Stack

- **Next.js 16**
- **React / TypeScript**
- **Supabase**
- **PostgreSQL**
- **Vitest 4**
- **Lucide React**
- **SHA-256 / pgcrypto**
- **pg_cron** for time-decay signal recomputation

## Local development

Prerequisites:

- Node.js
- Docker Desktop
- Supabase CLI

Start Supabase:

```bash
supabase start
```

Reset and apply migrations:

```bash
supabase db reset
```

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Run verification:

```bash
npm test
npm audit
npm run build
```

## Database migrations

```text
00001_extensions.sql
00002_events.sql
00003_chain.sql
00004_projections.sql
00005_signals.sql
00006_append_event.sql
00007_ai_role.sql
00008_ui_read_access.sql
00009_security_hardening.sql
```

## Phase scope

This repository currently represents a **portfolio/reference implementation of a verified operations kernel**.

It is not presented as:

- formal verification
- universal tamper resistance
- enterprise production certification
- multi-tenant SaaS isolation proof
- a replacement for independent financial controls

The current polished UI uses local demo presentation data while the underlying database kernel and security tests are real. Wiring the interface directly to live Supabase projections, signals, ledger evidence, and RPC actions is the next product-integration step.

## Design philosophy

Most operational AI systems start with the model.

Signet starts with authority.

The system first establishes:

- what happened
- who did it
- which organization owns it
- what state follows from it
- what evidence supports a signal
- whether an action is authorized

Only then does AI narrate the result.

---

**Signet — deterministic operations, verifiable evidence, constrained AI.**
