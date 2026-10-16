# Reusable engineering decisions and agent safeguards

A decision should be reusable only with its originating context, evidence, constraints, tests and security boundary.

For each reusable unit, record its interface, version, owner, dependencies, accepted inputs, excluded cases, threat model, migration path and reproducible verification. Agent-assisted actions remain proposed until authorized and verified. Preserve exact-action permissions, auditability, least privilege and separate verification.

## First adoption slice
1. Inventory user action -> validation -> identity -> DB policy and locate blind spots.
2. Capture structured failures from existing tests with linked reproducible evidence.
3. Convert successful fixes into versioned, independently tested skills, not undocumented prompts.
4. Use specialized analysis/build/test roles but prevent any role from approving its own sensitive action.
5. Add contract tests for attempted cross-user access, ambiguous retries and malformed tool results.

## Success criteria
A fresh engineer or agent can safely reuse one audited workflow without copying private context or bypassing authority controls. No operational rollout claimed in this document.
