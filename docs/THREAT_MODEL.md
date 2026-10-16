# Signet Threat Model

Signet uses MITRE ATT&CK as a threat-model input, not as a certification claim.

## Security invariants

- Authentication never implies cross-organization authorization.
- Browser clients cannot directly read or mutate the authoritative event table.
- Authoritative state changes pass through constrained command/event boundaries.
- The demo workspace is read-only.
- The AI narration layer has no mutation authority.
- Trust Ledger evidence is tamper-evident, not tamper-proof against a malicious database administrator.
- Transient infrastructure recovery never weakens JWT validation, RLS, or command authorization.

## ATT&CK-informed scenarios

| Technique | Signet scenario | Control / evidence |
| --- | --- | --- |
| T1190 Exploit Public-Facing Application | malformed or hostile web/API input | validation, command boundaries, negative tests |
| T1078.004 Valid Accounts: Cloud Accounts | valid compromised account attempts cross-org access | org-scoped JWT claims, RLS, cross-org tests |
| T1528 Steal Application Access Token | stolen valid token attempts privileged operations | authorization remains server/database enforced; tokens are never logged |
| T1552.001 Unsecured Credentials: Credentials In Files | secret committed to source/docs/build inputs | security gate scans tracked source and build configuration |
| T1213.006 Data from Information Repositories: Databases | authenticated bulk/cross-org collection | RLS, no direct events read, org-scoped ledger RPCs |
| T1565 Data Manipulation | alter authoritative history or derived state | append-only event kernel, controlled commands, deterministic rebuild |
| T1485 Data Destruction | loss/corruption of derived state | event-stream rebuild and recovery verification |
| T1496.004 Compute Hijacking: Cloud Service Hijacking | abuse AI/cloud resources | constrained AI surface, no mutation authority, bounded resource design |

## PGRST303 resilience boundary

Signet recognizes only the exact PostgREST transient:

- code: `PGRST303`
- message: `JWT issued at future`

Only idempotent read factories may use the recovery helper. The default delays are 750 ms and 2250 ms, for three total attempts. All other errors fail immediately. Signet does not refresh/rewrite JWTs, bypass RLS, use a service-role fallback, or replay writes.

Recovery telemetry contains classification, attempt number, delay, and recovery state only. It must never include JWTs, cookies, authorization headers, passwords, or service-role credentials.

## Release-failing conditions

Any cross-org data disclosure, unauthorized effect, demo mutation, event-history mutation, authority bypass, secret disclosure, non-allowlisted authentication retry, mutation replay, or Trust Ledger integrity failure blocks release.
