# ADR-011 — Compatibility hierarchy

- Status: Accepted
- Decision authority: Sol, post-Packet-000 executive decision
- Recorded: 2026-07-22

## Context

The frozen reference, Golden Behavior Matrix, settlement specification, and
constitution sometimes describe different architectural maturity levels.
Treating all observable implementation quirks as equally binding would preserve
known defects and prevent required successor safety boundaries.

## Decision

Conflicts resolve in this order:

1. Architectural Constitution and accepted ADRs;
2. explicit successor state machines and versioned contracts;
3. Golden Behavior Matrix observable promises;
4. frozen Reference Node behavior;
5. incidental status codes, field names, timing, and implementation details.

Intentional deviations must be named, tested, and reversible where practical.

## Consequences

The successor preserves human promises while replacing unsafe architecture and
accidental behavior.

## Reversal strategy

Changing the hierarchy requires a constitutional decision record with migration
and compatibility impact.
