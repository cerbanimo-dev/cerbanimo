import {
  digestJson,
  type Actor,
  type CanonicalCommand,
  type ClosedEvidenceBundle,
  type ConflictDisclosure,
  type DeterministicAppeal,
  type EvidenceCycle,
  type HumanReviewCredential,
  type JsonValue,
  type ReviewAssignment,
  type ReviewAttestation,
  type ReviewContract,
  type SettlementEffects,
  type SettlementIntent,
  type Task,
  type TaskAggregate,
  type TaskDefinition,
  type TaskStatus,
} from "../../schemas/src/index.js";
import type { EventDraft } from "../../events/src/index.js";
import { reject } from "./errors.js";
import { assertTaskCommandAllowed, assertTaskStatusTransition } from "./state-machine.js";

type Payload = Record<string, unknown>;

function payload(command: CanonicalCommand): Payload {
  return command.payload as Payload;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) reject("INVALID_COMMAND", `${field} is required`, { field });
  return value;
}

function requireArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) reject("INVALID_COMMAND", `${field} must be an array`, { field });
  return value as T[];
}

function requireTask(state: TaskAggregate): Task {
  if (!state.task) reject("NOT_FOUND", "Task stream is not initialized");
  return state.task;
}

function actorRootIdentityId(command: CanonicalCommand): string {
  return command.actor.kind === "human" ? command.actor.rootIdentityId : command.actor.delegatedByRootIdentityId;
}

function sameActor(left: Actor, right: Actor): boolean {
  return digestJson(left as unknown as JsonValue) === digestJson(right as unknown as JsonValue);
}

function validateHumanReviewer(
  reviewerRootIdentityId: string,
  credential: HumanReviewCredential | null,
  disclosure: ConflictDisclosure | null,
  evidenceDigest: string,
  evaluatedAt: string,
  scope: "independent-review" | "deterministic-appeal",
  highAssurance = false,
): void {
  if (!credential || credential.status !== "active" || credential.role !== "evidence-reviewer" || credential.subjectRootIdentityId !== reviewerRootIdentityId || !credential.scopes.includes(scope)) {
    reject("REVIEWER_INELIGIBLE", "Reviewer lacks an active credential for this review scope", { reviewerRootIdentityId, scope });
  }
  if (highAssurance && credential.assuranceLevel !== "high") reject("REVIEWER_INELIGIBLE", "Deterministic appeal resolution requires high-assurance human review", { reviewerRootIdentityId });
  const at = Date.parse(evaluatedAt);
  if (!credential.proof || at < Date.parse(credential.issuedAt) || at >= Date.parse(credential.expiresAt)) reject("REVIEWER_INELIGIBLE", "Human review credential is outside its validity period", { reviewerRootIdentityId });
  if (!disclosure || disclosure.reviewerRootIdentityId !== reviewerRootIdentityId || disclosure.evidenceDigest !== evidenceDigest || !disclosure.signature) reject("REVIEWER_INELIGIBLE", "Reviewer conflict disclosure does not bind to this evidence", { reviewerRootIdentityId });
  if (disclosure.hasConflict) reject("REVIEWER_INELIGIBLE", "A disclosed conflict makes the reviewer ineligible", { reviewerRootIdentityId, conflictTypes: disclosure.conflictTypes });
}

function validateAssignment(task: Task, assignment: ReviewAssignment, evidenceDigest: string): void {
  const author = currentCycle(task).closedBundle?.authorRootIdentityId;
  if (author === assignment.reviewerRootIdentityId) reject("REVIEWER_INELIGIBLE", "Evidence author cannot review their own bundle", { reviewerRootIdentityId: assignment.reviewerRootIdentityId });
  if (assignment.reviewerKind === "human") {
    validateHumanReviewer(assignment.reviewerRootIdentityId, assignment.humanReviewCredential, assignment.conflictDisclosure, evidenceDigest, assignment.assignedAt, "independent-review");
  } else if (assignment.reviewerKind === "model") {
    if (assignment.humanReviewCredential !== null || assignment.conflictDisclosure !== null) reject("REVIEW_POLICY_VIOLATION", "Model assignments cannot carry human credentials or disclosures");
  } else {
    reject("REVIEW_POLICY_VIOLATION", "Reviewer kind must be model or human");
  }
}

export function emptyTaskAggregate(streamId: string): TaskAggregate {
  return { aggregateType: "task", streamId, version: 0, task: null };
}

export function taskFromDefinition(definition: TaskDefinition, projectId: string, status: "open" | "active" = "open"): Task {
  return {
    ...structuredClone(definition),
    projectId,
    status,
    evidenceCycles: [],
    activeEvidenceCycle: 1,
    reviewContract: null,
    settlement: null,
    rejectionStage: null,
    completedAt: null,
  };
}

export function taskCreatedDraft(definition: TaskDefinition, projectId: string, status: "open" | "active"): EventDraft<unknown> {
  return { type: "TaskCreated", payload: { task: taskFromDefinition(definition, projectId, status) } };
}

export function deriveEvidenceBundleDigest(bundle: Omit<ClosedEvidenceBundle, "digest">): string {
  return digestJson(bundle as unknown as JsonValue);
}

export function deriveQuorumDigest(contract: ReviewContract, attestations = contract.attestations): string {
  return digestJson({
    reviewContractId: contract.reviewContractId,
    evidenceDigest: contract.evidenceDigest,
    policyVersion: contract.policyVersion,
    quorum: contract.quorum,
    attestations: [...attestations]
      .sort((left, right) => left.attestationId.localeCompare(right.attestationId))
      .map(({ attestationId, reviewerRootIdentityId, decision, signature }) => ({ attestationId, reviewerRootIdentityId, decision, signature })),
  } as JsonValue);
}

export function deriveSettlementId(taskId: string, acceptedEvidenceDigest: string, policyVersion: string): string {
  return `settlement_${digestJson({ taskId, acceptedEvidenceDigest, policyVersion }).slice(0, 32)}`;
}

function currentCycle(task: Task): EvidenceCycle {
  const cycle = task.evidenceCycles.find((candidate) => candidate.cycle === task.activeEvidenceCycle);
  if (!cycle) reject("NOT_FOUND", "Active evidence cycle does not exist");
  return cycle;
}

function validateSettlementEffects(effects: SettlementEffects): void {
  for (const amount of [...effects.baseCurrency.map(({ amount }) => amount), ...effects.xp.map(({ amount }) => amount), ...effects.skillXp.map(({ amount }) => amount)]) {
    if (!Number.isInteger(amount) || amount < 0) reject("SETTLEMENT_MISMATCH", "Settlement amounts must be non-negative integers");
  }
}

function validateReviewBinding(task: Task, supplied: ReviewContract): ClosedEvidenceBundle {
  const bundle = currentCycle(task).closedBundle;
  if (!bundle) reject("INVALID_TRANSITION", "Review requires closed evidence");
  if (!supplied || supplied.taskId !== task.taskId || supplied.submissionId !== bundle.submissionId) reject("REVIEW_POLICY_VIOLATION", "Review input targets another task or submission");
  if (supplied.evidenceDigest !== bundle.digest || supplied.deterministicGate?.evidenceDigest !== bundle.digest) reject("EVIDENCE_DIGEST_MISMATCH", "Proof and review must bind to the closed evidence digest");
  if (supplied.deterministicGate.policyVersion !== supplied.policyVersion) reject("REVIEW_POLICY_VIOLATION", "Proof and review policy versions differ");
  return bundle;
}

function buildReviewContract(task: Task, supplied: ReviewContract, openingBasis: ReviewContract["openingBasis"], appealId: string | null): ReviewContract {
  const reviewers = supplied.assignments.map(({ reviewerRootIdentityId }) => reviewerRootIdentityId);
  if (reviewers.length === 0 || new Set(reviewers).size !== reviewers.length) reject("REVIEW_POLICY_VIOLATION", "Review assignments must be non-empty and unique");
  supplied.assignments.forEach((assignment) => validateAssignment(task, assignment, supplied.evidenceDigest));
  if (!Number.isInteger(supplied.quorum) || supplied.quorum < 1 || supplied.quorum > reviewers.length) reject("REVIEW_POLICY_VIOLATION", "Symmetrical review quorum is impossible");
  if (!Number.isInteger(supplied.maxReassignments) || supplied.maxReassignments < 0) reject("REVIEW_POLICY_VIOLATION", "Review reassignment bound is invalid");
  return {
    ...structuredClone(supplied),
    openingBasis,
    appealId,
    assignments: supplied.assignments.map((assignment) => ({ ...assignment, status: "assigned" })),
    reassignmentsUsed: 0,
    status: "collecting",
    resolution: null,
    attestations: [],
    quorumDigest: null,
  };
}

function decideOpenReview(command: CanonicalCommand, task: Task): EventDraft<unknown>[] {
  assertTaskCommandAllowed("OpenReview", task.status);
  const supplied = payload(command).reviewContract as ReviewContract;
  const bundle = validateReviewBinding(task, supplied);
  const gate = supplied.deterministicGate;
  if (!Array.isArray(gate.resultCodes) || gate.resultCodes.length === 0 || new Set(gate.resultCodes).size !== gate.resultCodes.length) reject("REVIEW_POLICY_VIOLATION", "Deterministic proof requires unique result codes");
  if (!sameActor(gate.evaluatedBy, command.actor)) reject("REVIEW_POLICY_VIOLATION", "Deterministic proof actor must match the canonical command actor");
  if (supplied.openingBasis !== "deterministic-pass" || supplied.appealId !== null) reject("REVIEW_POLICY_VIOLATION", "Normal review must open from deterministic proof rather than appeal");
  if (gate.decision === "reject") {
    if (gate.rejectionReasons.length === 0 || gate.checks.every(({ passed }) => passed)) reject("REVIEW_POLICY_VIOLATION", "Deterministic rejection requires a failed check and reasons");
    assertTaskStatusTransition(task.status, "rejected", command.type);
    return [{ type: "DeterministicProofRejected", payload: { taskId: task.taskId, evidenceDigest: bundle.digest, policyVersion: gate.policyVersion, resultCodes: gate.resultCodes, rejectionStage: "deterministic", reasons: gate.rejectionReasons, evaluatedBy: gate.evaluatedBy, evaluatedAt: gate.evaluatedAt } }];
  }
  if (gate.checks.some(({ passed }) => !passed) || gate.rejectionReasons.length > 0) reject("REVIEW_POLICY_VIOLATION", "A passing deterministic gate cannot contain failed checks or rejection reasons");
  const contract = buildReviewContract(task, supplied, "deterministic-pass", null);
  assertTaskStatusTransition(task.status, "review_pending", command.type);
  return [
    { type: "DeterministicProofPassed", payload: { taskId: task.taskId, evidenceDigest: bundle.digest, policyVersion: gate.policyVersion, resultCodes: gate.resultCodes, evaluatedBy: gate.evaluatedBy, evaluatedAt: gate.evaluatedAt } },
    { type: "ReviewOpened", payload: { taskId: task.taskId, contract } },
  ];
}

function decideFileDeterministicAppeal(command: CanonicalCommand, task: Task): EventDraft<unknown>[] {
  assertTaskCommandAllowed("FileDeterministicAppeal", task.status);
  if (command.actor.kind !== "human") reject("REVIEWER_INELIGIBLE", "Only a person may file a deterministic appeal");
  if (task.rejectionStage !== "deterministic") reject("INVALID_TRANSITION", "Only deterministic rejection may be appealed");
  const cycle = currentCycle(task);
  if (cycle.deterministicAppeal) reject("APPEAL_ALREADY_USED", "Only one deterministic appeal is allowed per evidence cycle", { cycle: cycle.cycle });
  const input = payload(command);
  const appeal: DeterministicAppeal = {
    appealId: requireText(input.appealId, "appealId"),
    cycle: cycle.cycle,
    evidenceDigest: cycle.closedBundle!.digest,
    filedByRootIdentityId: command.actor.rootIdentityId,
    grounds: requireText(input.grounds, "grounds"),
    filedAt: command.issuedAt,
    status: "pending",
    resolvedByRootIdentityId: null,
    reviewerCredentialId: null,
    conflictDisclosureId: null,
    reasons: [],
    resolvedAt: null,
  };
  assertTaskStatusTransition(task.status, "deterministic_appeal_pending", command.type);
  return [{ type: "DeterministicAppealFiled", payload: { taskId: task.taskId, cycle: cycle.cycle, appeal } }];
}

function decideResolveDeterministicAppeal(command: CanonicalCommand, task: Task): EventDraft<unknown>[] {
  assertTaskCommandAllowed("ResolveDeterministicAppeal", task.status);
  if (command.actor.kind !== "human") reject("REVIEWER_INELIGIBLE", "Only an eligible human reviewer may resolve a deterministic appeal");
  const cycle = currentCycle(task);
  const appeal = cycle.deterministicAppeal;
  const input = payload(command);
  if (!appeal || appeal.status !== "pending" || input.appealId !== appeal.appealId) reject("NOT_FOUND", "Pending deterministic appeal does not match this command");
  if (command.actor.rootIdentityId === cycle.closedBundle?.authorRootIdentityId || command.actor.rootIdentityId === appeal.filedByRootIdentityId) reject("REVIEWER_INELIGIBLE", "Appeal reviewer must be independent of the author and filer");
  const credential = input.reviewerCredential as HumanReviewCredential;
  const disclosure = input.conflictDisclosure as ConflictDisclosure;
  validateHumanReviewer(command.actor.rootIdentityId, credential, disclosure, appeal.evidenceDigest, command.issuedAt, "deterministic-appeal", true);
  const reasons = requireArray<string>(input.reasons, "reasons");
  if (reasons.length === 0) reject("INVALID_COMMAND", "Appeal resolution requires reasons");
  const common = {
    taskId: task.taskId,
    cycle: cycle.cycle,
    appealId: appeal.appealId,
    evidenceDigest: appeal.evidenceDigest,
    resolvedByRootIdentityId: command.actor.rootIdentityId,
    reviewerCredentialId: credential.credentialId,
    conflictDisclosureId: disclosure.disclosureId,
    reasons,
    resolvedAt: command.issuedAt,
  };
  if (input.decision === "uphold") {
    if (input.reviewContract !== null) reject("INVALID_COMMAND", "Upheld appeal cannot open independent review");
    assertTaskStatusTransition(task.status, "rejected", command.type);
    return [{ type: "DeterministicAppealUpheld", payload: common }];
  }
  if (input.decision !== "overturn") reject("INVALID_COMMAND", "Appeal decision must be uphold or overturn");
  const supplied = input.reviewContract as ReviewContract;
  const bundle = validateReviewBinding(task, supplied);
  if (bundle.digest !== appeal.evidenceDigest || supplied.openingBasis !== "appeal-overturn" || supplied.appealId !== appeal.appealId) reject("EVIDENCE_DIGEST_MISMATCH", "Overturned appeal review must bind to the unchanged evidence digest and appeal");
  const contract = buildReviewContract(task, supplied, "appeal-overturn", appeal.appealId);
  assertTaskStatusTransition(task.status, "review_pending", command.type);
  return [
    { type: "DeterministicAppealOverturned", payload: common },
    { type: "ReviewOpened", payload: { taskId: task.taskId, contract } },
  ];
}

function decideAttestation(command: CanonicalCommand, task: Task): EventDraft<unknown>[] {
  assertTaskCommandAllowed("RecordReviewAttestation", task.status);
  const attestation = payload(command).attestation as ReviewAttestation;
  const contract = task.reviewContract;
  if (!contract || !["collecting", "human_escalation"].includes(contract.status)) reject("REVIEW_POLICY_VIOLATION", "Review contract is not collecting attestations");
  if (!attestation || attestation.reviewContractId !== contract.reviewContractId || attestation.taskId !== task.taskId || attestation.evidenceDigest !== contract.evidenceDigest || attestation.policyVersion !== contract.policyVersion) reject("EVIDENCE_DIGEST_MISMATCH", "Attestation does not bind to the active contract and evidence digest");
  const assignment = contract.assignments.find(({ reviewerRootIdentityId }) => reviewerRootIdentityId === attestation.reviewerRootIdentityId);
  if (!assignment || assignment.status !== "assigned") reject("REVIEW_POLICY_VIOLATION", "Reviewer is not assigned and active");
  if (actorRootIdentityId(command) !== attestation.reviewerRootIdentityId) reject("REVIEW_POLICY_VIOLATION", "Attestation actor must be the assigned reviewer identity");
  if (assignment.reviewerKind === "human") {
    if (command.actor.kind !== "human") reject("REVIEWER_INELIGIBLE", "Human review assignment requires a human canonical actor");
    validateHumanReviewer(assignment.reviewerRootIdentityId, assignment.humanReviewCredential, assignment.conflictDisclosure, contract.evidenceDigest, attestation.issuedAt, "independent-review");
  } else if (command.actor.kind !== "service") {
    reject("REVIEWER_INELIGIBLE", "Model review assignment requires an attributable delegated service actor");
  }
  if (contract.attestations.some(({ reviewerRootIdentityId }) => reviewerRootIdentityId === attestation.reviewerRootIdentityId)) reject("REVIEW_POLICY_VIOLATION", "Reviewer already attested");
  if (!attestation.signature || attestation.reasons.length === 0 || attestation.confidence < 0 || attestation.confidence > 1) reject("REVIEW_POLICY_VIOLATION", "Attestation is incomplete");
  if (Date.parse(attestation.issuedAt) < Date.parse(assignment.assignedAt)) reject("REVIEW_POLICY_VIOLATION", "Attestation predates reviewer assignment");
  if (contract.status !== "human_escalation" && Date.parse(attestation.issuedAt) > Date.parse(contract.expiresAt)) reject("REVIEW_POLICY_VIOLATION", "Expired attestations cannot resolve review");
  const attestations = [...contract.attestations, attestation];
  const approvals = attestations.filter(({ decision }) => decision === "approve").length;
  const rejections = attestations.filter(({ decision }) => decision === "reject").length;
  const drafts: EventDraft<unknown>[] = [{ type: "ReviewAttestationRecorded", payload: { taskId: task.taskId, attestation } }];
  if (approvals >= contract.quorum) {
    const quorumDigest = deriveQuorumDigest(contract, attestations);
    assertTaskStatusTransition(task.status, "accepted_pending_settlement", command.type);
    drafts.push({ type: "ReviewAccepted", payload: { taskId: task.taskId, reviewContractId: contract.reviewContractId, evidenceDigest: contract.evidenceDigest, policyVersion: contract.policyVersion, quorumDigest } });
  } else if (rejections >= contract.quorum) {
    const quorumDigest = deriveQuorumDigest(contract, attestations);
    assertTaskStatusTransition(task.status, "rejected", command.type);
    drafts.push({ type: "ReviewRejected", payload: { taskId: task.taskId, reviewContractId: contract.reviewContractId, evidenceDigest: contract.evidenceDigest, quorumDigest, rejectionStage: "independent", reasons: attestations.filter(({ decision }) => decision === "reject").flatMap(({ reasons }) => reasons) } });
  } else {
    assertTaskStatusTransition(task.status, "review_pending", command.type);
  }
  return drafts;
}

function decideInconclusive(command: CanonicalCommand, task: Task): EventDraft<unknown>[] {
  assertTaskCommandAllowed("ResolveReviewInconclusive", task.status);
  const input = payload(command);
  const contract = task.reviewContract;
  if (!contract || !["collecting", "human_escalation"].includes(contract.status)) reject("REVIEW_POLICY_VIOLATION", "Only a collecting review can resolve inconclusively");
  const approvals = contract.attestations.filter(({ decision }) => decision === "approve").length;
  const rejections = contract.attestations.filter(({ decision }) => decision === "reject").length;
  if (approvals >= contract.quorum || rejections >= contract.quorum) reject("REVIEW_POLICY_VIOLATION", "A reached quorum cannot be marked inconclusive");
  const resolvedAt = requireText(input.resolvedAt, "resolvedAt");
  const outstanding = contract.assignments.filter(({ status }) => status === "assigned").length;
  let reason: "timeout" | "exhausted-without-quorum" | "split-decision";
  if (Date.parse(resolvedAt) >= Date.parse(contract.expiresAt)) {
    reason = "timeout";
  } else {
    const approvalStillPossible = approvals + outstanding >= contract.quorum;
    const rejectionStillPossible = rejections + outstanding >= contract.quorum;
    if (approvalStillPossible || rejectionStillPossible) reject("REVIEW_POLICY_VIOLATION", "Review is not deterministically inconclusive yet", { approvals, rejections, outstanding, quorum: contract.quorum });
    reason = approvals > 0 && rejections > 0 ? "split-decision" : "exhausted-without-quorum";
  }
  assertTaskStatusTransition(task.status, "review_pending", command.type);
  return [{ type: "ReviewInconclusive", payload: { taskId: task.taskId, reviewContractId: contract.reviewContractId, reason, approvals, rejections, outstanding, expiredReviewerRootIdentityIds: [], resolvedAt } }];
}

function validateNewAssignments(task: Task, contract: ReviewContract, assignments: ReviewAssignment[]): void {
  if (assignments.length === 0) reject("REVIEW_POLICY_VIOLATION", "At least one new assignment is required");
  const ids = assignments.map(({ reviewerRootIdentityId }) => reviewerRootIdentityId);
  if (new Set(ids).size !== ids.length) reject("REVIEW_POLICY_VIOLATION", "New reviewer assignments must be unique");
  const author = currentCycle(task).closedBundle?.authorRootIdentityId;
  if (author && ids.includes(author)) reject("REVIEW_POLICY_VIOLATION", "Evidence author cannot be assigned as reviewer");
  const prior = new Set(contract.assignments.map(({ reviewerRootIdentityId }) => reviewerRootIdentityId));
  if (ids.some((id) => prior.has(id))) reject("REVIEW_POLICY_VIOLATION", "Reassignment must select new independent reviewers");
  assignments.forEach((assignment) => validateAssignment(task, assignment, contract.evidenceDigest));
}

function decideReassignment(command: CanonicalCommand, task: Task): EventDraft<unknown>[] {
  assertTaskCommandAllowed("ReassignReviewers", task.status);
  const input = payload(command);
  const contract = task.reviewContract;
  if (!contract || contract.status !== "inconclusive") reject("REVIEW_POLICY_VIOLATION", "Reviewer reassignment requires an inconclusive review");
  if (contract.reassignmentsUsed >= contract.maxReassignments) reject("REVIEW_REASSIGNMENT_LIMIT", "Review reassignment limit is exhausted");
  const expired = requireArray<string>(input.expiredReviewerRootIdentityIds, "expiredReviewerRootIdentityIds");
  const assignments = requireArray<ReviewAssignment>(input.newAssignments, "newAssignments");
  if (expired.length === 0 || expired.some((id) => !contract.assignments.some((assignment) => assignment.reviewerRootIdentityId === id && assignment.status === "assigned"))) reject("REVIEW_POLICY_VIOLATION", "Expired reviewers must identify current outstanding assignments");
  validateNewAssignments(task, contract, assignments);
  return [{ type: "ReviewersReassigned", payload: { taskId: task.taskId, reviewContractId: contract.reviewContractId, expiredReviewerRootIdentityIds: expired, newAssignments: assignments.map((assignment) => ({ ...assignment, status: "assigned" })), reassignmentsUsed: contract.reassignmentsUsed + 1 } }];
}

function decideHumanEscalation(command: CanonicalCommand, task: Task): EventDraft<unknown>[] {
  assertTaskCommandAllowed("EscalateReviewToHuman", task.status);
  const input = payload(command);
  const contract = task.reviewContract;
  if (!contract || contract.status !== "inconclusive") reject("REVIEW_POLICY_VIOLATION", "Human escalation requires an inconclusive review");
  const assignments = requireArray<ReviewAssignment>(input.humanAssignments, "humanAssignments");
  validateNewAssignments(task, contract, assignments);
  if (assignments.some(({ reviewerKind }) => reviewerKind !== "human")) reject("REVIEWER_INELIGIBLE", "Human escalation requires human assignments with credentials and disclosures");
  const replacedModelReviewerRootIdentityIds = contract.assignments.filter(({ reviewerKind, status }) => reviewerKind === "model" && status === "assigned").map(({ reviewerRootIdentityId }) => reviewerRootIdentityId);
  return [{ type: "ReviewEscalatedToHuman", payload: { taskId: task.taskId, reviewContractId: contract.reviewContractId, replacedModelReviewerRootIdentityIds, humanAssignments: assignments.map((assignment) => ({ ...assignment, status: "assigned" })), reason: requireText(input.reason, "reason") } }];
}

function decideSettlement(command: CanonicalCommand, task: Task): EventDraft<unknown>[] {
  assertTaskCommandAllowed("SettleAcceptedTask", task.status);
  const input = payload(command);
  const intent = input.intent as SettlementIntent;
  const contract = task.reviewContract;
  if (!contract || contract.status !== "approved" || !contract.quorumDigest) reject("SETTLEMENT_MISMATCH", "Settlement requires approved symmetrical quorum");
  const expectedId = deriveSettlementId(task.taskId, contract.evidenceDigest, contract.policyVersion);
  if (!intent || intent.settlementId !== expectedId || intent.taskId !== task.taskId || intent.acceptedEvidenceDigest !== contract.evidenceDigest || intent.policyVersion !== contract.policyVersion || intent.reviewContractId !== contract.reviewContractId || intent.quorumDigest !== contract.quorumDigest) reject("SETTLEMENT_MISMATCH", "Settlement intent differs from the accepted evidence and policy snapshot");
  if (intent.idempotencyKey !== command.idempotencyKey) reject("SETTLEMENT_MISMATCH", "Settlement and command idempotency keys differ");
  validateSettlementEffects(intent.effects);
  assertTaskStatusTransition(task.status, "settled", command.type);
  return [{ type: "SettlementCommitted", payload: { taskId: task.taskId, intent, transactionId: requireText(input.transactionId, "transactionId"), committedAt: command.issuedAt } }];
}

export function decideTaskCommand(state: TaskAggregate, command: CanonicalCommand): EventDraft<unknown>[] {
  const task = requireTask(state);
  const input = payload(command);
  if (typeof input.taskId === "string" && input.taskId !== task.taskId) reject("NOT_FOUND", "Command targets another task", { taskId: String(input.taskId) });
  switch (command.type) {
    case "EditTask":
      assertTaskCommandAllowed("EditTask", task.status);
      return [{ type: "TaskEdited", payload: { taskId: task.taskId, title: requireText(input.title, "title"), description: requireText(input.description, "description"), proofRequirement: requireText(input.proofRequirement, "proofRequirement") } }];
    case "AssignTask":
      assertTaskCommandAllowed("AssignTask", task.status);
      if (input.ownerRootIdentityId !== null) requireText(input.ownerRootIdentityId, "ownerRootIdentityId");
      return [{ type: "TaskAssigned", payload: { taskId: task.taskId, ownerRootIdentityId: input.ownerRootIdentityId } }];
    case "ActivateTask":
      assertTaskCommandAllowed("ActivateTask", task.status);
      if (task.dependencyIds.length > 0) reject("INVALID_TRANSITION", "Dependent tasks activate only through atomic finalization");
      assertTaskStatusTransition(task.status, "active", command.type);
      return [{ type: "TaskActivated", payload: { taskId: task.taskId } }];
    case "SubmitEvidenceDraft": {
      assertTaskCommandAllowed("SubmitEvidenceDraft", task.status);
      const existing = task.evidenceCycles.find(({ cycle }) => cycle === task.activeEvidenceCycle)?.draft;
      const submissionId = requireText(input.submissionId, "submissionId");
      if (existing && existing.submissionId !== submissionId) reject("CONFLICT", "A mutable cycle cannot change submission identity");
      assertTaskStatusTransition(task.status, "submitted", command.type);
      return [{ type: "EvidenceDraftSubmitted", payload: { taskId: task.taskId, cycle: task.activeEvidenceCycle, draft: { submissionId, narrative: requireText(input.narrative, "narrative"), artifacts: requireArray(input.artifacts, "artifacts"), submittedByRootIdentityId: actorRootIdentityId(command), submittedAt: command.issuedAt } } }];
    }
    case "WithdrawEvidenceDraft":
      assertTaskCommandAllowed("WithdrawEvidenceDraft", task.status);
      if (currentCycle(task).draft?.submissionId !== input.submissionId) reject("NOT_FOUND", "Submission draft does not exist");
      assertTaskStatusTransition(task.status, "active", command.type);
      return [{ type: "EvidenceDraftWithdrawn", payload: { taskId: task.taskId, cycle: task.activeEvidenceCycle, submissionId: input.submissionId } }];
    case "CloseEvidence": {
      assertTaskCommandAllowed("CloseEvidence", task.status);
      const cycle = currentCycle(task);
      if (!cycle.draft || cycle.draft.submissionId !== input.submissionId) reject("NOT_FOUND", "Submission draft does not exist");
      const unsigned: Omit<ClosedEvidenceBundle, "digest"> = { taskId: task.taskId, submissionId: cycle.draft.submissionId, cycle: cycle.cycle, narrative: cycle.draft.narrative, artifacts: cycle.draft.artifacts, authorRootIdentityId: cycle.draft.submittedByRootIdentityId, closedAt: command.issuedAt };
      const digest = deriveEvidenceBundleDigest(unsigned);
      if (input.expectedBundleDigest !== digest) reject("EVIDENCE_DIGEST_MISMATCH", "Confirmed evidence digest differs from the bundle being closed", { expected: String(input.expectedBundleDigest), actual: digest });
      assertTaskStatusTransition(task.status, "evidence_closed", command.type);
      return [{ type: "EvidenceClosed", payload: { taskId: task.taskId, cycle: cycle.cycle, bundle: { ...unsigned, digest } } }];
    }
    case "OpenReview":
      return decideOpenReview(command, task);
    case "FileDeterministicAppeal":
      return decideFileDeterministicAppeal(command, task);
    case "ResolveDeterministicAppeal":
      return decideResolveDeterministicAppeal(command, task);
    case "RecordReviewAttestation":
      return decideAttestation(command, task);
    case "ResolveReviewInconclusive":
      return decideInconclusive(command, task);
    case "ReassignReviewers":
      return decideReassignment(command, task);
    case "EscalateReviewToHuman":
      return decideHumanEscalation(command, task);
    case "BeginCorrectionCycle":
      assertTaskCommandAllowed("BeginCorrectionCycle", task.status);
      assertTaskStatusTransition(task.status, "active", command.type);
      return [{ type: "CorrectionCycleStarted", payload: { taskId: task.taskId, cycle: task.activeEvidenceCycle + 1 } }];
    case "SettleAcceptedTask":
      return decideSettlement(command, task);
    case "FinalizeCompletedTask":
      assertTaskCommandAllowed("FinalizeCompletedTask", task.status);
      reject("INVALID_COMMAND", "FinalizeCompletedTask must use the atomic multi-stream finalization coordinator");
    default:
      reject("INVALID_COMMAND", `${command.type} is not a task command`);
  }
}

export function evolveTask(state: TaskAggregate, event: { type: string; streamVersion: number; payload: unknown }): TaskAggregate {
  const next = structuredClone(state);
  const input = event.payload as Payload;
  switch (event.type) {
    case "TaskCreated":
      next.task = input.task as Task;
      break;
    case "TaskEdited":
      Object.assign(next.task!, { title: input.title, description: input.description, proofRequirement: input.proofRequirement });
      break;
    case "TaskAssigned":
      next.task!.ownerRootIdentityId = input.ownerRootIdentityId as string | null;
      break;
    case "TaskActivated":
    case "TaskDependencyActivated":
      next.task!.status = "active";
      break;
    case "EvidenceDraftSubmitted": {
      let cycle = next.task!.evidenceCycles.find(({ cycle }) => cycle === input.cycle);
      if (!cycle) {
        cycle = { cycle: input.cycle as number, status: "draft", draft: null, closedBundle: null, rejectionReasons: [], deterministicAppeal: null };
        next.task!.evidenceCycles.push(cycle);
      }
      cycle.draft = input.draft as EvidenceCycle["draft"];
      cycle.status = "draft";
      next.task!.status = "submitted";
      break;
    }
    case "EvidenceDraftWithdrawn":
      next.task!.status = "active";
      break;
    case "EvidenceClosed": {
      const cycle = next.task!.evidenceCycles.find(({ cycle }) => cycle === input.cycle)!;
      cycle.closedBundle = input.bundle as ClosedEvidenceBundle;
      cycle.status = "closed";
      next.task!.status = "evidence_closed";
      break;
    }
    case "DeterministicProofRejected": {
      next.task!.status = "rejected";
      next.task!.rejectionStage = "deterministic";
      const cycle = currentCycle(next.task!);
      cycle.status = "rejected";
      cycle.rejectionReasons = [...(input.reasons as string[])];
      break;
    }
    case "DeterministicAppealFiled":
      currentCycle(next.task!).deterministicAppeal = input.appeal as DeterministicAppeal;
      next.task!.status = "deterministic_appeal_pending";
      break;
    case "DeterministicAppealUpheld": {
      const appeal = currentCycle(next.task!).deterministicAppeal!;
      Object.assign(appeal, {
        status: "upheld",
        resolvedByRootIdentityId: input.resolvedByRootIdentityId,
        reviewerCredentialId: input.reviewerCredentialId,
        conflictDisclosureId: input.conflictDisclosureId,
        reasons: structuredClone(input.reasons),
        resolvedAt: input.resolvedAt,
      });
      next.task!.status = "rejected";
      next.task!.rejectionStage = "deterministic";
      break;
    }
    case "DeterministicAppealOverturned": {
      const appeal = currentCycle(next.task!).deterministicAppeal!;
      Object.assign(appeal, {
        status: "overturned",
        resolvedByRootIdentityId: input.resolvedByRootIdentityId,
        reviewerCredentialId: input.reviewerCredentialId,
        conflictDisclosureId: input.conflictDisclosureId,
        reasons: structuredClone(input.reasons),
        resolvedAt: input.resolvedAt,
      });
      next.task!.rejectionStage = null;
      break;
    }
    case "ReviewOpened":
      next.task!.reviewContract = input.contract as ReviewContract;
      next.task!.status = "review_pending";
      break;
    case "ReviewAttestationRecorded": {
      const attestation = input.attestation as ReviewAttestation;
      next.task!.reviewContract!.attestations.push(attestation);
      next.task!.reviewContract!.assignments.find(({ reviewerRootIdentityId }) => reviewerRootIdentityId === attestation.reviewerRootIdentityId)!.status = "returned";
      break;
    }
    case "ReviewAccepted":
      next.task!.status = "accepted_pending_settlement";
      next.task!.reviewContract!.status = "approved";
      next.task!.reviewContract!.resolution = "approved";
      next.task!.reviewContract!.quorumDigest = input.quorumDigest as string;
      currentCycle(next.task!).status = "accepted";
      break;
    case "ReviewRejected":
      next.task!.status = "rejected";
      next.task!.rejectionStage = "independent";
      next.task!.reviewContract!.status = "rejected";
      next.task!.reviewContract!.resolution = "rejected";
      next.task!.reviewContract!.quorumDigest = input.quorumDigest as string;
      currentCycle(next.task!).status = "rejected";
      currentCycle(next.task!).rejectionReasons = [...(input.reasons as string[])];
      break;
    case "ReviewInconclusive":
      next.task!.reviewContract!.status = "inconclusive";
      next.task!.reviewContract!.resolution = "inconclusive";
      break;
    case "ReviewersReassigned":
      for (const reviewerId of input.expiredReviewerRootIdentityIds as string[]) next.task!.reviewContract!.assignments.find(({ reviewerRootIdentityId }) => reviewerRootIdentityId === reviewerId)!.status = "expired";
      next.task!.reviewContract!.assignments.push(...structuredClone(input.newAssignments as ReviewAssignment[]));
      next.task!.reviewContract!.reassignmentsUsed = input.reassignmentsUsed as number;
      next.task!.reviewContract!.status = "collecting";
      next.task!.reviewContract!.resolution = null;
      break;
    case "ReviewEscalatedToHuman":
      for (const reviewerId of input.replacedModelReviewerRootIdentityIds as string[]) next.task!.reviewContract!.assignments.find(({ reviewerRootIdentityId }) => reviewerRootIdentityId === reviewerId)!.status = "revoked";
      next.task!.reviewContract!.assignments.push(...structuredClone(input.humanAssignments as ReviewAssignment[]));
      next.task!.reviewContract!.status = "human_escalation";
      next.task!.reviewContract!.resolution = "human_escalation";
      break;
    case "CorrectionCycleStarted":
      next.task!.activeEvidenceCycle = input.cycle as number;
      next.task!.status = "active";
      next.task!.reviewContract = null;
      next.task!.rejectionStage = null;
      next.task!.evidenceCycles.push({ cycle: input.cycle as number, status: "draft", draft: null, closedBundle: null, rejectionReasons: [], deterministicAppeal: null });
      break;
    case "SettlementCommitted":
      next.task!.status = "settled";
      next.task!.settlement = { intent: input.intent as SettlementIntent, transactionId: input.transactionId as string, committedAt: input.committedAt as string };
      break;
    case "TaskCompleted":
      next.task!.status = "completed";
      next.task!.completedAt = input.completedAt as string;
      break;
  }
  next.version = event.streamVersion;
  return next;
}

export function taskStatus(state: TaskAggregate): TaskStatus | null {
  return state.task?.status ?? null;
}
