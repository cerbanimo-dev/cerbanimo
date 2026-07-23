# ADR-010 — Safe errors outrank accidental reference status codes

- Status: Accepted
- Decision authority: Sol, post-Packet-000 executive decision
- Recorded: 2026-07-22

## Context

The frozen reference returns HTTP 500 for an inert wrong-passphrase identity
import. Preserving that implementation accident would misclassify an expected,
recoverable client failure as a server fault.

## Decision

Successor errors use stable domain reason codes and safe transport mappings.
Expected authentication, passphrase, validation, conflict, stale-version, and
authorization failures are not reported as internal server errors. Error text
must not reveal secrets or cryptographic internals.

## Consequences

Compatibility preserves inertness and recoverability, not the reference's 500
status. Transport mappings remain outside the pure domain package.

## Reversal strategy

Reason-code-to-transport mappings may be versioned without changing domain
rejection semantics.
