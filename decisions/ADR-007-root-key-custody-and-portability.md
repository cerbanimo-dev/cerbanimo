# ADR-007 — Root-key custody and normal portability

- Status: Accepted
- Decision authority: Sol, post-Packet-000 executive decision
- Recorded: 2026-07-22

## Context

The reference identity capsule proves continuity by transferring an encrypted
root private key. That makes one demo portable, but turns ordinary federation
movement into a root-custody event and increases correlation and compromise
risk.

## Decision

Normal portability uses a selective, audience-bound pairwise presentation.
Root private keys never enter passport commands, events, presentations, exports,
logs, or model context. Stable-root disclosure is an exceptional, explicit
consent choice with a stated purpose and receipt.

## Consequences

Root identity, pairwise federation identities, device authorizations,
memberships, claims, progression receipts, recovery, and revocation remain
separate. Moving between federation homes does not transfer the root key.

## Reversal strategy

New recovery or custody mechanisms may be added behind versioned contracts, but
ordinary presentation cannot silently become root-key transfer.
