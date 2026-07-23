# ADR-009 — Settlement remains inspectable even when synchronous

- Status: Accepted
- Decision authority: Sol, post-Packet-000 executive decision
- Recorded: 2026-07-22

## Context

Fast local settlement may make `accepted_pending_settlement` visually brief,
but hiding the boundary teaches people that review approval itself released
value and progression.

## Decision

The accepted entitlement, settlement commitment, and completion are separately
inspectable states and receipts. A UI may advance synchronously when settlement
succeeds immediately, but history and formal state must show every boundary.

## Consequences

Approval never releases value, unlocks dependencies, or offers continuations.
Operational latency does not change the canonical model.

## Reversal strategy

Presentation timing may change; the durable states and receipt chain may not be
collapsed without constitutional amendment.
