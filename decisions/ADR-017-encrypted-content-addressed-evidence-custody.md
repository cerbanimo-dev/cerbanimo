# ADR-017 - Encrypted content-addressed evidence custody

- Status: Accepted
- Decision authority: Packet 003 executive instruction
- Recorded: 2026-07-22

## Context

Closed evidence needs immutable manifests without putting potentially sensitive
or hostile artifact bytes into the event journal. Deduplication must not merge
ownership or disclosure authority, and retention erasure must remain honest.

## Decision

Artifact plaintext is SHA-256 addressed and AES-256-GCM encrypted under a random
data key. Each custody receives a separate wrapped copy of that key and retains
its own owner, privacy class, retention rule, disclosure scope, and provenance.
The journal stores manifests and tombstones only. A policy-authorized purge
deletes that custody's wrapped key, uses SQLite secure deletion plus WAL
truncation and vacuuming, and records an immutable attributable tombstone. The
shared ciphertext remains only while another active custody can recover it.

Reference-only URLs are not preserved evidence. Network capture is available
only through an injected, allowlisted HTTPS boundary with explicit media and
byte limits; this packet includes no network client.

## Consequences

Physical deduplication does not confer another custody's permissions. A purged
custody is explicitly not reviewable. Backups and external key escrow are part
of the operational erasure boundary and must enforce the same retention action.

## Reversal strategy

Another storage implementation must pass the same ownership, disclosure,
deduplication, purge, and tombstone contract tests.
