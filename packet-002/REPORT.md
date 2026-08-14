# Packet 002 - SQLite durability evidence gate

Date: 2026-07-22  
Status: evidence gate satisfied; stopped before Packet 003 and Postgres

## Delivered boundary

Packet 002 adds two sibling packages and no transport or application layer:

- `@cerbanimo/storage-sqlite` - canonical SQLite journal, command and receipt
  records, projections, checkpoints, outbox, integrity checks, backup, restore,
  and rebuild operations
- `@cerbanimo/secret-vault` - a physically separate encrypted local SQLite
  vault for secret bytes

Postgres is not implemented.

## SQLite contract

Every journal connection enables WAL mode and foreign keys, uses `synchronous =
FULL`, applies a bounded busy timeout (2,500 ms by default; accepted range
1-30,000 ms), and performs writes inside explicit transactions. Canonical event
commits use `BEGIN IMMEDIATE`.

Forward migration 1 creates streams, immutable commands, append-only events with
global positions and per-stream versions, immutable receipts, and the settlement
uniqueness index. Forward migration 2 creates canonical projections,
checkpoints, and the transactional outbox. Applied migrations store a SHA-256
checksum; changed history and databases newer than the executable are rejected.

The commit boundary:

1. checks command idempotency before concurrency expectations;
2. validates every expected stream version in one write transaction;
3. appends contiguous per-stream event versions and global positions;
4. stores the command and immutable receipt, including valid zero-event results;
5. applies projection/checkpoint changes and outbox inserts;
6. commits all streams and derived records together or rolls everything back.

An exact retry returns the original stored receipt. Reuse of an idempotency key
with another command fingerprint is rejected. A stale proposal execution stores
only a `not-executed`, `requiresRepreview` zero-event receipt and mutates no
stream or projection.

Deterministic settlement IDs have a database uniqueness constraint independent
of stream identity. A `task.completed` outbox record must point to a
`TaskCompleted` event inserted by the same transaction.

## Integrity, projections, and recovery

Events store a per-stream SHA-256 hash chain over canonical event JSON. Commands,
receipts, projections, checkpoints, and outbox payloads also store deterministic
hashes. Verification recalculates these hashes and validates receipt event
positions. These hashes detect corruption only; they are not signatures and make
no authenticity claim.

Projection updates and checkpoints commit with their source events. Projections
can be deleted and rebuilt in global journal order by a pure projector. The
evidence suite compares canonical bytes before deletion and after rebuild.

Online backup uses SQLite's backup operation after a full WAL checkpoint and
runs `quick_check`. Restore opens a copied backup through migrations and rejects
event/receipt integrity failures.

## Secret-vault boundary

The local vault is a separate database and package. Secret values use
AES-256-GCM with a random 96-bit nonce and authenticated associated data binding
the secret ID and kind. The caller supplies a 32-byte key or derives one with
scrypt. Key rotation re-encrypts all entries transactionally, and in-memory key
buffers are zeroed on replacement and close.

Only non-secret metadata can be listed. The journal rejects secret-shaped fields
in commands, events, receipts, projections, and outbox payloads; canonical
exports repeat that check. The evidence test confirms secret plaintext is absent
from the vault file and that vault tables do not exist in the journal database.
No storage or vault operation writes application logs.

OS keystore acquisition and production Windows ACL provisioning are deliberately
outside this packet: the vault accepts key bytes through its boundary and makes
no claim that application memory is an HSM.

## Required demonstrations

Packet 002 evidence suite: **11 passed, 0 failed**.

- two simultaneous WAL writers at expected version 0 produce one commit and one
  `STALE_STREAM_VERSION`; the stream contains one event at version 1
- injected failure before a three-stream finalization commit leaves all task,
  dependent-task, project, receipt, and projection writes absent; retry commits
  all three streams
- injected response loss after durable commit followed by the same command
  returns the original immutable receipt and does not append another event
- simultaneous settlement writers on different streams produce exactly one
  `SettlementCommitted`; the loser receives `SETTLEMENT_ALREADY_COMMITTED`
- stale proposal execution persists one idempotent zero-event receipt with
  `requiresRepreview = true` and no canonical mutation
- projection deletion/rebuild reproduces byte-equivalent canonical state and
  checkpoint position; backup and restore reproduce journal, projection, outbox,
  and integrity state
- a completion outbox message appears only with `TaskCompleted` in the same
  transaction; a mismatched completion notification rolls the entire commit back
- event and receipt tampering is detected; a migration checksum mutation prevents
  reopen
- vault encryption and rotation pass; secret-bearing event, receipt, projection,
  and outbox writes are rejected; canonical export and captured logs contain no
  secret material

## Evidence-gate constraints

The implementation requires Node 22.16 or newer for the built-in SQLite backup
API and uses the built-in `node:sqlite` module. Node 22 currently
prints its experimental-feature warning unless warnings are suppressed; this is
visible in verification output and does not change the database guarantees.
Production release policy must pin and validate the chosen Node runtime.

No Packet 003 work, Postgres adapter, HTTP server, UI, renderer, model
integration, or Founding Commons special case is present.
