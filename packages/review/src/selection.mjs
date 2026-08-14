import { createHash, createHmac, randomBytes } from "node:crypto";
import { canonicalize, cloneJson, deepFreeze, requireDigest, requireText, requireTimestamp, sha256 } from "../../proof/src/index.mjs";

export class ReviewContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ReviewContractError";
    this.code = code;
    this.details = details;
  }
}

export const REVIEW_CONTRACT_SCHEMA_VERSION = "cerbanimo.review/1.1.0";
export const REVIEW_POOL_SCHEMA_VERSION = "cerbanimo.reviewer-pool/1.1.0";

function validAt(credential, at) {
  const instant = Date.parse(at);
  return credential.status === "active" && instant >= Date.parse(credential.issuedAt) && instant < Date.parse(credential.expiresAt);
}

function normalizeCredential(credential, identityId) {
  if (!credential || typeof credential !== "object") throw new ReviewContractError("REVIEWER_UNAUTHORIZED", "Reviewer credential is required", { identityId });
  const normalized = {
    credentialId: requireText(credential.credentialId, "credential.credentialId"),
    reviewerIdentityId: requireText(credential.reviewerIdentityId, "credential.reviewerIdentityId"),
    controllingIdentityId: credential.controllingIdentityId === null ? null : requireText(credential.controllingIdentityId, "credential.controllingIdentityId"),
    reviewerKind: credential.reviewerKind,
    issuer: requireText(credential.issuer, "credential.issuer"),
    scopes: [...new Set(credential.scopes ?? [])].sort(),
    assuranceLevel: credential.assuranceLevel,
    publicKey: requireText(credential.publicKey, "credential.publicKey"),
    algorithm: credential.algorithm,
    issuedAt: requireTimestamp(credential.issuedAt, "credential.issuedAt"),
    expiresAt: requireTimestamp(credential.expiresAt, "credential.expiresAt"),
    status: credential.status,
    proof: requireText(credential.proof, "credential.proof"),
  };
  if (normalized.reviewerIdentityId !== identityId || !["human", "model"].includes(normalized.reviewerKind) || normalized.algorithm !== "Ed25519") throw new ReviewContractError("REVIEWER_UNAUTHORIZED", "Credential identity, kind, or algorithm is invalid", { identityId });
  if (!new Set(["substantial", "high", "service"]).has(normalized.assuranceLevel)) throw new ReviewContractError("REVIEWER_UNAUTHORIZED", "Credential assurance is invalid", { identityId });
  return normalized;
}

function normalizeDisclosure(disclosure, identityId, evidenceDigest) {
  if (!disclosure || typeof disclosure !== "object") return null;
  const normalized = {
    disclosureId: requireText(disclosure.disclosureId, "conflictDisclosure.disclosureId"),
    reviewerIdentityId: requireText(disclosure.reviewerIdentityId, "conflictDisclosure.reviewerIdentityId"),
    evidenceDigest: requireDigest(disclosure.evidenceDigest, "conflictDisclosure.evidenceDigest"),
    hasConflict: disclosure.hasConflict === true,
    conflictTypes: [...new Set(disclosure.conflictTypes ?? [])].sort(),
    statement: requireText(disclosure.statement, "conflictDisclosure.statement"),
    disclosedAt: requireTimestamp(disclosure.disclosedAt, "conflictDisclosure.disclosedAt"),
    signature: requireText(disclosure.signature, "conflictDisclosure.signature"),
  };
  return normalized.reviewerIdentityId === identityId && normalized.evidenceDigest === evidenceDigest ? normalized : null;
}

function candidateForSnapshot(candidate, evidenceDigest) {
  const reviewerIdentityId = requireText(candidate?.reviewerIdentityId, "reviewerIdentityId");
  const credential = normalizeCredential(candidate.credential, reviewerIdentityId);
  return {
    reviewerIdentityId,
    controllingIdentityId: candidate.controllingIdentityId === null ? null : requireText(candidate.controllingIdentityId, "controllingIdentityId"),
    reviewerKind: credential.reviewerKind,
    authorized: candidate.authorized === true,
    credential,
    conflictDisclosure: normalizeDisclosure(candidate.conflictDisclosure, reviewerIdentityId, evidenceDigest),
  };
}

export function snapshotEligibleReviewerPool({ candidates, taskId, submissionId, evidenceDigest, policyVersion, authorIdentityId, taskOwnerIdentityId = null, excludeTaskOwner = false, snapshotAt }) {
  if (!Array.isArray(candidates)) throw new ReviewContractError("INVALID_REVIEWER_POOL", "Reviewer candidates must be an array");
  const at = requireTimestamp(snapshotAt, "snapshotAt");
  const eligible = [];
  const exclusions = [];
  const controllingIdentities = new Set();
  const identities = new Set();
  const ordered = candidates.map((candidate) => candidateForSnapshot(candidate, evidenceDigest)).sort((left, right) => left.reviewerIdentityId.localeCompare(right.reviewerIdentityId));
  for (const candidate of ordered) {
    let reason = null;
    if (identities.has(candidate.reviewerIdentityId)) reason = "DUPLICATE_REVIEWER_IDENTITY";
    else if (!candidate.authorized || !candidate.credential.scopes.includes("independent-review")) reason = "REVIEWER_UNAUTHORIZED";
    else if (candidate.reviewerIdentityId === authorIdentityId) reason = "AUTHOR_EXCLUDED";
    else if (excludeTaskOwner && candidate.reviewerIdentityId === taskOwnerIdentityId) reason = "TASK_OWNER_EXCLUDED";
    else if (!validAt(candidate.credential, at)) reason = candidate.credential.status === "revoked" ? "REVIEWER_CREDENTIAL_REVOKED" : "REVIEWER_CREDENTIAL_INVALID";
    else if (!candidate.conflictDisclosure || candidate.conflictDisclosure.hasConflict) reason = "REVIEWER_CONFLICT";
    else if (candidate.credential.controllingIdentityId !== candidate.controllingIdentityId) reason = "CONTROLLING_IDENTITY_MISMATCH";
    else if (candidate.controllingIdentityId !== null && controllingIdentities.has(candidate.controllingIdentityId)) reason = "DUPLICATE_CONTROLLING_IDENTITY";
    if (reason) exclusions.push({ reviewerIdentityId: candidate.reviewerIdentityId, reason });
    else {
      eligible.push(candidate);
      identities.add(candidate.reviewerIdentityId);
      if (candidate.controllingIdentityId !== null) controllingIdentities.add(candidate.controllingIdentityId);
    }
  }
  const unsigned = {
    schemaVersion: REVIEW_POOL_SCHEMA_VERSION,
    taskId: requireText(taskId, "taskId"),
    submissionId: requireText(submissionId, "submissionId"),
    evidenceDigest: requireDigest(evidenceDigest, "evidenceDigest"),
    policyVersion: requireText(policyVersion, "policyVersion"),
    authorIdentityId: requireText(authorIdentityId, "authorIdentityId"),
    taskOwnerIdentityId: taskOwnerIdentityId === null ? null : requireText(taskOwnerIdentityId, "taskOwnerIdentityId"),
    excludeTaskOwner: Boolean(excludeTaskOwner),
    snapshotAt: at,
    eligible,
    exclusions,
    selectionCaveat: "Randomized committed-seed assignment reduces submitter selection influence; it does not prevent Sybil identities, reviewer collusion, or prove reviewer independence.",
  };
  return deepFreeze({ ...unsigned, poolDigest: sha256(unsigned) });
}

export function commitAssignmentSeed() {
  const seed = randomBytes(32);
  return Object.freeze({ seed: seed.toString("base64url"), commitment: createHash("sha256").update(seed).digest("hex") });
}

function seedBytes(seed) {
  if (typeof seed !== "string") throw new ReviewContractError("INVALID_ASSIGNMENT_SEED", "Assignment seed is required");
  const bytes = Buffer.from(seed, "base64url");
  if (bytes.byteLength !== 32) throw new ReviewContractError("INVALID_ASSIGNMENT_SEED", "Assignment seed must contain 32 bytes");
  return bytes;
}

export function reproduceAssignmentOrder(poolSnapshot, revealedSeed, expectedCommitment = null) {
  if (!poolSnapshot || poolSnapshot.schemaVersion !== REVIEW_POOL_SCHEMA_VERSION) throw new ReviewContractError("INVALID_REVIEWER_POOL", "A versioned reviewer snapshot is required");
  const seed = seedBytes(revealedSeed);
  const commitment = createHash("sha256").update(seed).digest("hex");
  if (expectedCommitment !== null && commitment !== expectedCommitment) throw new ReviewContractError("ASSIGNMENT_SEED_MISMATCH", "Revealed assignment seed does not match its commitment");
  return poolSnapshot.eligible.map((candidate) => ({
    reviewerIdentityId: candidate.reviewerIdentityId,
    score: createHmac("sha256", seed).update(`${poolSnapshot.poolDigest}\u0000${candidate.reviewerIdentityId}`, "utf8").digest("hex"),
  })).sort((left, right) => left.score.localeCompare(right.score) || left.reviewerIdentityId.localeCompare(right.reviewerIdentityId)).map(({ reviewerIdentityId }) => reviewerIdentityId);
}

function assignmentFor(contractId, ordinal, candidate, assignedAt, expiresAt, round = 0) {
  return {
    assignmentId: `assignment_${sha256({ contractId, round, ordinal, reviewerIdentityId: candidate.reviewerIdentityId }).slice(0, 32)}`,
    ordinal,
    round,
    reviewerIdentityId: candidate.reviewerIdentityId,
    controllingIdentityId: candidate.controllingIdentityId,
    reviewerKind: candidate.reviewerKind,
    credential: cloneJson(candidate.credential),
    conflictDisclosure: cloneJson(candidate.conflictDisclosure),
    assignedAt,
    expiresAt,
    status: "assigned",
  };
}

export function createReviewContract({ reviewContractId, poolSnapshot, seedCommitment, revealedSeed, assignmentCount, quorum, maxReassignments, assignedAt, expiresAt, openingBasis = "deterministic-pass", appealId = null }) {
  if (!Number.isSafeInteger(assignmentCount) || assignmentCount < 1 || assignmentCount > poolSnapshot?.eligible?.length) throw new ReviewContractError("INSUFFICIENT_REVIEWER_POOL", "Assignment count exceeds the eligible pool");
  if (!Number.isSafeInteger(quorum) || quorum < 1 || quorum > assignmentCount) throw new ReviewContractError("INVALID_REVIEW_QUORUM", "Quorum must be reachable and positive");
  if (!Number.isSafeInteger(maxReassignments) || maxReassignments < 0 || maxReassignments > 20) throw new ReviewContractError("INVALID_REASSIGNMENT_LIMIT", "Reassignment limit must be bounded");
  const order = reproduceAssignmentOrder(poolSnapshot, revealedSeed, seedCommitment);
  const candidateById = new Map(poolSnapshot.eligible.map((candidate) => [candidate.reviewerIdentityId, candidate]));
  const start = requireTimestamp(assignedAt, "assignedAt");
  const expiry = requireTimestamp(expiresAt, "expiresAt");
  if (Date.parse(expiry) <= Date.parse(start)) throw new ReviewContractError("INVALID_REVIEW_EXPIRY", "Review must expire after assignment");
  const contractId = requireText(reviewContractId, "reviewContractId");
  const contract = {
    schemaVersion: REVIEW_CONTRACT_SCHEMA_VERSION,
    reviewContractId: contractId,
    taskId: poolSnapshot.taskId,
    submissionId: poolSnapshot.submissionId,
    evidenceDigest: poolSnapshot.evidenceDigest,
    policyVersion: poolSnapshot.policyVersion,
    openingBasis,
    appealId: appealId === null ? null : requireText(appealId, "appealId"),
    poolSnapshot: cloneJson(poolSnapshot),
    poolDigest: poolSnapshot.poolDigest,
    assignmentSeedCommitment: requireDigest(seedCommitment, "seedCommitment"),
    revealedAssignmentSeed: revealedSeed,
    assignmentOrder: order,
    assignments: order.slice(0, assignmentCount).map((identityId, index) => assignmentFor(contractId, index, candidateById.get(identityId), start, expiry)),
    quorum,
    maxReassignments,
    reassignmentsUsed: 0,
    assignedAt: start,
    expiresAt: expiry,
  };
  if (!["deterministic-pass", "appeal-overturn"].includes(openingBasis)) throw new ReviewContractError("INVALID_OPENING_BASIS", "Review opening basis is invalid");
  if ((openingBasis === "appeal-overturn") !== (appealId !== null)) throw new ReviewContractError("INVALID_OPENING_BASIS", "Appeal overturn review must bind exactly one appeal ID");
  return deepFreeze(contract);
}

export function assignmentCandidate(poolSnapshot, identityId) {
  return poolSnapshot.eligible.find((candidate) => candidate.reviewerIdentityId === identityId) ?? null;
}

export function makeReassignment(contract, identityIds, round, assignedAt, expiresAt) {
  const byId = new Map(contract.poolSnapshot.eligible.map((candidate) => [candidate.reviewerIdentityId, candidate]));
  return identityIds.map((identityId, index) => {
    const candidate = byId.get(identityId);
    if (!candidate) throw new ReviewContractError("REVIEWER_UNAUTHORIZED", "Reassignment selected an identity outside the snapshotted pool", { identityId });
    return assignmentFor(contract.reviewContractId, contract.assignments.length + index, candidate, assignedAt, expiresAt, round);
  });
}

export function canonicalPoolBytes(snapshot) {
  return Buffer.from(canonicalize(snapshot), "utf8");
}
