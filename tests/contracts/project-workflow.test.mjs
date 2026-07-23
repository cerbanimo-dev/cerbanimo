import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveEvidenceBundleDigest,
  deriveProjectProgress,
  deriveSettlementId,
  emptyProjectAggregate,
  emptyTaskAggregate,
  executeCommand,
  executeProjectCommandAtomically,
  finalizeTaskAtomically,
} from "../../.build/packages/domain/src/index.js";
import { command, expectAccepted, expectRejected, humanActor, serviceActor } from "./support/commands.mjs";

const reviewerA = { kind: "human", rootIdentityId: "root_reviewer_a", deviceId: "device_reviewer_a", roles: ["reviewer"] };
const reviewerB = { kind: "human", rootIdentityId: "root_reviewer_b", deviceId: "device_reviewer_b", roles: ["reviewer"] };
const reviewerC = { kind: "human", rootIdentityId: "root_reviewer_c", deviceId: "device_reviewer_c", roles: ["reviewer"] };
const reviewerD = { kind: "human", rootIdentityId: "root_reviewer_d", deviceId: "device_reviewer_d", roles: ["human-escalation"] };

function reviewerCredential(reviewer, scopes = ["independent-review"], assuranceLevel = "substantial") {
  return {
    credentialId: `credential_${reviewer.rootIdentityId}_${scopes.join("_")}`,
    subjectRootIdentityId: reviewer.rootIdentityId,
    issuer: "review-authority_sol",
    role: "evidence-reviewer",
    scopes,
    assuranceLevel,
    issuedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2027-07-01T00:00:00.000Z",
    status: "active",
    proof: `credential-proof-${reviewer.rootIdentityId}`,
  };
}

function conflictDisclosure(reviewer, evidenceDigest, hasConflict = false) {
  return {
    disclosureId: `disclosure_${reviewer.rootIdentityId}_${evidenceDigest.slice(0, 8)}`,
    reviewerRootIdentityId: reviewer.rootIdentityId,
    evidenceDigest,
    hasConflict,
    conflictTypes: hasConflict ? ["prior-collaboration"] : [],
    statement: hasConflict ? "Prior collaboration disclosed." : "No known conflict.",
    disclosedAt: "2026-07-22T21:09:00.000Z",
    signature: `disclosure-proof-${reviewer.rootIdentityId}`,
  };
}

function taskDefinition(taskId, dependencyIds = []) {
  return {
    taskId,
    title: `Task ${taskId}`,
    description: `Complete accountable work for ${taskId}.`,
    proofRequirement: `Publish a concrete artifact for ${taskId}.`,
    dependencyIds,
    ownerRootIdentityId: "root_cami",
  };
}

function createProject(suffix, definitions) {
  const project = emptyProjectAggregate(`project:${suffix}`);
  const taskStates = Object.fromEntries(definitions.map(({ taskId }) => [`task:${taskId}`, emptyTaskAggregate(`task:${taskId}`)]));
  const create = command("CreateProject", project.streamId, 0, { projectId: `project_${suffix}`, title: `Project ${suffix}`, description: "Packet 001 aggregate contract.", tasks: definitions });
  const result = executeProjectCommandAtomically(project, taskStates, create);
  assert.equal(result.accepted, true);
  return { project: result.projectState, tasks: result.taskStates, result };
}

function runTask(state, canonicalCommand) {
  return expectAccepted(executeCommand(state, canonicalCommand));
}

function submitAndClose(state, suffix) {
  const task = state.task;
  const submissionId = `submission_${suffix}`;
  const narrative = `Completed ${task.title} with independently inspectable evidence.`;
  const artifacts = [{ artifactId: `artifact_${suffix}`, uri: `field://${suffix}`, mediaType: "application/json", digest: "b".repeat(64) }];
  const submittedAt = "2026-07-22T21:00:00.000Z";
  state = runTask(state, command("SubmitEvidenceDraft", state.streamId, state.version, { taskId: task.taskId, submissionId, narrative, artifacts }, { issuedAt: submittedAt })).state;
  const closedAt = "2026-07-22T21:05:00.000Z";
  const expectedBundleDigest = deriveEvidenceBundleDigest({ taskId: task.taskId, submissionId, cycle: task.activeEvidenceCycle, narrative, artifacts, authorRootIdentityId: humanActor.rootIdentityId, closedAt });
  state = runTask(state, command("CloseEvidence", state.streamId, state.version, { taskId: task.taskId, submissionId, expectedBundleDigest }, { issuedAt: closedAt })).state;
  return state;
}

function reviewContract(task, reviewers, overrides = {}) {
  const bundle = task.evidenceCycles.find(({ cycle }) => cycle === task.activeEvidenceCycle).closedBundle;
  const gateDecision = overrides.gateDecision ?? "pass";
  return {
    reviewContractId: overrides.reviewContractId ?? `review_${task.taskId}_${task.activeEvidenceCycle}`,
    taskId: task.taskId,
    submissionId: bundle.submissionId,
    evidenceDigest: overrides.evidenceDigest ?? bundle.digest,
    policyVersion: "review-policy/1",
    deterministicGate: {
      policyVersion: "review-policy/1",
      evidenceDigest: bundle.digest,
      decision: gateDecision,
      checks: [{ checkId: "concrete-artifact", passed: gateDecision === "pass", detail: gateDecision === "pass" ? "Concrete artifact found." : "Artifact is missing." }],
      resultCodes: [gateDecision === "pass" ? "ARTIFACT_PRESENT" : "ARTIFACT_MISSING"],
      rejectionReasons: gateDecision === "reject" ? ["Required artifact is missing."] : [],
      evaluatedBy: humanActor,
      evaluatedAt: "2026-07-22T21:10:00.000Z",
    },
    openingBasis: overrides.openingBasis ?? "deterministic-pass",
    appealId: overrides.appealId ?? null,
    assignmentSeedCommitment: "a".repeat(64),
    assignments: reviewers.map((reviewer, index) => {
      const reviewerKind = overrides.modelReviewerIds?.includes(reviewer.rootIdentityId) ? "model" : "human";
      return { reviewerRootIdentityId: reviewer.rootIdentityId, reviewerKind, humanReviewCredential: reviewerKind === "human" ? reviewerCredential(reviewer) : null, conflictDisclosure: reviewerKind === "human" ? conflictDisclosure(reviewer, bundle.digest) : null, assignedAt: `2026-07-22T21:1${index}:00.000Z`, assignmentProof: `assignment-proof-${index}`, status: "assigned" };
    }),
    quorum: overrides.quorum ?? reviewers.length,
    maxReassignments: overrides.maxReassignments ?? 1,
    reassignmentsUsed: 0,
    expiresAt: overrides.expiresAt ?? "2026-07-23T21:00:00.000Z",
    status: "collecting",
    resolution: null,
    attestations: [],
    quorumDigest: null,
  };
}

function attestation(task, contract, reviewer, decision, id, issuedAt = "2026-07-22T21:20:00.000Z") {
  return {
    attestationId: id,
    reviewContractId: contract.reviewContractId,
    taskId: task.taskId,
    submissionId: contract.submissionId,
    evidenceDigest: contract.evidenceDigest,
    reviewerRootIdentityId: reviewer.rootIdentityId,
    decision,
    confidence: 0.91,
    reasons: [decision === "approve" ? "Evidence satisfies the requirement." : "Evidence omits the required artifact."],
    policyVersion: contract.policyVersion,
    signature: `signed-${id}`,
    issuedAt,
  };
}

function openReview(state, reviewers, overrides = {}) {
  const contract = reviewContract(state.task, reviewers, overrides);
  const result = runTask(state, command("OpenReview", state.streamId, state.version, { taskId: state.task.taskId, reviewContract: contract }));
  return { state: result.state, contract, events: result.events };
}

function settle(state, suffix) {
  const contract = state.task.reviewContract;
  const idempotencyKey = `idem_settle_${suffix}`;
  const intent = {
    settlementId: deriveSettlementId(state.task.taskId, contract.evidenceDigest, contract.policyVersion),
    taskId: state.task.taskId,
    acceptedEvidenceDigest: contract.evidenceDigest,
    policyVersion: contract.policyVersion,
    reviewContractId: contract.reviewContractId,
    quorumDigest: contract.quorumDigest,
    effects: { baseCurrency: [], xp: [{ accountId: "root_cami", amount: 10 }], skillXp: [], specimens: [], other: [] },
    idempotencyKey,
  };
  const canonicalCommand = command("SettleAcceptedTask", state.streamId, state.version, { taskId: state.task.taskId, intent, transactionId: `tx_${suffix}` }, { actor: serviceActor, idempotencyKey });
  return { intent, canonicalCommand, result: runTask(state, canonicalCommand) };
}

function approve(state, reviewers, suffix) {
  const opened = openReview(state, reviewers, { reviewContractId: `review_${suffix}`, quorum: reviewers.length });
  state = opened.state;
  for (let index = 0; index < reviewers.length; index += 1) {
    const reviewer = reviewers[index];
    state = runTask(state, command("RecordReviewAttestation", state.streamId, state.version, { taskId: state.task.taskId, attestation: attestation(state.task, opened.contract, reviewer, "approve", `att_${suffix}_${index}`) }, { actor: reviewer })).state;
  }
  return state;
}

const continuationOptions = [
  { continuationId: "continue_deepen", title: "Deepen", description: "Extend the same practice." },
  { continuationId: "continue_share", title: "Share", description: "Teach another community." },
  { continuationId: "continue_transform", title: "Transform", description: "Open a different chapter." },
];

test("project topology and task lifecycle are separate aggregates with atomic finalization", () => {
  let { project, tasks } = createProject("split", [taskDefinition("task_one"), taskDefinition("task_two", ["task_one"])]);
  assert.equal("tasks" in project, false);
  assert.deepEqual(Object.keys(project.taskGraph), ["task_one", "task_two"]);
  assert.equal(tasks["task:task_one"].task.status, "active");
  assert.equal(tasks["task:task_two"].task.status, "open");

  let first = submitAndClose(tasks["task:task_one"], "one");
  assert.equal(project.version, 3, "task evidence must not mutate the project stream");
  first = approve(first, [reviewerA, reviewerB], "one");
  assert.equal(first.task.status, "accepted_pending_settlement");
  const settlement = settle(first, "one");
  first = settlement.result.state;
  assert.equal(first.task.status, "settled");

  const staleFinalize = command("FinalizeCompletedTask", first.streamId, first.version, {
    taskId: "task_one",
    projectExpectation: { streamId: project.streamId, expectedStreamVersion: project.version },
    dependentTaskExpectations: [{ streamId: "task:task_two", expectedStreamVersion: tasks["task:task_two"].version + 1 }],
    continuationOptions: [],
  });
  const stale = finalizeTaskAtomically(first, project, { "task:task_two": tasks["task:task_two"] }, staleFinalize);
  assert.equal(stale.accepted, false);
  assert.equal(stale.rejection.code, "STALE_STREAM_VERSION");
  assert.equal(stale.events.length, 0);
  assert.equal(stale.taskState.task.status, "settled");
  assert.equal(stale.projectState.completedTaskIds.length, 0);
  assert.equal(stale.dependentTaskStates["task:task_two"].task.status, "open");

  const finalize = command("FinalizeCompletedTask", first.streamId, first.version, {
    taskId: "task_one",
    projectExpectation: { streamId: project.streamId, expectedStreamVersion: project.version },
    dependentTaskExpectations: [{ streamId: "task:task_two", expectedStreamVersion: tasks["task:task_two"].version }],
    continuationOptions: [],
  });
  const finalized = finalizeTaskAtomically(first, project, { "task:task_two": tasks["task:task_two"] }, finalize);
  assert.equal(finalized.accepted, true);
  first = finalized.taskState;
  project = finalized.projectState;
  tasks["task:task_one"] = first;
  tasks["task:task_two"] = finalized.dependentTaskStates["task:task_two"];
  assert.deepEqual(new Set(finalized.events.map(({ streamId }) => streamId)), new Set([first.streamId, project.streamId, "task:task_two"]));
  assert.equal(first.task.status, "completed");
  assert.equal(tasks["task:task_two"].task.status, "active");
  assert.deepEqual(project.completedTaskIds, ["task_one"]);
  assert.equal(deriveProjectProgress(project), 50);

  let second = submitAndClose(tasks["task:task_two"], "two");
  second = approve(second, [reviewerA], "two");
  second = settle(second, "two").result.state;
  const finalProject = finalizeTaskAtomically(second, project, {}, command("FinalizeCompletedTask", second.streamId, second.version, {
    taskId: "task_two",
    projectExpectation: { streamId: project.streamId, expectedStreamVersion: project.version },
    dependentTaskExpectations: [],
    continuationOptions,
  }));
  assert.equal(finalProject.accepted, true);
  assert.equal(finalProject.taskState.task.status, "completed");
  assert.equal(finalProject.projectState.project.status, "completed");
  assert.equal(finalProject.projectState.project.continuationOffers.length, 3);
  assert.equal(deriveProjectProgress(finalProject.projectState), 100);
});

test("deterministic rejection is an event and correction opens a new immutable evidence cycle", () => {
  const created = createProject("deterministic", [taskDefinition("task_gate")]);
  let state = submitAndClose(created.tasks["task:task_gate"], "gate");
  const closed = structuredClone(state.task.evidenceCycles[0].closedBundle);
  const contract = reviewContract(state.task, [], { reviewContractId: "review_gate", gateDecision: "reject", quorum: 1 });
  const rejected = runTask(state, command("OpenReview", state.streamId, state.version, { taskId: state.task.taskId, reviewContract: contract }));
  assert.deepEqual(rejected.events.map(({ type }) => type), ["DeterministicProofRejected"]);
  state = rejected.state;
  assert.equal(state.task.status, "rejected");
  assert.equal(state.task.rejectionStage, "deterministic");
  assert.deepEqual(state.task.evidenceCycles[0].closedBundle, closed);
  expectRejected(executeCommand(state, command("SubmitEvidenceDraft", state.streamId, state.version, { taskId: state.task.taskId, submissionId: "illegal", narrative: "rewrite", artifacts: [] })), "INVALID_TRANSITION");
  state = runTask(state, command("BeginCorrectionCycle", state.streamId, state.version, { taskId: state.task.taskId })).state;
  assert.equal(state.task.activeEvidenceCycle, 2);
  assert.equal(state.task.status, "active");
  assert.deepEqual(state.task.evidenceCycles[0].closedBundle, closed);
  assert.equal(state.task.evidenceCycles[1].closedBundle, null);
});

test("each evidence cycle has one human-resolved deterministic appeal and overturn only opens independent review", () => {
  const upheldCreated = createProject("appeal_upheld", [taskDefinition("task_appeal_upheld")]);
  let upheld = submitAndClose(upheldCreated.tasks["task:task_appeal_upheld"], "appeal_upheld");
  const upheldDigest = upheld.task.evidenceCycles[0].closedBundle.digest;
  const rejectedContract = reviewContract(upheld.task, [], { reviewContractId: "review_appeal_upheld", gateDecision: "reject", quorum: 1 });
  upheld = runTask(upheld, command("OpenReview", upheld.streamId, upheld.version, { taskId: upheld.task.taskId, reviewContract: rejectedContract })).state;
  upheld = runTask(upheld, command("FileDeterministicAppeal", upheld.streamId, upheld.version, { taskId: upheld.task.taskId, appealId: "appeal_upheld", grounds: "The deterministic artifact classifier may have missed the attached record." })).state;
  assert.equal(upheld.task.status, "deterministic_appeal_pending");
  const appealCredential = reviewerCredential(reviewerA, ["deterministic-appeal"], "high");
  const appealDisclosure = conflictDisclosure(reviewerA, upheldDigest);
  upheld = runTask(upheld, command("ResolveDeterministicAppeal", upheld.streamId, upheld.version, {
    taskId: upheld.task.taskId,
    appealId: "appeal_upheld",
    decision: "uphold",
    reasons: ["The attached record does not satisfy the deterministic format requirement."],
    reviewerCredential: appealCredential,
    conflictDisclosure: appealDisclosure,
    reviewContract: null,
  }, { actor: reviewerA })).state;
  assert.equal(upheld.task.status, "rejected");
  assert.equal(upheld.task.evidenceCycles[0].deterministicAppeal.status, "upheld");
  expectRejected(executeCommand(upheld, command("FileDeterministicAppeal", upheld.streamId, upheld.version, { taskId: upheld.task.taskId, appealId: "appeal_second", grounds: "A second appeal is forbidden." })), "APPEAL_ALREADY_USED");

  const overturnedCreated = createProject("appeal_overturned", [taskDefinition("task_appeal_overturned")]);
  let overturned = submitAndClose(overturnedCreated.tasks["task:task_appeal_overturned"], "appeal_overturned");
  const originalBundle = structuredClone(overturned.task.evidenceCycles[0].closedBundle);
  const initialGate = reviewContract(overturned.task, [], { reviewContractId: "review_gate_overturned", gateDecision: "reject", quorum: 1 });
  overturned = runTask(overturned, command("OpenReview", overturned.streamId, overturned.version, { taskId: overturned.task.taskId, reviewContract: initialGate })).state;
  overturned = runTask(overturned, command("FileDeterministicAppeal", overturned.streamId, overturned.version, { taskId: overturned.task.taskId, appealId: "appeal_overturned", grounds: "The artifact is valid but used a newer deterministic code." })).state;
  const independent = reviewContract(overturned.task, [reviewerB, reviewerC], { reviewContractId: "review_after_appeal", gateDecision: "reject", quorum: 2, openingBasis: "appeal-overturn", appealId: "appeal_overturned" });
  const resolved = runTask(overturned, command("ResolveDeterministicAppeal", overturned.streamId, overturned.version, {
    taskId: overturned.task.taskId,
    appealId: "appeal_overturned",
    decision: "overturn",
    reasons: ["The deterministic policy version did not recognize the valid newer encoding."],
    reviewerCredential: reviewerCredential(reviewerA, ["deterministic-appeal"], "high"),
    conflictDisclosure: conflictDisclosure(reviewerA, originalBundle.digest),
    reviewContract: independent,
  }, { actor: reviewerA }));
  assert.deepEqual(resolved.events.map(({ type }) => type), ["DeterministicAppealOverturned", "ReviewOpened"]);
  overturned = resolved.state;
  assert.equal(overturned.task.status, "review_pending");
  assert.equal(overturned.task.reviewContract.openingBasis, "appeal-overturn");
  assert.equal(overturned.task.reviewContract.evidenceDigest, originalBundle.digest);
  assert.deepEqual(overturned.task.evidenceCycles[0].closedBundle, originalBundle);
  assert.equal(overturned.task.settlement, null);
});

test("approval and rejection use one symmetrical quorum", () => {
  const created = createProject("quorum", [taskDefinition("task_reject")]);
  let state = submitAndClose(created.tasks["task:task_reject"], "reject");
  const opened = openReview(state, [reviewerA, reviewerB], { reviewContractId: "review_symmetric", quorum: 2 });
  assert.deepEqual(opened.events.map(({ type }) => type), ["DeterministicProofPassed", "ReviewOpened"]);
  assert.equal(opened.events[0].payload.evidenceDigest, state.task.evidenceCycles[0].closedBundle.digest);
  assert.deepEqual(opened.events[0].payload.resultCodes, ["ARTIFACT_PRESENT"]);
  state = opened.state;
  state = runTask(state, command("RecordReviewAttestation", state.streamId, state.version, { taskId: state.task.taskId, attestation: attestation(state.task, opened.contract, reviewerA, "reject", "att_reject_a") }, { actor: reviewerA })).state;
  assert.equal(state.task.status, "review_pending");
  state = runTask(state, command("RecordReviewAttestation", state.streamId, state.version, { taskId: state.task.taskId, attestation: attestation(state.task, opened.contract, reviewerB, "reject", "att_reject_b") }, { actor: reviewerB })).state;
  assert.equal(state.task.status, "rejected");
  assert.equal(state.task.rejectionStage, "independent");
  assert.equal(state.task.reviewContract.quorum, 2);
  assert.equal("requiredApprovals" in state.task.reviewContract, false);
  assert.equal("requiredRejections" in state.task.reviewContract, false);
});

test("human review requires a valid scoped credential and conflict-free disclosure", () => {
  const created = createProject("review_eligibility", [taskDefinition("task_review_eligibility")]);
  const state = submitAndClose(created.tasks["task:task_review_eligibility"], "review_eligibility");
  const conflicted = reviewContract(state.task, [reviewerA], { reviewContractId: "review_conflicted", quorum: 1 });
  conflicted.assignments[0].conflictDisclosure = conflictDisclosure(reviewerA, conflicted.evidenceDigest, true);
  expectRejected(executeCommand(state, command("OpenReview", state.streamId, state.version, { taskId: state.task.taskId, reviewContract: conflicted })), "REVIEWER_INELIGIBLE");
  const wrongScope = reviewContract(state.task, [reviewerA], { reviewContractId: "review_wrong_scope", quorum: 1 });
  wrongScope.assignments[0].humanReviewCredential = reviewerCredential(reviewerA, ["deterministic-appeal"], "high");
  expectRejected(executeCommand(state, command("OpenReview", state.streamId, state.version, { taskId: state.task.taskId, reviewContract: wrongScope })), "REVIEWER_INELIGIBLE");
});

test("inconclusive review supports bounded reassignment and human escalation; timeout never rejects", () => {
  const created = createProject("inconclusive", [taskDefinition("task_inconclusive")]);
  let state = submitAndClose(created.tasks["task:task_inconclusive"], "inconclusive");
  const opened = openReview(state, [reviewerA, reviewerB], { reviewContractId: "review_inconclusive", quorum: 2, maxReassignments: 1, expiresAt: "2026-07-23T21:00:00.000Z", modelReviewerIds: [reviewerB.rootIdentityId] });
  state = opened.state;
  state = runTask(state, command("RecordReviewAttestation", state.streamId, state.version, { taskId: state.task.taskId, attestation: attestation(state.task, opened.contract, reviewerA, "approve", "att_inconclusive_a") }, { actor: reviewerA })).state;
  state = runTask(state, command("ResolveReviewInconclusive", state.streamId, state.version, { taskId: state.task.taskId, resolvedAt: "2026-07-24T00:00:00.000Z" })).state;
  assert.equal(state.task.status, "review_pending");
  assert.equal(state.task.rejectionStage, null);
  assert.equal(state.task.reviewContract.status, "inconclusive");

  const newAssignment = { reviewerRootIdentityId: reviewerC.rootIdentityId, reviewerKind: "model", humanReviewCredential: null, conflictDisclosure: null, assignedAt: "2026-07-24T00:01:00.000Z", assignmentProof: "assignment-c", status: "assigned" };
  state = runTask(state, command("ReassignReviewers", state.streamId, state.version, { taskId: state.task.taskId, expiredReviewerRootIdentityIds: [reviewerB.rootIdentityId], newAssignments: [newAssignment] })).state;
  assert.equal(state.task.reviewContract.reassignmentsUsed, 1);
  state = runTask(state, command("ResolveReviewInconclusive", state.streamId, state.version, { taskId: state.task.taskId, resolvedAt: "2026-07-24T00:02:00.000Z" })).state;
  const overLimit = executeCommand(state, command("ReassignReviewers", state.streamId, state.version, { taskId: state.task.taskId, expiredReviewerRootIdentityIds: [reviewerC.rootIdentityId], newAssignments: [{ reviewerRootIdentityId: "root_reviewer_e", reviewerKind: "model", humanReviewCredential: null, conflictDisclosure: null, assignedAt: "2026-07-24T00:03:00.000Z", assignmentProof: "assignment-e", status: "assigned" }] }));
  expectRejected(overLimit, "REVIEW_REASSIGNMENT_LIMIT");

  state = runTask(state, command("EscalateReviewToHuman", state.streamId, state.version, { taskId: state.task.taskId, humanAssignments: [{ reviewerRootIdentityId: reviewerD.rootIdentityId, reviewerKind: "human", humanReviewCredential: reviewerCredential(reviewerD), conflictDisclosure: conflictDisclosure(reviewerD, state.task.reviewContract.evidenceDigest), assignedAt: "2026-07-24T00:04:00.000Z", assignmentProof: "human-assignment", status: "assigned" }], reason: "Bounded automation exhausted without quorum." })).state;
  assert.equal(state.task.reviewContract.status, "human_escalation");
  assert.equal(state.task.reviewContract.assignments.find(({ reviewerRootIdentityId }) => reviewerRootIdentityId === reviewerC.rootIdentityId).status, "revoked");
  state = runTask(state, command("RecordReviewAttestation", state.streamId, state.version, { taskId: state.task.taskId, attestation: attestation(state.task, opened.contract, reviewerD, "approve", "att_human", "2026-07-24T00:05:00.000Z") }, { actor: reviewerD })).state;
  assert.equal(state.task.status, "accepted_pending_settlement");
});

test("settlement cannot change accepted evidence, policy, quorum, or deterministic ID", () => {
  const created = createProject("settlement", [taskDefinition("task_settlement")]);
  let state = submitAndClose(created.tasks["task:task_settlement"], "settlement");
  state = approve(state, [reviewerA], "settlement");
  const contract = state.task.reviewContract;
  const idempotencyKey = "idem_bad_settlement";
  const intent = {
    settlementId: deriveSettlementId(state.task.taskId, "f".repeat(64), contract.policyVersion),
    taskId: state.task.taskId,
    acceptedEvidenceDigest: "f".repeat(64),
    policyVersion: contract.policyVersion,
    reviewContractId: contract.reviewContractId,
    quorumDigest: contract.quorumDigest,
    effects: { baseCurrency: [], xp: [], skillXp: [], specimens: [], other: [] },
    idempotencyKey,
  };
  const rejected = executeCommand(state, command("SettleAcceptedTask", state.streamId, state.version, { taskId: state.task.taskId, intent, transactionId: "tx_bad" }, { actor: serviceActor, idempotencyKey }));
  expectRejected(rejected, "SETTLEMENT_MISMATCH");
  assert.equal(rejected.events.length, 0);
  assert.equal(rejected.state.task.status, "accepted_pending_settlement");
});
