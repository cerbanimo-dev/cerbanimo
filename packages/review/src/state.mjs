import { cloneJson, deepFreeze, requireTimestamp, sha256 } from "../../proof/src/index.mjs";
import { credentialDigest, REVIEW_ATTESTATION_SCHEMA_VERSION, verifyReviewAttestationSignature } from "./attestation.mjs";
import { reproduceAssignmentOrder, REVIEW_CONTRACT_SCHEMA_VERSION, ReviewContractError } from "./selection.mjs";

export const REVIEW_STATE_SCHEMA_VERSION = "cerbanimo.review-state/1.1.0";

function tally(state) {
  return {
    approvals: state.attestations.filter(({ decision }) => decision === "approve").length,
    rejections: state.attestations.filter(({ decision }) => decision === "reject").length,
    abstentions: state.attestations.filter(({ decision }) => decision === "abstain").length,
    outstanding: state.assignments.filter(({ status }) => status === "assigned").length,
  };
}

function withResolution(state) {
  const counts = tally(state);
  let status = state.status;
  let resolution = state.resolution;
  if (counts.approvals >= state.contract.quorum) {
    status = "approved";
    resolution = "approved";
  } else if (counts.rejections >= state.contract.quorum) {
    status = "rejected";
    resolution = "rejected";
  } else {
    const approvalPossible = counts.approvals + counts.outstanding >= state.contract.quorum;
    const rejectionPossible = counts.rejections + counts.outstanding >= state.contract.quorum;
    if (!approvalPossible && !rejectionPossible) {
      status = "inconclusive";
      resolution = "inconclusive";
    }
  }
  return { ...state, status, resolution, counts };
}

export function openReviewState(contract) {
  if (!contract || contract.schemaVersion !== REVIEW_CONTRACT_SCHEMA_VERSION) throw new ReviewContractError("INVALID_REVIEW_CONTRACT", "A versioned review contract is required");
  return deepFreeze(withResolution({
    schemaVersion: REVIEW_STATE_SCHEMA_VERSION,
    contract: cloneJson(contract),
    assignments: cloneJson(contract.assignments),
    attestations: [],
    status: "collecting",
    resolution: null,
    reassignmentsUsed: 0,
  }));
}

function currentCredential(options, credentialId, fallback) {
  const registry = options?.credentialRegistry;
  if (typeof registry === "function") return registry(credentialId) ?? fallback;
  if (registry instanceof Map) return registry.get(credentialId) ?? fallback;
  if (registry && typeof registry === "object") return registry[credentialId] ?? fallback;
  return fallback;
}

function currentConflictDisclosure(options, disclosureId, fallback) {
  const registry = options?.conflictRegistry;
  if (typeof registry === "function") return registry(disclosureId) ?? fallback;
  if (registry instanceof Map) return registry.get(disclosureId) ?? fallback;
  if (registry && typeof registry === "object") return registry[disclosureId] ?? fallback;
  return fallback;
}

function validatePacket(packet, state, assignment) {
  if (!packet || packet.reviewContractId !== state.contract.reviewContractId || packet.assignmentId !== assignment.assignmentId || packet.evidenceDigest !== state.contract.evidenceDigest || packet.reviewerIdentityId !== assignment.reviewerIdentityId) {
    throw new ReviewContractError("REVIEW_PACKET_BINDING_MISMATCH", "Attestation requires the exact authorized review packet");
  }
}

function validateCitations(attestation, packet) {
  const authorized = new Set(packet.untrustedEvidence.artifactManifests.map(({ artifactId }) => artifactId));
  for (const citation of attestation.citations) {
    if (citation.artifactId !== null && !authorized.has(citation.artifactId)) throw new ReviewContractError("UNAUTHORIZED_CITATION", "Attestation cites an artifact outside the disclosed review packet", { artifactId: citation.artifactId });
  }
}

export function recordReviewAttestation(state, attestation, options = {}) {
  if (!state || state.schemaVersion !== REVIEW_STATE_SCHEMA_VERSION || !["collecting", "human_escalation"].includes(state.status)) throw new ReviewContractError("REVIEW_NOT_COLLECTING", "Only an unresolved review can accept an attestation");
  if (!attestation || attestation.schemaVersion !== REVIEW_ATTESTATION_SCHEMA_VERSION) throw new ReviewContractError("INVALID_ATTESTATION", "A versioned attestation is required");
  const assignment = state.assignments.find(({ assignmentId }) => assignmentId === attestation.assignmentId);
  if (state.attestations.some(({ assignmentId }) => assignmentId === attestation.assignmentId)) throw new ReviewContractError("DUPLICATE_ATTESTATION", "An assignment may vote only once");
  if (!assignment || assignment.status !== "assigned") throw new ReviewContractError("UNASSIGNED_REVIEWER", "Attestation does not belong to an outstanding assignment");
  const contract = state.contract;
  if (attestation.reviewContractId !== contract.reviewContractId || attestation.taskId !== contract.taskId || attestation.submissionId !== contract.submissionId || attestation.evidenceDigest !== contract.evidenceDigest || attestation.policyVersion !== contract.policyVersion || attestation.reviewerIdentityId !== assignment.reviewerIdentityId || attestation.credentialId !== assignment.credential.credentialId || attestation.credentialDigest !== credentialDigest(assignment.credential)) {
    throw new ReviewContractError("ATTESTATION_BINDING_MISMATCH", "Attestation does not bind its contract, assignment, evidence, policy, reviewer, and credential");
  }
  const issued = Date.parse(attestation.issuedAt);
  if (issued < Date.parse(assignment.assignedAt) || issued >= Date.parse(assignment.expiresAt) || (state.status !== "human_escalation" && issued >= Date.parse(contract.expiresAt))) throw new ReviewContractError("ATTESTATION_EXPIRED", "Attestation is outside its assignment or contract validity window");
  const credential = currentCredential(options, assignment.credential.credentialId, assignment.credential);
  if (!credential || credential.status !== "active" || issued < Date.parse(credential.issuedAt) || issued >= Date.parse(credential.expiresAt)) throw new ReviewContractError("REVIEWER_CREDENTIAL_INVALID", "Reviewer credential is revoked, absent, or expired");
  const disclosure = currentConflictDisclosure(options, assignment.conflictDisclosure?.disclosureId, assignment.conflictDisclosure);
  if (!disclosure || disclosure.hasConflict || disclosure.reviewerIdentityId !== assignment.reviewerIdentityId || disclosure.evidenceDigest !== contract.evidenceDigest) throw new ReviewContractError("REVIEWER_CONFLICT", "Assignment lacks a current valid no-conflict disclosure");
  if (assignment.reviewerKind === "human" && (!credential.scopes.includes("independent-review") || !["substantial", "high"].includes(credential.assuranceLevel))) throw new ReviewContractError("HUMAN_REVIEW_CREDENTIAL_REQUIRED", "Human reviewer lacks the required credential");
  validatePacket(options.reviewPacket, state, assignment);
  validateCitations(attestation, options.reviewPacket);
  if (!verifyReviewAttestationSignature(attestation, credential.publicKey)) throw new ReviewContractError("INVALID_ATTESTATION_SIGNATURE", "Ed25519 attestation signature is invalid");

  const mutable = cloneJson(state);
  mutable.attestations.push(cloneJson(attestation));
  mutable.assignments.find(({ assignmentId }) => assignmentId === attestation.assignmentId).status = "returned";
  const next = withResolution(mutable);
  const events = [{ type: "ReviewAttestationRecorded", payload: { taskId: contract.taskId, reviewContractId: contract.reviewContractId, attestation: cloneJson(attestation) } }];
  if (next.resolution === "approved") events.push({ type: "ReviewAccepted", payload: { taskId: contract.taskId, reviewContractId: contract.reviewContractId, evidenceDigest: contract.evidenceDigest, policyVersion: contract.policyVersion, quorumDigest: sha256(next.attestations.filter(({ decision }) => decision === "approve")) } });
  if (next.resolution === "rejected") events.push({ type: "ReviewRejected", payload: { taskId: contract.taskId, reviewContractId: contract.reviewContractId, evidenceDigest: contract.evidenceDigest, policyVersion: contract.policyVersion, rejectionStage: "independent", quorumDigest: sha256(next.attestations.filter(({ decision }) => decision === "reject")) } });
  if (next.resolution === "inconclusive") events.push({ type: "ReviewInconclusive", payload: { taskId: contract.taskId, reviewContractId: contract.reviewContractId, reason: next.counts.approvals > 0 && next.counts.rejections > 0 ? "split-decision" : "exhausted-without-quorum", ...next.counts, resolvedAt: attestation.issuedAt } });
  return { state: deepFreeze(next), events: deepFreeze(events) };
}

function unusedAssignmentOrder(state) {
  const used = new Set(state.assignments.map(({ reviewerIdentityId }) => reviewerIdentityId));
  return state.contract.assignmentOrder.filter((identityId) => !used.has(identityId));
}

export function reassignInconclusiveReview(state, { count, assignedAt, expiresAt }) {
  if (state.status !== "inconclusive") throw new ReviewContractError("REVIEW_NOT_INCONCLUSIVE", "Reassignment requires a deterministic inconclusive result");
  if (state.reassignmentsUsed >= state.contract.maxReassignments) throw new ReviewContractError("REVIEW_REASSIGNMENT_LIMIT", "Bounded reviewer reassignment is exhausted");
  if (!Number.isSafeInteger(count) || count < 1) throw new ReviewContractError("INVALID_REASSIGNMENT", "Reassignment count must be positive");
  const available = unusedAssignmentOrder(state);
  if (available.length < count) throw new ReviewContractError("NO_ELIGIBLE_REVIEWERS", "Snapshotted reviewer pool cannot satisfy reassignment");
  const start = requireTimestamp(assignedAt, "assignedAt");
  const expiry = requireTimestamp(expiresAt, "expiresAt");
  if (Date.parse(expiry) <= Date.parse(start) || Date.parse(expiry) > Date.parse(state.contract.expiresAt)) throw new ReviewContractError("INVALID_REVIEW_EXPIRY", "Reassignment expiry must stay within the contract");
  const byId = new Map(state.contract.poolSnapshot.eligible.map((candidate) => [candidate.reviewerIdentityId, candidate]));
  const round = state.reassignmentsUsed + 1;
  const assignments = available.slice(0, count).map((identityId, index) => {
    const candidate = byId.get(identityId);
    return {
      assignmentId: `assignment_${sha256({ contractId: state.contract.reviewContractId, round, identityId }).slice(0, 32)}`,
      ordinal: state.assignments.length + index,
      round,
      reviewerIdentityId: identityId,
      controllingIdentityId: candidate.controllingIdentityId,
      reviewerKind: candidate.reviewerKind,
      credential: cloneJson(candidate.credential),
      conflictDisclosure: cloneJson(candidate.conflictDisclosure),
      assignedAt: start,
      expiresAt: expiry,
      status: "assigned",
    };
  });
  const mutable = cloneJson(state);
  mutable.assignments.push(...assignments);
  mutable.status = "collecting";
  mutable.resolution = null;
  mutable.reassignmentsUsed = round;
  const next = withResolution(mutable);
  return {
    state: deepFreeze(next),
    events: deepFreeze([{ type: "ReviewersReassigned", payload: { taskId: state.contract.taskId, reviewContractId: state.contract.reviewContractId, assignments: cloneJson(assignments), reassignmentsUsed: round } }]),
  };
}

export function resolveReviewAtExpiry(state, resolvedAt) {
  if (!state || !["collecting", "human_escalation"].includes(state.status)) throw new ReviewContractError("REVIEW_NOT_COLLECTING", "Only a collecting review can expire inconclusively");
  const at = requireTimestamp(resolvedAt, "resolvedAt");
  if (Date.parse(at) < Date.parse(state.contract.expiresAt)) throw new ReviewContractError("REVIEW_NOT_EXPIRED", "Timeout cannot be declared before contract expiry");
  const counts = tally(state);
  if (counts.approvals >= state.contract.quorum || counts.rejections >= state.contract.quorum) throw new ReviewContractError("REVIEW_QUORUM_ALREADY_REACHED", "A reached quorum cannot time out inconclusively");
  const mutable = cloneJson(state);
  mutable.status = "inconclusive";
  mutable.resolution = "inconclusive";
  mutable.counts = counts;
  return {
    state: deepFreeze(mutable),
    events: deepFreeze([{ type: "ReviewInconclusive", payload: { taskId: state.contract.taskId, reviewContractId: state.contract.reviewContractId, reason: "timeout", ...counts, resolvedAt: at } }]),
  };
}

export function escalateReviewToHumans(state, { humanPoolSnapshot, seedCommitment, revealedSeed, count, assignedAt, expiresAt, reason }) {
  if (state.status !== "inconclusive") throw new ReviewContractError("REVIEW_NOT_INCONCLUSIVE", "Human escalation requires an inconclusive review");
  if (humanPoolSnapshot.evidenceDigest !== state.contract.evidenceDigest || humanPoolSnapshot.policyVersion !== state.contract.policyVersion) throw new ReviewContractError("REVIEW_BINDING_MISMATCH", "Human pool does not bind this evidence and policy");
  const order = reproduceAssignmentOrder(humanPoolSnapshot, revealedSeed, seedCommitment);
  const humanOrder = order.filter((identityId) => humanPoolSnapshot.eligible.find((candidate) => candidate.reviewerIdentityId === identityId)?.reviewerKind === "human");
  if (!Number.isSafeInteger(count) || count < 1 || humanOrder.length < count) throw new ReviewContractError("NO_ELIGIBLE_HUMANS", "Human escalation pool is insufficient");
  const byId = new Map(humanPoolSnapshot.eligible.map((candidate) => [candidate.reviewerIdentityId, candidate]));
  const assignments = humanOrder.slice(0, count).map((identityId, index) => {
    const candidate = byId.get(identityId);
    return {
      assignmentId: `assignment_${sha256({ contractId: state.contract.reviewContractId, humanEscalation: true, identityId }).slice(0, 32)}`,
      ordinal: state.assignments.length + index,
      round: state.reassignmentsUsed + 1,
      reviewerIdentityId: identityId,
      controllingIdentityId: candidate.controllingIdentityId,
      reviewerKind: "human",
      credential: cloneJson(candidate.credential),
      conflictDisclosure: cloneJson(candidate.conflictDisclosure),
      assignedAt: requireTimestamp(assignedAt, "assignedAt"),
      expiresAt: requireTimestamp(expiresAt, "expiresAt"),
      status: "assigned",
    };
  });
  const mutable = cloneJson(state);
  const invalidatedModelAssignmentIds = [];
  for (const assignment of mutable.assignments) {
    if (assignment.reviewerKind === "model" && assignment.status === "assigned") {
      assignment.status = "revoked";
      invalidatedModelAssignmentIds.push(assignment.assignmentId);
    }
  }
  mutable.assignments.push(...assignments);
  mutable.status = "human_escalation";
  mutable.resolution = null;
  mutable.counts = tally(mutable);
  return {
    state: deepFreeze(mutable),
    events: deepFreeze([{ type: "ReviewEscalatedToHuman", payload: { taskId: state.contract.taskId, reviewContractId: state.contract.reviewContractId, invalidatedModelAssignmentIds, humanAssignments: cloneJson(assignments), reason } }]),
  };
}

function evolveRecordedEvent(state, event) {
  const mutable = cloneJson(state);
  if (event.type === "ReviewAttestationRecorded") {
    mutable.attestations.push(cloneJson(event.payload.attestation));
    const assignment = mutable.assignments.find(({ assignmentId }) => assignmentId === event.payload.attestation.assignmentId);
    if (assignment) assignment.status = "returned";
  }
  if (event.type === "ReviewersReassigned") {
    mutable.assignments.push(...cloneJson(event.payload.assignments));
    mutable.reassignmentsUsed = event.payload.reassignmentsUsed;
    mutable.status = "collecting";
    mutable.resolution = null;
  }
  if (event.type === "ReviewEscalatedToHuman") {
    for (const id of event.payload.invalidatedModelAssignmentIds) {
      const assignment = mutable.assignments.find(({ assignmentId }) => assignmentId === id);
      if (assignment) assignment.status = "revoked";
    }
    mutable.assignments.push(...cloneJson(event.payload.humanAssignments));
    mutable.status = "human_escalation";
    mutable.resolution = null;
  }
  if (event.type === "ReviewAccepted") { mutable.status = "approved"; mutable.resolution = "approved"; }
  if (event.type === "ReviewRejected") { mutable.status = "rejected"; mutable.resolution = "rejected"; }
  if (event.type === "ReviewInconclusive") { mutable.status = "inconclusive"; mutable.resolution = "inconclusive"; }
  mutable.counts = tally(mutable);
  return deepFreeze(mutable);
}

export function replayReviewState(events) {
  let state = null;
  for (const event of events) {
    if (event.type === "ReviewOpened") state = openReviewState(event.payload.contract);
    else if (state && ["ReviewAttestationRecorded", "ReviewersReassigned", "ReviewEscalatedToHuman", "ReviewAccepted", "ReviewRejected", "ReviewInconclusive"].includes(event.type)) state = evolveRecordedEvent(state, event);
  }
  return state;
}

export function appealOverturnReviewEvents({ appealId, resolvedByHumanIdentityId, resolvedAt, resolverCredential, conflictDisclosure, reviewContract }) {
  if (reviewContract.openingBasis !== "appeal-overturn" || reviewContract.appealId !== appealId) throw new ReviewContractError("APPEAL_REVIEW_BINDING_MISMATCH", "Appeal overturn must open ordinary review bound to the appealed digest");
  const at = requireTimestamp(resolvedAt, "resolvedAt");
  if (!resolverCredential || resolverCredential.reviewerKind !== "human" || resolverCredential.reviewerIdentityId !== resolvedByHumanIdentityId || resolverCredential.status !== "active" || resolverCredential.assuranceLevel !== "high" || !resolverCredential.scopes.includes("deterministic-appeal") || Date.parse(at) < Date.parse(resolverCredential.issuedAt) || Date.parse(at) >= Date.parse(resolverCredential.expiresAt)) {
    throw new ReviewContractError("HUMAN_APPEAL_CREDENTIAL_REQUIRED", "Only an eligible high-assurance human may resolve a deterministic appeal");
  }
  if (!conflictDisclosure || conflictDisclosure.reviewerIdentityId !== resolvedByHumanIdentityId || conflictDisclosure.evidenceDigest !== reviewContract.evidenceDigest || conflictDisclosure.hasConflict) throw new ReviewContractError("REVIEWER_CONFLICT", "Appeal resolver requires a digest-bound no-conflict disclosure");
  return deepFreeze([
    { type: "DeterministicAppealOverturned", payload: { appealId, evidenceDigest: reviewContract.evidenceDigest, resolvedByHumanIdentityId, reviewerCredentialId: resolverCredential.credentialId, conflictDisclosureId: conflictDisclosure.disclosureId, resolvedAt: at } },
    { type: "ReviewOpened", payload: { taskId: reviewContract.taskId, contract: cloneJson(reviewContract) } },
  ]);
}
