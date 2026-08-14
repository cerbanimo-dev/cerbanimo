# ADR-004 — Approval and settlement are separate

- Status: Accepted
- Decision authority: Sol, executive architecture handoff
- Recorded: 2026-07-22

## Context

Network retries, process crashes, and concurrent workers can otherwise release
rewards twice or unlock later work before value is durably committed.

## Decision

Approving quorum enters `accepted_pending_settlement`. A later atomic,
idempotent settlement commits effects exactly once.

## Consequences

Approval alone cannot release progression, currency, dependencies, or
continuations. Finalization follows committed settlement.

## Reversal strategy

Presentation may compress successful synchronous steps, but the durable state
boundary and idempotency guarantee remain mandatory.
