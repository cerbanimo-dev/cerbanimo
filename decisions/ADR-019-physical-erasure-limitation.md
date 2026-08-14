# ADR-019 - Physical-erasure limitation

- Status: Accepted clarification
- Decision authority: post-Packet-003 executive instruction
- Recorded: 2026-07-23

## Context

Packet 003 deletes custody-wrapped keys, truncates the live WAL, enables SQLite
secure deletion, vacuums the current database, and deletes ciphertext when the
last custody is purged. Those operations support cryptographic unavailability
inside the managed live store, but storage hardware and external copies are not
fully controlled by this application boundary.

## Decision

An evidence tombstone means the managed custody no longer provides the key or
artifact and must report itself as not reviewable. It is not proof of physical
bit erasure. SSD wear levelling, filesystem journals, OS caches, crash dumps,
volume snapshots, backups, replicas, forensic images, and external key escrow
may retain prior bytes. Operators must apply retention and key-destruction policy
to every such copy before making a broader physical-erasure claim.

## Consequences

Product language must say "cryptographically unavailable through this custody"
or equivalent. It must not promise guaranteed physical erasure from media.

## Reversal strategy

Stronger claims require a separately audited storage and key-management profile
covering hardware, backups, snapshots, crash data, and media retirement.
