# Packet 001.1 - Deterministic appeal and identity-consent amendment

Date: 2026-07-22  
Status: evidence gate satisfied; Packet 002 was authorized to proceed

## Decisions and contracts

The amendment is recorded in three accepted ADRs:

- `ADR-013-deterministic-proof-and-single-appeal.md`
- `ADR-014-human-review-eligibility-and-inconclusive-calculation.md`
- `ADR-015-stable-root-consent.md`

`DeterministicProofPassed` is emitted before `ReviewOpened` and binds the
unchanged evidence digest, deterministic policy version, result codes,
evaluating actor, and evaluation timestamp. A deterministic rejection permits
exactly one appeal for that evidence cycle:

```text
rejected(deterministic)
  -> deterministic_appeal_pending
  -> rejected(upheld) | review_pending(overturned)
```

Only a credentialed, in-scope, valid, conflict-free human reviewer independent
of the evidence author and appeal filer can resolve the appeal. An overturn
opens independent review on the same digest; it never directly accepts,
settles, or completes the task. Correction always opens a new evidence cycle.

Human review assignments distinguish human and model reviewers. Human
attestations require the reviewer credential and a digest-bound no-conflict
disclosure. Human escalation revokes all outstanding model assignments before
adding eligible human assignments. Inconclusive resolution is computed from
approval count, rejection count, outstanding assignments, symmetrical quorum,
and contract expiry. Timeout is not rejection.

Pairwise federation identity remains the passport default. Stable-root
disclosure requires active consent issued by a high-assurance authorized device
with the required capability. Consent is audience-bound, purpose-bound,
independently revocable, and expires in no more than fifteen minutes. A
presentation cannot outlive its consent. No portability contract transfers the
root private key.

## Catalogs

The canonical command catalog contains 39 commands:

- Project/task graph: `CreateProject`, `EditProject`, `ContinueProject`,
  `AddTask`, `EditTask`, `AssignTask`, `SetTaskDependencies`, `ActivateTask`
- Evidence/review/settlement: `SubmitEvidenceDraft`, `WithdrawEvidenceDraft`,
  `CloseEvidence`, `OpenReview`, `FileDeterministicAppeal`,
  `ResolveDeterministicAppeal`, `RecordReviewAttestation`,
  `ResolveReviewInconclusive`, `ReassignReviewers`,
  `EscalateReviewToHuman`, `BeginCorrectionCycle`, `SettleAcceptedTask`,
  `FinalizeCompletedTask`
- Passport: `RegisterRootIdentity`, `AuthorizeDevice`, `RevokeDevice`,
  `JoinMembership`, `LeaveMembership`, `IssueClaim`, `RevokeClaim`,
  `RecordProgressionReceipt`, `RevokeProgressionReceipt`,
  `AddRecoveryMethod`, `RevokeRecoveryMethod`, `RevokeRootIdentity`,
  `IssueStableRootConsent`, `RevokeStableRootConsent`,
  `CreatePassportPresentation`
- Proposals: `RecordProposal`, `ConfirmAndExecuteProposal`, `CancelProposal`

Every command requires actor, expected stream version, idempotency key,
correlation ID, and causation ID. Formal confirmation atomically validates the
confirmed proposal digest, semantic-diff digest, and bound stream versions.

The canonical event catalog contains 49 events:

- Project/task graph: `ProjectCreated`, `ProjectEdited`, `ProjectCompleted`,
  `ProjectContinued`, `TaskAdded`, `TaskCreated`, `TaskEdited`, `TaskAssigned`,
  `TaskDependenciesSet`, `TaskActivated`, `ProjectTaskCompleted`,
  `TaskDependencyActivated`, `ContinuationOffered`
- Evidence/review/settlement: `EvidenceDraftSubmitted`,
  `EvidenceDraftWithdrawn`, `EvidenceClosed`, `DeterministicProofPassed`,
  `DeterministicProofRejected`, `DeterministicAppealFiled`,
  `DeterministicAppealUpheld`, `DeterministicAppealOverturned`, `ReviewOpened`,
  `ReviewAttestationRecorded`, `ReviewAccepted`, `ReviewRejected`,
  `ReviewInconclusive`, `ReviewersReassigned`, `ReviewEscalatedToHuman`,
  `CorrectionCycleStarted`, `SettlementCommitted`, `TaskCompleted`
- Passport: `PassportRootRegistered`, `DeviceAuthorized`, `DeviceRevoked`,
  `MembershipJoined`, `MembershipLeft`, `ClaimIssued`, `ClaimRevoked`,
  `ProgressionReceiptRecorded`, `ProgressionReceiptRevoked`,
  `RecoveryMethodAdded`, `RecoveryMethodRevoked`, `RootIdentityRevoked`,
  `StableRootConsentIssued`, `StableRootConsentRevoked`,
  `PassportPresentationIssued`
- Proposals: `ProposalRecorded`, `ProposalCancelled`,
  `ProposalConfirmedAndExecuted`

All event variants retain actor, command ID, idempotency key, correlation ID,
and causation ID.

## Versions and aggregate boundaries

The amendment extends the existing `1.0.0` contract namespace. The explicit
schema identifiers remain:

```text
cerbanimo.contracts/1.0.0
cerbanimo.command/1.0.0
cerbanimo.event/1.0.0
cerbanimo.project/1.0.0
cerbanimo.task/1.0.0
cerbanimo.evidence/1.0.0
cerbanimo.review/1.0.0
cerbanimo.settlement/1.0.0
cerbanimo.passport/1.0.0
cerbanimo.passport-presentation/1.0.0
cerbanimo.proposal/1.0.0
cerbanimo.semantic-diff/1.0.0
cerbanimo.receipt/1.0.0
```

Aggregate ownership remains:

- project stream: project metadata, topology, completion index, continuations
- one task stream per task: task definition, evidence cycles, deterministic
  appeal, independent review, settlement, completion
- passport stream: root public identity, device authorizations, memberships,
  claims, progression receipts, recovery, consent, and revocation as separate
  contract collections
- proposal stream: previewed operations, state-version expectations, semantic
  diff, confirmation, cancellation

Finalization is a single atomic write set spanning the completed task, each
affected dependent task, and its project stream.

## Exhaustive verification

Packet 001.1 contract suite: **28 passed, 0 failed**.

- all 160 task-command/state combinations classified: 19 legal, 141 forbidden
- all 100 state-to-state pairs classified: 16 legal, 84 forbidden
- deterministic pass ordering and digest/policy/result/actor/time binding pass
- one-appeal limit, eligible-human resolution, upheld and overturned paths pass
- correction-cycle and unchanged-digest rules pass
- symmetrical approval/rejection quorum, deterministic inconclusive outcomes,
  reassignment bounds, model replacement, escalation, and timeout behavior pass
- atomic finalization, idempotent command replay, stale-version rejection, and
  atomic proposal confirm-and-execute pass
- pairwise default and high-assurance stable-root consent constraints pass

No unresolved ambiguity blocks Packet 002. Credential trust-root provisioning,
human-facing disclosure language, and reviewer-pool operations remain product
policy inputs; the domain contracts expose them without choosing a deployment
policy.

## Packet 002 storage implications

Storage must provide atomic expected-version commits over multiple project and
task streams; preserve zero-event stale-proposal receipts; enforce deterministic
settlement uniqueness; retain proof, appeal, credential, disclosure, assignment,
consent, and revocation events unchanged; and keep all private key material
outside the canonical journal in a separate secret-vault boundary.
