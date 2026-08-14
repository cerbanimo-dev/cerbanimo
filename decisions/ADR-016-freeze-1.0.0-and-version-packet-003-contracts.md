# ADR-016 - Freeze 1.0.0 and version Packet 003 contracts separately

- Status: Accepted
- Decision authority: Packet 003 executive instruction
- Recorded: 2026-07-22

## Context

Packet 001.1 and Packet 002 accepted the generated `cerbanimo-contracts-1.0.0`
schema. Packet 003 requires richer evidence and attestation contracts, including
artifact custody, disclosure, reviewer assignments, citations, and abstention.

## Decision

The accepted 1.0.0 schema is immutable at 1,162,879 bytes and SHA-256
`109542d56dccb828b3d798fa1ee7e532e11dfbb95d73091d0690302e8aee5c27`.
Every build verifies those bytes and fails before generation if they differ.
Packet 003 publishes separate `cerbanimo.evidence/1.1.0`,
`cerbanimo.proof-result/1.1.0`, `cerbanimo.review/1.1.0`,
`cerbanimo.review-packet/1.1.0`, and
`cerbanimo.review-attestation/1.1.0` contracts.

## Consequences

Packet 003 cannot silently reinterpret a previously accepted payload. Consumers
must negotiate the explicit 1.1.0 evidence/review contracts.

## Reversal strategy

Corrections require another schema version. The 1.0.0 freeze manifest and
artifact remain historical evidence.
