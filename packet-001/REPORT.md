# Packet 001 — Amended schemas, domain, commands, and events

Date: 2026-07-22  
Status: accepted baseline; extended by Packet 001.1

Packet 001.1 adds the subsequently accepted deterministic-proof, deterministic-
appeal, reviewer-eligibility, and stable-root-consent decisions. Its current
catalog and exhaustive results are recorded in `PACKET-001.1-REPORT.md`.

## Executive decisions recorded after Packet 000

Sol's six post-Packet-000 decisions are recorded as accepted ADRs:

1. `ADR-007-root-key-custody-and-portability.md` — normal portability is audience-bound and pairwise; root private keys never transfer.
2. `ADR-008-explicit-evidence-close-ux.md` — evidence closure is an explicit digest-confirming action after draft submission.
3. `ADR-009-settlement-visibility.md` — acceptance, settlement, and completion remain separately inspectable even when synchronous.
4. `ADR-010-safe-error-classification.md` — stable safe domain errors outrank accidental reference transport status codes.
5. `ADR-011-compatibility-hierarchy.md` — Constitution and ADRs precede successor contracts, Golden behavior, reference behavior, and incidental quirks.
6. `ADR-012-windows-handoff-verifier-defect.md` — the Windows `npm.cmd` spawn failure is a wrapper portability defect, not an integrity failure.

The original Packet 000 ADRs remain accepted. The v0.4.0 reference archive and handoff were not edited.

## Pure package boundary

Packet 001 contains only:

```text
packages/
  schemas/   TypeScript contracts and generated JSON Schema
  commands/  canonical command catalog, validation, and fingerprints
  events/    event catalog, validation, and deterministic materialization
  domain/    pure aggregate decisions, reducers, state machines, and coordinators
```

There is no database, filesystem storage, HTTP application, UI, renderer, model integration, content pack, Founding Commons special case, or empty placeholder package.

## Command catalog — 35

Projects and task graphs:

- `CreateProject`, `EditProject`, `ContinueProject`, `AddTask`
- `EditTask`, `AssignTask`, `SetTaskDependencies`, `ActivateTask`

Evidence, review, and settlement:

- `SubmitEvidenceDraft`, `WithdrawEvidenceDraft`, `CloseEvidence`
- `OpenReview`, `RecordReviewAttestation`, `ResolveReviewInconclusive`
- `ReassignReviewers`, `EscalateReviewToHuman`, `BeginCorrectionCycle`
- `SettleAcceptedTask`, `FinalizeCompletedTask`

Passport:

- `RegisterRootIdentity`, `AuthorizeDevice`, `RevokeDevice`
- `JoinMembership`, `LeaveMembership`
- `IssueClaim`, `RevokeClaim`
- `RecordProgressionReceipt`, `RevokeProgressionReceipt`
- `AddRecoveryMethod`, `RevokeRecoveryMethod`, `RevokeRootIdentity`
- `CreatePassportPresentation`

Formal proposals:

- `RecordProposal`, `ConfirmAndExecuteProposal`, `CancelProposal`

Every command variant requires `actor`, `expectedStreamVersion`, `idempotencyKey`, `correlationId`, and `causationId`, as well as command identity, stream, timestamp, schema version, type, and a closed payload schema. Models may prepare proposals but cannot be canonical command actors.

## Event catalog — 43

Projects and task graphs:

- `ProjectCreated`, `ProjectEdited`, `ProjectCompleted`, `ProjectContinued`
- `TaskAdded`, `TaskCreated`, `TaskEdited`, `TaskAssigned`
- `TaskDependenciesSet`, `TaskActivated`, `ProjectTaskCompleted`
- `TaskDependencyActivated`, `ContinuationOffered`

Evidence, review, and settlement:

- `EvidenceDraftSubmitted`, `EvidenceDraftWithdrawn`, `EvidenceClosed`
- `DeterministicProofRejected`
- `ReviewOpened`, `ReviewAttestationRecorded`, `ReviewAccepted`, `ReviewRejected`
- `ReviewInconclusive`, `ReviewersReassigned`, `ReviewEscalatedToHuman`
- `CorrectionCycleStarted`, `SettlementCommitted`, `TaskCompleted`

Passport:

- `PassportRootRegistered`
- `DeviceAuthorized`, `DeviceRevoked`
- `MembershipJoined`, `MembershipLeft`
- `ClaimIssued`, `ClaimRevoked`
- `ProgressionReceiptRecorded`, `ProgressionReceiptRevoked`
- `RecoveryMethodAdded`, `RecoveryMethodRevoked`
- `RootIdentityRevoked`, `PassportPresentationIssued`

Formal proposals:

- `ProposalRecorded`, `ProposalCancelled`, `ProposalConfirmedAndExecuted`

Every event retains actor, originating command, idempotency key, correlation, causation, stream/version, timestamp, and a closed event payload.

## Schema versions

| Contract | Version |
| --- | --- |
| Catalog | `cerbanimo.contracts/1.0.0` |
| Command envelope | `cerbanimo.command/1.0.0` |
| Event envelope | `cerbanimo.event/1.0.0` |
| Project | `cerbanimo.project/1.0.0` |
| Task | `cerbanimo.task/1.0.0` |
| Evidence | `cerbanimo.evidence/1.0.0` |
| Review | `cerbanimo.review/1.0.0` |
| Settlement | `cerbanimo.settlement/1.0.0` |
| Passport | `cerbanimo.passport/1.0.0` |
| Passport presentation | `cerbanimo.passport-presentation/1.0.0` |
| Proposal | `cerbanimo.proposal/1.0.0` |
| Semantic diff | `cerbanimo.semantic-diff/1.0.0` |
| Receipt | `cerbanimo.receipt/1.0.0` |

The generated artifact is `packages/schemas/generated/cerbanimo-contracts-1.0.0.schema.json`. It includes explicit project, task, evidence-cycle, review-state, settlement, passport, selective-presentation, proposal, and receipt definitions in addition to every command and event variant. A contract test proves the generated artifact equals the compiled source catalog.

## Aggregate boundaries

### Project stream

One stream per project owns only project metadata, ordered task topology, task-stream identifiers, completion membership, chapter state, and continuation offers. It does not own task evidence, review, settlement, or task lifecycle state.

Commands that introduce tasks use an atomic coordinator: project topology events and each new `TaskCreated` stream event either all commit or none commit.

### Task stream

One stream per task owns its editable task definition, activation, evidence cycles, deterministic proof outcome, review contract and attestations, rejection/correction, settlement record, and completion. A closed evidence cycle is immutable. Correction always creates a new numbered evidence cycle.

`FinalizeCompletedTask` is a multi-stream operation. Before producing events it validates the settled task stream, the project stream, and the exact set and versions of dependent task streams. A successful finalization atomically writes:

- `TaskCompleted` to the completed task stream;
- `ProjectTaskCompleted` to the project stream;
- `TaskDependencyActivated` to each newly traversable dependent task stream; and
- when it completes the project, `ProjectCompleted` and exactly three `ContinuationOffered` horizons to the project stream.

Any stale or invalid participant yields zero events and unchanged states.

### Passport stream

One stream per root controller keeps root public identity, device authorizations, memberships, claims, progression receipts, recovery methods, and revocations as separate contracts and collections.

The default presentation is an audience-bound pairwise identity with selected public facets. It contains no stable root identifier or root public record. Stable-root presentation requires explicit `identityMode: stable-root`, a consent receipt, and a disclosure reason. Neither path transfers or serializes the root private key.

### Proposal stream

One stream per proposal owns a pending, executed, or cancelled proposal. The proposal digest binds the ordered operations, their base stream versions, and the semantic diff digest shown to the person.

There is no confirmed-but-unexecuted state. `ConfirmAndExecuteProposal` validates the human confirmation and every target version before applying any operation. Success writes all target mutations and `ProposalConfirmedAndExecuted` atomically. A stale target writes neither confirmation nor target mutation and returns a `not-executed` receipt with `requiresRepreview: true`.

### Receipts

Receipts are immutable outcomes rather than aggregates. They bind the canonical command fingerprint, actor, idempotency key, correlation/causation, event positions, all resulting stream versions, proposal/settlement identifiers, replay status, and non-mutation reason/re-preview requirement.

## Evidence, review, and settlement state machine

Canonical legal transitions:

```text
open -> active
active -> submitted
submitted -> submitted | active | evidence_closed
evidence_closed -> review_pending | rejected(deterministic)
review_pending -> review_pending | rejected(independent) | accepted_pending_settlement
rejected -> active(new evidence cycle)
accepted_pending_settlement -> settled
settled -> completed
```

Review approval and rejection use the same `quorum` field. Neither timeout nor an inconclusive outcome implies rejection. An inconclusive contract may be reassigned only up to `maxReassignments`, or escalated to named human reviewers. Settlement remains unavailable until approving quorum, and dependency activation remains unavailable until settlement and atomic completion.

Exhaustive amended results:

- 13 legal state-to-state transitions passed.
- All 68 forbidden state-to-state transitions rejected.
- 17 legal task-command/state combinations passed.
- All 109 forbidden task-command/state combinations rejected.
- Total exhaustive classifications: 81 state pairs and 126 command/state pairs.
- Deterministic proof rejection records `rejectionStage: deterministic` and preserves the closed bundle.
- Independent rejection records `rejectionStage: independent` and requires the same quorum as approval.
- Timeout remains `review_pending` with an inconclusive review contract.
- Reassignment stops at the configured bound; human escalation can resolve the same digest-bound contract.
- Settlement cannot change accepted evidence digest, policy version, quorum digest, settlement ID, or idempotency key.
- Multi-stream finalization stale-version tests produce no events and no task, dependent, or project mutation.

Packet 001 amended contract suite: **26 passed, 0 failed**.

## Idempotency and stale-version behavior

- Exact replay is detected by idempotency key plus canonical command fingerprint before stale-version evaluation; it returns the original receipt with `replayed: true` and no new events.
- Reusing an idempotency key with changed command content returns `IDEMPOTENCY_KEY_REUSE` with no events.
- Ordinary stale commands return `STALE_STREAM_VERSION`, no events, and unchanged state.
- Atomic project/task creation and task finalization validate every participating stream before materialization.
- Proposal target staleness is an accepted non-mutation outcome: no confirmation event, no target event, a `not-executed` receipt, `reasonCode: STALE_STREAM_VERSION`, and `requiresRepreview: true`.
- A later failing proposal operation discards all earlier planned operations and emits no events.
- Deterministic settlement IDs bind task, accepted evidence digest, and policy version.

Durable uniqueness and race arbitration remain storage responsibilities; no storage implementation exists in Packet 001.

## Ambiguities requiring a human-product decision

1. **Human escalation eligibility and replacement.** Packet 001 adds named human assignments after an inconclusive outcome. Product policy must decide which credentials qualify a reviewer as human and whether escalation expires every still-outstanding prior assignment or augments them.
2. **Authority to declare non-timeout inconclusive review.** The domain requires no reached quorum and exhausted/returned assignments, but the product must decide which role or policy service may declare `split-decision` or `exhausted-without-quorum`.
3. **Deterministic rejection appeal.** Current behavior permits correction only through a new evidence cycle. Product policy must decide whether an erroneous deterministic policy evaluation also needs an appeal path that does not alter the closed evidence.
4. **Stable-root disclosure governance.** The contract requires an explicit consent receipt and reason. Product policy must define trusted consent issuers, receipt lifetime, revocation, and which regulated purposes may request this exceptional mode.

None of these ambiguities blocks the amended Packet 001 contracts; each would change authorization or user-policy behavior and therefore requires an explicit product decision.

## Proposed Packet 002 storage contracts and amendment implications

No Packet 002 code has been created. Final acceptance should carry these requirements forward:

### Consistent multi-stream read

- `loadStream(streamId)` returns immutable ordered events and current version.
- `loadStreams(expectations)` returns one consistent snapshot for project/task creation, finalization, and proposal execution.
- Unknown streams have version `0`; gaps, duplicate versions, or stream/type mismatches are corruption.

### Atomic append and receipt recording

- `commit(commandFingerprint, idempotencyKey, expectedStreams, eventBatches, receipt, projectionWrites, outboxMessages)` is one transaction.
- `eventBatches` supports independent ordered batches for task, dependent-task, project, proposal, passport, and proposal-target streams.
- All expected versions are checked before the first append, using deterministic stream lock order.
- Any conflict rolls back every event, projection, receipt, and outbox write across every participant.
- Non-mutation receipts, including stale proposal re-preview receipts, must be idempotently recordable with zero event batches.

### Uniqueness and replay

- Unique `(stream_id, stream_version)`, `event_id`, `command_id`, and `idempotency_key` constraints arbitrate races.
- Same idempotency key and fingerprint returns the stored receipt; the same key with another fingerprint fails without writes.
- Unique deterministic `settlement_id` prevents duplicate effects and returns the original receipt on exact retry.
- Receipt event positions and resulting stream versions must be verifiable against the committed transaction.

### Global journal, projections, and outbox

- A global monotonic position supports replay, rebuild, and audit across multi-stream commits.
- Project and task projections remain separate but may advance in the same transaction.
- Projection writes/checkpoints are rebuildable from the journal and cannot apply settlement twice.
- Completion export becomes eligible only after the atomic finalization transaction commits.
- Outbox delivery is at-least-once and consumers deduplicate by event ID.

### Integrity, migration, and secret boundary

- Forward-only versioned migrations, backup restoration, crash-injection tests, and rebuild from an empty database are required.
- Crash cases include before commit, after commit/before response, between proposed event-batch construction and commit, during projection, and during outbox publication.
- Provider credentials, device/root private keys, recovery secrets, and encrypted key material remain outside events, projections, receipts, exports, and logs.

## Exit and stop gate

Packet 001's amended commands, events, generated schemas, aggregate boundaries, state machines, passport presentations, atomic proposal semantics, and receipts are executable as pure code. Packet 000 remains the immutable regression oracle. Packet 002 requires explicit proceed direction.
