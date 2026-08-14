# Repository boundaries

## Purpose

Cerbanimo Production Successor is the clean production-line successor to the
immutable Cerbanimo Constellary Reference Node v0.4.0. This first publication
captures the accepted Packet 000–003 foundation. It is not a deployment and it
does not supersede the reference node as the compatibility oracle.

## Included

- Packet 000 reference compatibility catalog and executable oracle harness
- Packet 001 and 001.1 pure schemas, commands, events, aggregates, ADRs, and
  exhaustive transition tests
- Packet 002 append-only SQLite journal, atomic multi-stream commits,
  projections, outbox, integrity checks, backup/restore checks, and the separate
  encrypted local secret-vault boundary
- Packet 003 immutable evidence manifests, encrypted content-addressed custody
  boundary, structural deterministic proof, provider-neutral independent
  review, signed attestations, and replay tests
- frozen 1.0.0 and 1.1.0 JSON schema artifacts and their SHA-256 manifests
- packet evidence-gate reports and architecture decisions

## Intentionally absent

This history must never contain:

- credentials, tokens, private keys, passphrases, or environment-specific
  configuration
- SQLite/Postgres files, WAL/SHM files, backups, or database exports
- instantiated vaults, custody keys, encrypted evidence blobs, decrypted
  evidence, or real evidence narratives
- root identities, device authorizations, recovery material, or other local
  identity custody
- `node_modules`, `.build`, coverage, logs, packet scratch directories, or other
  generated output
- the frozen v0.4.0 ZIP or any later binary release payload

Test fixtures are synthetic contract data only. They must not be copied from
real people, projects, reviewers, evidence, or local runtime state.

## Frozen compatibility artifacts

The accepted 1.0.0 and 1.1.0 schemas are immutable. New compatible work must use
a new schema namespace/version; it must not rewrite frozen bytes. The reference
ZIP remains outside Git and is distributed as a release asset whose byte count
and SHA-256 are recorded in the reference-release manifest.

The ZIP is an executable behavioral exhibit, not source for modification.
Packet 000 extracts it into disposable operating-system temporary space and
uses it only as a compatibility oracle.

## Security and integrity claims

Journal, receipt, projection, and artifact hashes detect corruption. They do not
by themselves establish authenticity, truth, reviewer independence, or secure
physical erasure. Cryptographic erasure can make ciphertext unavailable when
all relevant keys are destroyed, but cannot prove that storage media, caches,
snapshots, backups, replicas, crash dumps, or key escrow no longer retain bits.

## Deferred product surfaces

The Packet 003 foundation intentionally has no HTTP application, UI, model
provider, renderer, PostgreSQL adapter, federation transport, Packet 004
settlement/reward integration, Resinera integration, or Founding Commons
special case.
