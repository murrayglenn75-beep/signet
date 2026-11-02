# Independent design review and verification

For significant changes, document the intended behavior, exact affected interfaces, acceptance tests, security implications and rollback before implementation.

## Review stages

1. Design session produces a written specification without changing production behavior.
2. A fresh-context reviewer checks whether the specification is understandable and complete.
3. An independent reviewer challenges assumptions, failure modes and unintended consequences.
4. The owner approves the scope before implementation.
5. Implementation is checked against the approved specification and independent test evidence.

## Project-specific checks

Require verifiable event provenance, tamper-detection checks, deterministic signal behavior, negative tests for unauthorized actions, and clear distinction between AI narration and audited facts.

Never let a reviewing model grant itself permissions or certify its own result. Store evidence and rollback instructions. For model experiments, use nanochat only in an isolated research environment; no production model replacement without benchmarks.

References:
- https://github.com/google/elephant-goldfish-model
- https://github.com/karpathy/nanochat

This is a process specification, not an automated enforcement implementation.
