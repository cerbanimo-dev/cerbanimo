# Packet 000 — Freeze and Observe

Date: 2026-07-22  
Status: exit gate satisfied; Packet 001 has not started

## Reference identity and verification

- Runtime: Node.js `v22.16.0`, npm `10.9.2`; the manifest minimum is Node.js
  `22.13.0`.
- Frozen artifact:
  `Cerbanimo-Constellary-Reference-Node-v0.4.0.zip`.
- Observed byte count: `661736`.
- Observed SHA-256:
  `4f3f4ccf793ec33e4488fe456378f36d6b60ca6827efbdc3600e0c9e5f82898a`.
- Manifest SHA-256: exact match.
- All 29 entries in `CHECKSUMS.sha256` passed before the bundled verifier reached
  its test-launch step.
- The archive was extracted only into unique operating-system temporary
  directories. The archive was not edited, and its checksum still matches after
  all runs.

The clean reference run used `npm ci` from the archive lockfile followed by the
archive's own `npm test` command. It passed:

- the Vinext production build and packaged artifact validation;
- 13 Node tests: 12 core/domain tests plus one rendered-HTML test;
- the local-server end-to-end smoke;
- the two-node federation, signed audit quorum, and identity-transfer smoke;
- the three-house Founding Commons smoke.

The Open Work Graph pilot passed all seven contract tests. Its demo verified six
signed envelopes in the offline AUREA → Cerbanimo → AUREA round trip.

## Independent compatibility suite

The successor folder contains no reference source and no production
implementation. `npm test` verifies the artifact checksum, extracts the oracle
to a temporary directory, starts disposable packaged nodes, and executes frozen
request/response fixtures.

Current result: 10 tests passed, 0 failed.

The required Packet 000 API flows are automated:

1. false proof rejection with no progress or reward;
2. mutation-shaped Kamiya intent producing a pending proposal;
3. no mutation during preview and an execution receipt after confirmation;
4. two-reviewer audit escrow before quorum;
5. reference reward/progression release after approving quorum;
6. three continuation horizons and chapter append;
7. encrypted identity transfer, wrong-passphrase inertness, and DID/progression
   preservation;
8. federation tamper rejection through the public peer/sync API.

All 28 Golden Behavior Matrix IDs are cataloged. Sixteen have executable
reference API coverage, five are observed by the reference source suite, three
are documentation-only reference obligations, three are explicitly
successor-only contracts, and one is a documented operational claim without a
dedicated outage test. This classification prevents an unobserved successor
promise from being mislabeled as v0.4.0 behavior.

## Observed behavior and ambiguities

1. **The Windows handoff wrapper is not portable as written.**
   `VERIFY-HANDOFF.mjs` completes checksum validation, then
   `spawnSync("npm.cmd", ["test"])` fails with `EINVAL` on this supported Windows
   runtime. Running `npm test` directly in `open-work-graph/` passes all seven
   tests. The handoff was not edited.

2. **“API fixtures for every golden scenario” cannot be literal for v0.4.0.**
   G-016, G-026, and G-027 are explicitly successor-only. Several other rows
   are exposed only through core tests, filesystem observation, or written
   promises rather than a stable API. Packet 000 records those boundaries
   instead of inventing responses.

3. **Reference approval and reward release are coupled.**
   When quorum approves, v0.4.0 seals the task and releases rewards in the same
   reference flow. It has no observable `accepted_pending_settlement`,
   idempotent settlement command, replay receipt, or post-settlement completion
   step. The reward fixture preserves the experience promise but is not evidence
   for G-016. The successor constitution overrides the reference architecture.

4. **Evidence closure is not a separate reference API state.**
   v0.4.0 submits evidence and opens review in one flow. The successor requires
   mutable drafts, immutable closure, digest binding, deterministic proof, and
   only then independent review.

5. **Wrong-passphrase import is inert but returns HTTP 500.**
   The destination identity remains unchanged and a correct retry succeeds, but
   the observed error classification is a server error. Preserving inertness is
   mandatory; preserving the `500` is not presumed desirable.

6. **Reference proposals do not expose expected stream versions.**
   Preview/confirmation is observable, but the required successor stale-preview
   conflict and no-partial-write behavior cannot be inherited from this API.

7. **Some matrix promises lack a dedicated frozen test.**
   Sealed-history protection (G-012), rejecting-review correction (G-015), inert
   imported prose (G-024), and storage-failure truthfulness (G-028) are written
   obligations but not isolated reference API fixtures.

8. **Reference identity portability moves the encrypted root private key.**
   That proves same-DID continuity, but the successor constitution separately
   represents root identity, devices, memberships, claims, recovery, and
   revocation. The production passport cannot merely copy this storage model.

## Packet 000 file plan, realized

```text
Cerbanimo-Production-Successor/
  package.json                         # suite version 0.0.0-packet.000
  README.md                            # oracle use and immutability boundary
  packet-000/
    REPORT.md                          # this evidence report and stop gate
  tests/compatibility/
    reference-node.test.mjs            # external black-box API oracle tests
    scenario-catalog.test.mjs          # 28-scenario completeness checks
    support/reference-oracle.mjs       # hash, temp extraction, node lifecycle
    fixtures/reference-v0.4.0/
      scenario-catalog.json            # evidence/disposition for G-001…G-028
      proposal-preview-confirmation.json
      false-proof.json
      audit-escrow.json
      reward-release.json
      continuation.json
      identity-transfer.json
      federation-tamper-rejection.json
```

No `apps/`, `packages/`, `packs/`, production storage, domain handler, UI,
model integration, or empty target-shape package has been created.

## Product decisions that may be required from Cami

1. **Passport custody:** whether same-root portability should ever transfer an
   encrypted root private key, or whether production portability should default
   to selective presentation plus device-key enrollment/rotation. These choices
   have materially different recovery and compromise consequences.

2. **Evidence-close experience:** whether closing evidence is always a separate
   explicit human action or whether a submission control may clearly combine
   “submit and close” while still producing two durable commands/receipts. The
   distinction changes the opportunity to correct evidence before disclosure.

3. **Settlement visibility:** whether the UI should visibly pause at
   `accepted_pending_settlement` or may immediately proceed when synchronous
   settlement succeeds, while retaining an inspectable durable boundary. This
   changes how people understand approval versus earned value.

4. **Compatibility exceptions:** whether the wrong-passphrase `500` and other
   reference error classifications are defects to replace with versioned safe
   errors. Any intentional observable change should be named in a decision
   record rather than silently normalized.

## Exit and stop gate

Packet 000's suite is versioned, lives outside the reference source tree, and
fails on checksum or observed-contract drift. The reference archive remains
immutable. This report is the evidence gate; Packet 001 requires explicit
proceed direction.
