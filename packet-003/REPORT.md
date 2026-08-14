# Packet 003 - Evidence Custody, Proof Gate, and Independent Review

Date: 2026-07-22  
Status: evidence gate satisfied; stopped before settlement integration and Packet 004

## Frozen and new schemas

The accepted `cerbanimo-contracts-1.0.0.schema.json` remains byte-for-byte
immutable:

```text
bytes:  1,162,879
sha256: 109542d56dccb828b3d798fa1ee7e532e11dfbb95d73091d0690302e8aee5c27
```

Following Packet 003 acceptance, the separate Packet 003 schemas are also
frozen and every build verifies all three manifests without regenerating them:

- `evidence-proof-1.1.0.schema.json` — 38,452 bytes,
  `98941c1ce53db8b62073db611cbaacefe7ef7f959f0f5e9eb02ae04007c701d6`
- `independent-review-1.1.0.schema.json` — 47,151 bytes,
  `889edea42a5ee6f46b93eb64606e6b857c26bd7079adc15f8e6015971ce97771`

The 1.1 namespaces cover evidence bundles, proof policies/results, reviewer-pool
snapshots, review contracts/packets, and approve/reject/abstain attestations.

## Package boundary

Packet 003 adds only:

- `@cerbanimo/proof` - canonical evidence custody contracts and deterministic
  structural proof gate
- `@cerbanimo/review` - provider-neutral selection, packets, Ed25519
  attestations, quorum, reassignment, escalation, appeal opening, and replay
- `@cerbanimo/evidence-store` - encrypted content-addressed artifact custody

There is no HTTP server, UI, Kamiya, general model-provider adapter, Postgres,
federation transport, reward logic, Founding Commons special case, or Packet 004
settlement integration.

## Evidence custody

A closed bundle binds task, submission, author, evidence cycle, normalized
narrative, preserved artifact manifests, reference-only URLs, requirement
coverage, evidence policy and schema versions, closure actor/time, content
fingerprint, and canonical bundle digest. It is recursively frozen. Artifact
manifests bind SHA-256, byte size, media type, capture provenance, privacy,
retention, and disclosure scope. Artifact bytes never enter the event journal.

The evidence store uses AES-256-GCM and a random per-content data key. SHA-256
deduplication shares ciphertext only; each custody retains a distinct wrapped
key, owner, disclosure scope, privacy class, and retention rule. Reads require
the selected custody plus audience, purpose, and reviewer authorization.

Authorized purge removes that custody's wrapped key, scrubs deleted key material
from current SQLite/WAL state, and creates an immutable attributable tombstone.
The tombstone states whether another custody can still recover shared bytes and
always marks the purged custody not reviewable. Pre-purge backups and external
key escrow must participate in the operational purge policy.

This is cryptographic unavailability through the managed custody, not proof of
physical-media erasure. SSD remapping, filesystem journals, caches, crash dumps,
snapshots, backups, replicas, forensic images, and external key escrow may
retain older bytes. `ADR-019` records this accepted limitation.

Remote URLs remain references. The package contains no network client. An
optional injected fetch boundary accepts only exact-allowlisted HTTPS hosts,
explicit media types, and bounded bytes before capturing content into custody.

## Deterministic proof gate

The gate checks bundle/digest integrity, schema and policy binding, required
artifacts, preservation, per-artifact and total size, allowed media types,
declared requirement coverage, explicit non-completion phrases, replayed content
fingerprints, and policy-specific machine assertions.

Stable rejection codes include:

- `BUNDLE_DIGEST_MISMATCH`, `BUNDLE_SCHEMA_UNSUPPORTED`,
  `POLICY_VERSION_MISMATCH`
- `REQUIRED_ARTIFACT_MISSING`, `ARTIFACT_NOT_PRESERVED`,
  `ARTIFACT_SIZE_EXCEEDED`, `ARTIFACT_MEDIA_TYPE_DISALLOWED`
- `REQUIREMENT_COVERAGE_MISSING`, `EXPLICIT_NON_COMPLETION`,
  `EVIDENCE_REPLAYED`, `MACHINE_ASSERTION_FAILED`

A pass emits `PROOF_ELIGIBLE_FOR_INDEPENDENT_REVIEW`, records
`truthClaim: none`, and produces only `DeterministicProofPassed` followed by the
digest/policy-bound `ReviewOpened`. It grants no acceptance, settlement,
completion, or reward.

## Independent and human review

Selection snapshots and digests eligible reviewers, excluding the author,
policy-selected task owner, conflicts, revoked/invalid credentials,
unauthorized identities, and duplicate known controlling identities. A random
32-byte committed seed yields a reproducible HMAC ordering after revelation.
The contract retains the pool, digest, policy, seed commitment/reveal,
assignments, expiry, symmetrical quorum, and reassignment count.

Review packets disclose only audience-, purpose-, and reviewer-authorized
manifests. Internal retention/disclosure controls are omitted. Evidence content
is enclosed by explicit untrusted-content delimiters and cannot confer tool,
instruction, script, or authority semantics.

Attestations use Ed25519 and bind review contract, assignment, task, submission,
evidence digest, policy, reviewer identity/credential, decision, confidence,
structured reasons, citations, and timestamp. Recording rechecks signature,
assignment, current credential status, conflicts, expiry, authorized citations,
and one-vote-per-assignment before state changes. Abstention is separate from
rejection. Disagreement or abstention becomes deterministically inconclusive,
then bounded reassignment or human escalation; timeout never means rejection.
Human escalation revokes unresolved model assignments. An appeal overturn by an
eligible high-assurance human opens ordinary independent review and never
approves the task.

## Evidence-gate demonstrations

Packet 003 suite: **17 passed, 0 failed**.

- one changed byte changes the content and bundle digests; closed state is
  immutable and a tampered clone fails integrity
- deduplication keeps distinct owners, disclosure scopes, and custody keys
- reference-only URLs do not satisfy preserved-artifact requirements; constrained
  capture rejects non-allowlisted/private targets
- missing, contradictory, oversized, disallowed, replayed, tampered, and failed
  machine assertions return stable deterministic codes
- proof pass opens review only and produces no completion/reward event
- committed-seed assignment is reproducible from the same pool snapshot
- author, required task owner, conflict, revocation, authorization, and duplicate
  controlling-identity exclusions are deterministic
- tampered signature, duplicate vote, expiry, wrong digest, unauthorized citation,
  current conflict/revocation, and unassigned identity fail without mutation
- approve/reject disagreement and abstention produce bounded reassignment;
  timeout is inconclusive and human escalation invalidates model assignments
- authorized disclosure excludes private artifacts and secret-shaped metadata;
  embedded prompts remain delimited evidence data
- purge removes custody recoverability and records an honest tombstone while
  respecting another custody's independent access
- canonical journal replay restores evidence/proof/review/tombstone state after
  artifact bytes are erased and without containing artifact plaintext

## Residual threats

Packet 003 does not claim to eliminate:

- **Reviewer collusion:** independently assigned reviewers can still coordinate.
- **Sybil identities:** known controlling identities are deduplicated, but an
  authority must establish identity uniqueness; randomization is not Sybil proof.
- **Persuasive fabricated evidence:** structural sufficiency and reviewer votes do
  not turn persuasive false content into truth.
- **Compromised reviewer keys:** Ed25519 proves possession, not that the rightful
  reviewer controlled the key; revocation latency remains material.
- **Malicious file formats:** encrypted custody and manifest checks do not safely
  render or execute hostile files; sandboxed inspection belongs to later wiring.
- **Privacy leakage:** manifests, provenance, citations, and reviewer behavior can
  reveal metadata even when artifact bytes remain encrypted.
- **Model prompt injection:** delimiters and neutral packet contracts keep evidence
  non-authoritative, but downstream model runtimes still require isolation and
  tool-denial controls.
- **Historical backups and key escrow:** a copy made before purge can preserve
  recoverability unless backup retention and key destruction honor the tombstone.

No later packet has begun.
