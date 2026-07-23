# Cerbanimo Production Successor

This is the separate production-successor workspace. Packet 000 froze the
Cerbanimo Constellary Reference Node v0.4.0 as an external compatibility oracle.
Packet 001 adds only the pure schema, command, event, and domain contracts. Its
accepted amendment separates project topology from per-task lifecycle streams,
adds atomic cross-stream finalization, pairwise passport presentation, and
atomic proposal confirmation/execution.

Packet 001.1 adds attributable deterministic-pass events, one deterministic
appeal per evidence cycle, credentialed conflict-free human review, and
high-assurance short-lived stable-root consent. Packet 002 adds SQLite-only
durability and a separate encrypted local secret vault. Packet 003 freezes the
accepted 1.0.0 schemas, adds 1.1.0 evidence/review contracts, encrypted
content-addressed evidence custody, a structural proof gate, and provider-neutral
independent review. Postgres remains unimplemented.

The Packet 001 core remains free of database and filesystem dependencies.
Packet 002 adds only the authorized SQLite journal and separate encrypted local
secret-vault boundaries. There is no Postgres adapter, HTTP application, UI,
model-provider adapter, renderer, content pack, Packet 004 settlement/reward
integration, or Founding Commons kernel special case.

## Verification

Requires Node.js 22.16 or newer and a `tar` executable capable of extracting a
ZIP archive.

```powershell
npm test
```

The root suite builds the TypeScript contracts, verifies the frozen 1.0.0 and
1.1.0 schemas without regenerating them, and runs the Packet 000
compatibility, Packet 001.1 domain, Packet 002 SQLite/vault, and Packet 003
evidence/review suites.

By default, the suite resolves the frozen archive from the adjacent handoff:

```text
../Cerbanimo-Production-Handoff-v1/cerbanimo-production-handoff-v1/reference/
  Cerbanimo-Constellary-Reference-Node-v0.4.0.zip
```

Set `CERBANIMO_REFERENCE_ARCHIVE` to test another physical copy of the exact
archive. The suite rejects any copy whose SHA-256 differs from the recorded
v0.4.0 checksum.

The oracle is extracted to an operating-system temporary directory for each
run. Tests start the packaged server against disposable data directories and
delete only those directories when finished. The ZIP is never modified.

See [`packet-000/REPORT.md`](packet-000/REPORT.md),
[`packet-001/REPORT.md`](packet-001/REPORT.md),
[`packet-001/PACKET-001.1-REPORT.md`](packet-001/PACKET-001.1-REPORT.md), and
[`packet-002/REPORT.md`](packet-002/REPORT.md), and
[`packet-003/REPORT.md`](packet-003/REPORT.md) for their respective evidence
gates.

## Repository boundary

This repository contains the accepted Packet 000–003 foundation: immutable
contract schemas, pure domain logic, the SQLite journal and local secret-vault
boundary, evidence custody contracts, the structural proof gate, independent
review, ADRs, tests, and packet reports.

It does not contain production secrets, databases, vault instances, evidence
artifact content, local identity custody, generated build output, or the frozen
reference ZIP. The ZIP is distributed only as the
`reference-node-v0.4.0` GitHub release asset and is verified against
[`reference/REFERENCE-RELEASE-MANIFEST.json`](reference/REFERENCE-RELEASE-MANIFEST.json).

Read [`docs/REPOSITORY-BOUNDARIES.md`](docs/REPOSITORY-BOUNDARIES.md) before
adding runtime data or a new packet. Security reports belong in the private
channel described by [`SECURITY.md`](SECURITY.md), and contributions must follow
[`CONTRIBUTING.md`](CONTRIBUTING.md). The accepted evidence gates are indexed in
[`PACKET-REPORTS.md`](PACKET-REPORTS.md).
