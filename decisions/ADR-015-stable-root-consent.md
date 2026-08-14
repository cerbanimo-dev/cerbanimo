# ADR-015 — High-assurance stable-root consent

- Status: Accepted
- Decision authority: Sol, Packet 001.1 executive decision
- Recorded: 2026-07-22

## Context

Stable-root disclosure increases correlation risk and therefore cannot rely on a generic presentation confirmation.

## Decision

Stable-root consent is issued by an active authorized device with high assurance and the `issue:stable-root-consent` capability. It binds one root, device, audience, and purpose, expires within fifteen minutes, is independently revocable, and cannot outlive the resulting presentation. Default portability remains pairwise and discloses no stable root.

## Consequences

Revoked, expired, audience-mismatched, purpose-mismatched, or downgraded-device consent is inert. Root private key material never enters consent or presentation contracts.

## Reversal strategy

Changing lifetime or assurance policy requires a versioned consent contract; existing receipts retain their original bounds.
