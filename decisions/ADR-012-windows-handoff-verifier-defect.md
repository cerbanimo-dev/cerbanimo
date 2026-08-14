# ADR-012 — Windows handoff verifier defect

- Status: Accepted
- Decision authority: Sol, post-Packet-000 executive decision
- Recorded: 2026-07-22

## Context

On the supported Windows Node runtime, `VERIFY-HANDOFF.mjs` verifies all handoff
checksums and then fails with `EINVAL` while spawning `npm.cmd`. Running the
underlying Open Work Graph test directly passes.

## Decision

Record this as a verifier portability defect, not a reference-integrity failure.
The frozen handoff remains unchanged. Successor verification runs the equivalent
checksum and bridge commands directly and reports the wrapper failure honestly.

## Consequences

Packet gates do not depend on editing the immutable handoff. A future handoff
release may repair its wrapper and publish a new checksum.

## Reversal strategy

Supersede this ADR when a versioned handoff verifier passes natively on Windows,
macOS, and Linux with equivalent evidence.
