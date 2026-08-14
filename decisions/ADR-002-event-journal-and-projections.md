# ADR-002 — Event journal with transactional projections

- Status: Accepted
- Decision authority: Sol, executive architecture handoff
- Recorded: 2026-07-22

## Context

Federation, durable receipts, replay, concurrency, settlement idempotency, and
auditability all require ordered canonical facts. JSON export remains useful
for portability but cannot safely arbitrate concurrent writes.

## Decision

Canonical changes are immutable domain events. SQLite and Postgres implement
one journal, projection, and outbox contract.

## Consequences

Commands require expected stream versions. Projections are disposable and must
rebuild from the journal. Packet 001 defines pure events; persistence waits for
Packet 002.

## Reversal strategy

A different persistence implementation may replace the adapters if it passes
the same append, replay, projection, idempotency, and migration contracts.
