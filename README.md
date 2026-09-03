Signet

Verified operations infrastructure for service firms.

Signet is a production-style operations control system built around a verified event kernel.

Instead of giving an LLM authority over business state, Signet establishes operational truth first through authenticated events, deterministic projections, explicit commercial decisions, and evidence-backed signals. AI is placed downstream as a read-only narration layer.

Truth → state → judgment → enforcement → proof → narration.

Live application

Production: https://signet-chi.vercel.app

The production deployment uses authenticated Supabase access and intentionally starts with an empty operational dataset unless events are recorded through the controlled event-kernel boundaries.

Why Signet exists

Operational systems increasingly add AI before establishing trustworthy state.

That creates a risky architecture:

user input → LLM → operational action

Signet reverses that model:

authenticated event
        ↓
deterministic state
        ↓
deterministic signal
        ↓
policy / authority gate
        ↓
verified evidence
        ↓
AI explanation

The LLM can explain what the system knows. It does not decide what is true.

What Signet does

Signet turns service-delivery operations into a verifiable system of record:

tracks engagements, budget consumption, time, invoices, and change orders

maintains an append-only operational event stream

hash-chains events to make tampering detectable

computes portfolio state through deterministic projections

detects margin and delivery risk without LLM judgment

blocks silent fixed-fee scope overrun behind an explicit change-order gate

records approve / absorb / decline decisions as immutable events

returns verified receipts for sensitive write operations

links risk findings to exact evidence events

isolates organizations through authenticated JWT claims and database boundaries

restricts AI to approved read-only evidence

exposes a bounded Trust Ledger without granting browser access to raw event payloads

Product views

Command Center

Portfolio-level operating view showing active engagements, portfolio margin, revenue at risk, unbilled exposure, engagement health, active signals, deterministic evidence narration, and ledger status.

Engagements

Commercial state reconstructed from authenticated Supabase projections, including fee model, margin, budget burn, unbilled exposure, scope risk, and active-client portfolio metrics.

Signals

Deterministic operating-risk findings with red / amber severity, server-side severity filtering, evidence references, engagement context, and deterministic signal state.

Change Orders

Explicit commercial authority for fixed-fee scope changes with approve / absorb / decline decisions, idempotent command execution, concurrency-safe gate evaluation, and verified immutable event receipts.

Trust Ledger

Authenticated, organization-scoped operational evidence exposing event sequence, event type, actor type, stream identity, event hash, chain window, and bounded metadata-only browser access.

The browser does not receive raw ledger payloads through this view.

Routes

/
├── /login
├── /engagements
├── /signals
├── /change-orders
└── /trust-ledger

A local-only /auth/demo route exists for development and is disabled in production.

Architecture

                        ┌──────────────────────┐
                        │      Next.js UI      │
                        │  authenticated user  │
                        └──────────┬───────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │ Command / RPC layer  │
                        │ auth + org boundary  │
                        └──────────┬───────────┘
                                   │
                                   ▼
┌───────────────────────────────────────────────────────────┐
│                    PostgreSQL Event Kernel                │
│  Append-only events                                      │
│  SHA-256 hash chain                                      │
│  Per-organization chain heads                            │
│  Authenticated actor binding                             │
│  Idempotent commands                                     │
│  Fixed-fee scope enforcement                             │
└──────────────┬────────────────┬────────────────┬───────────┘
               │                │                │
               ▼                ▼                ▼
        Projections       Deterministic      Trust Ledger
                             Signals
               │                │                │
               └────────────────┴─────────┬──────┘
                                          ▼
                                Approved evidence
                                          │
                                          ▼
                                   AI Narrator
                                    read-only

The event stream is the operational source of truth. Projections, signals, receipts, and ledger evidence are derived from controlled event boundaries.

Core invariants

Events are append-only. Application flows do not update or delete historical operational events.

State is deterministic. Projection state is reconstructed from known event transitions.

Signals are deterministic. The LLM cannot create, modify, or clear operating-risk signals.

Evidence is explicit. Signals reference exact event sequences rather than model confidence.

Identity is server-bound. Organization and actor identity come from authenticated context rather than caller-supplied authority.

Scope authority is explicit. Fixed-fee scope expansion requires a valid commercial decision.

Sensitive commands are idempotent. Retried requests cannot silently create duplicate commercial decisions.

Concurrency is considered. Concurrent fixed-fee entries cannot jointly bypass the scope gate under the tested model.

AI has no operational authority. AI receives approved evidence for narration only.

Corrections use new events. Historical operational truth is not silently rewritten.

Security model

Signet uses multiple boundaries instead of relying on the frontend for security.

Authentication

Production uses Supabase email/password authentication. Protected pages redirect unauthenticated users to /login. Production users are administrator-provisioned, and public signup is intentionally not exposed in the current single-tenant phase.

Organization boundary

Authenticated JWTs carry an org_id claim produced by a Supabase Custom Access Token Hook. Database reads and RPC operations use this claim to establish organization scope.

Write boundary

Operational writes are performed through controlled database functions rather than unrestricted client table writes.

The boundary enforces:

authenticated sessions

organization binding

actor binding

caller identity anti-spoofing

cross-organization reference protection

commercial scope policy

command idempotency

Change-order command boundary

Change-order decisions use a dedicated idempotent command path. The system reserves an idempotency key, serializes conflicting decisions, rejects conflicting reuse, returns the original sequence for safe retries, and writes the resulting decision through the event kernel.

Verified receipt boundary

Sensitive change-order commands can return a verified receipt containing sequence, event ID, event hash, occurrence timestamp, stream type, stream ID, and event type.

The browser does not need unrestricted access to the underlying events table to verify that the command produced a recorded event.

Trust Ledger boundary

The browser Trust Ledger uses a bounded authenticated RPC and returns ledger metadata only: sequence, event ID, stream identity, event type, actor identity, timestamps, previous hash, and current hash.

Raw event payloads remain outside this browser boundary.

Tamper evidence

Each event participates in a PostgreSQL SHA-256 hash chain.

event[n].hash =
SHA256(
  previous_hash
  + canonical event data
)

This allows unexpected changes to historical event state to become detectable under the tested application model.

Signet describes this as tamper-evident, not tamper-proof. A malicious database administrator or infrastructure owner remains outside the current trust model.

Potential future hardening includes independently signed checkpoints, external WORM storage, third-party timestamping, and cross-system hash anchoring.

AI boundary

AI is intentionally downstream of authority.

The narrator can explain why a signal exists, which evidence supports it, what operational condition triggered it, and what human decision may be required.

It does not determine financial truth, authorize commercial scope, mutate operational state, modify projections, create or clear signals, or become the system of record.

deterministic state
        ↓
deterministic signal
        ↓
approved evidence
        ↓
AI explanation

This is the central architectural principle behind Signet.

Technology

Application

Next.js 16

React

TypeScript

Lucide React

Vercel

Data and authentication

Supabase

PostgreSQL

Supabase Auth

Row Level Security

PostgreSQL RPC / SECURITY DEFINER functions

Event and security kernel

SHA-256

pgcrypto

append-only event architecture

deterministic reducers

idempotency keys

authenticated JWT claims

evidence-scoped RPC boundaries

Automation and verification

pg_cron

Vitest 4

GitHub Actions

Supabase CLI

Docker

Verification

Current automated verification:

Test files:       5 passed
Tests:           29 passed
Production build: PASS
TypeScript:       PASS
GitHub CI:        PASS

The test suite covers acceptance behavior, security hardening, change-order idempotency, Trust Ledger boundaries, demo-auth boundaries, authenticated identity enforcement, cross-organization protection, fixed-fee gate behavior, and verified command receipts.

GitHub Actions runs:

npm ci
npx supabase start
npx supabase db reset
npm test
npm run build

The latest production-auth and Trust Ledger commit passed CI on main.

Local development

Prerequisites:

Node.js 22+

Docker Desktop

Supabase CLI

Install dependencies:

npm install

Start local Supabase:

npx supabase start

Reset the local database and apply all migrations:

npx supabase db reset

Create .env.local with your own Supabase development values:

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

Do not commit .env.local.

Run Signet:

npm run dev

Open:

http://localhost:3000

Run verification:

npm test
npm run build
git diff --check

Production authentication

The production deployment uses administrator-provisioned Supabase users. The current architecture deliberately does not expose public self-registration.

The production Supabase project also requires the Custom Access Token Hook:

public.custom_access_token_hook

This adds the organization claim consumed by authenticated database boundaries.

After changing the hook configuration, existing users must sign out and sign back in to receive a newly minted JWT.

Database migrations

The repository contains the full migration history under:

supabase/migrations/

The migration set includes the original event kernel plus later production hardening for authenticated identity binding, organization-scoped access, change-order idempotency, verified event receipts, Trust Ledger RPC boundaries, browser-safe Trust Ledger windows, and production security advisor remediation.

Production migration history note

The final production migrations were applied through the Supabase management API because the local network could not establish the required direct IPv4 CLI database connection.

As a result, some production migration ledger timestamps differ from the local migration filenames.

Before a future production supabase db push:

compare migration names and contents

inspect remote migration history

repair migration-history metadata if required

do not blindly replay equivalent production migrations

The migration SQL in this repository remains the intended source-controlled implementation.

Deployment

Application

Production is deployed through Vercel:

https://signet-chi.vercel.app

Required Vercel environment variables:

NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

No Supabase service-role key is required by the browser application.

Database

Production database infrastructure is hosted on Supabase.

The production database may intentionally contain zero operational events after deployment. That is a valid empty production state, not demo-data failure.

Any future portfolio/demo seed data should be introduced through the event-kernel command boundaries rather than by directly inserting into projection tables.

Recovery principles

If rebuilding the application environment:

provision Supabase

apply the migration history

configure the Custom Access Token Hook

provision an authenticated user

configure Vercel public Supabase environment variables

deploy the Next.js application

sign in and verify organization claims

verify protected RPC boundaries

run the GitHub CI suite

only introduce data through controlled operational boundaries

Current scope

Signet is a portfolio/reference implementation of a security-conscious operations kernel.

It demonstrates production-oriented engineering patterns, but it is not presented as formal verification, universal tamper resistance, enterprise compliance certification, cryptographic protection from a malicious infrastructure owner, independently audited financial controls, or proof of arbitrary multi-tenant SaaS isolation.

The architecture and security claims should be interpreted within the behavior covered by the implementation and automated tests.

Engineering decisions demonstrated

Signet intentionally demonstrates more than UI implementation.

The project includes:

event-driven state architecture

PostgreSQL security boundaries

RLS-aware application design

idempotent command processing

concurrency-aware business rules

hash-chained audit evidence

deterministic risk computation

constrained AI architecture

authenticated server rendering

production deployment

CI-backed database integration testing

Design philosophy

Most AI-enabled operations systems start with the model.

Signet starts with authority.

The system establishes:

What happened?
Who performed it?
Which organization owns it?
What state follows?
What policy applies?
What evidence supports the conclusion?
Is the requested action authorized?

Only after those questions are resolved does AI enter the system.

Signet — deterministic operations, verifiable evidence, constrained AI.
