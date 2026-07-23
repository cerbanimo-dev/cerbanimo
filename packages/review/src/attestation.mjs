import { createPublicKey, sign, verify } from "node:crypto";
import { canonicalize, cloneJson, deepFreeze, requireDigest, requireText, requireTimestamp, sha256 } from "../../proof/src/index.mjs";
import { ReviewContractError } from "./selection.mjs";

export const REVIEW_ATTESTATION_SCHEMA_VERSION = "cerbanimo.review-attestation/1.1.0";

function normalizedReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) throw new ReviewContractError("INVALID_ATTESTATION", "At least one structured reason is required");
  return reasons.map((reason, index) => ({
    code: requireText(reason?.code, `reasons[${index}].code`),
    explanation: requireText(reason?.explanation, `reasons[${index}].explanation`),
  }));
}

function normalizedCitations(citations) {
  if (!Array.isArray(citations)) throw new ReviewContractError("INVALID_ATTESTATION", "Citations must be an array");
  return citations.map((citation, index) => ({
    artifactId: citation?.artifactId === null ? null : requireText(citation?.artifactId, `citations[${index}].artifactId`),
    manifestPath: requireText(citation?.manifestPath, `citations[${index}].manifestPath`),
    excerptDigest: citation?.excerptDigest === null ? null : requireDigest(citation?.excerptDigest, `citations[${index}].excerptDigest`),
  }));
}

export function attestationSigningMaterial(input) {
  if (!input || typeof input !== "object") throw new ReviewContractError("INVALID_ATTESTATION", "Attestation is required");
  if (!["approve", "reject", "abstain"].includes(input.decision)) throw new ReviewContractError("INVALID_ATTESTATION", "Decision must be approve, reject, or abstain");
  if (typeof input.confidence !== "number" || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new ReviewContractError("INVALID_ATTESTATION", "Confidence must be between zero and one");
  return {
    schemaVersion: REVIEW_ATTESTATION_SCHEMA_VERSION,
    reviewContractId: requireText(input.reviewContractId, "reviewContractId"),
    assignmentId: requireText(input.assignmentId, "assignmentId"),
    taskId: requireText(input.taskId, "taskId"),
    submissionId: requireText(input.submissionId, "submissionId"),
    evidenceDigest: requireDigest(input.evidenceDigest, "evidenceDigest"),
    policyVersion: requireText(input.policyVersion, "policyVersion"),
    reviewerIdentityId: requireText(input.reviewerIdentityId, "reviewerIdentityId"),
    credentialId: requireText(input.credentialId, "credentialId"),
    credentialDigest: requireDigest(input.credentialDigest, "credentialDigest"),
    decision: input.decision,
    confidence: input.confidence,
    reasons: normalizedReasons(input.reasons),
    citations: normalizedCitations(input.citations),
    issuedAt: requireTimestamp(input.issuedAt, "issuedAt"),
  };
}

export function signReviewAttestation(input, privateKey) {
  const unsigned = attestationSigningMaterial(input);
  const material = Buffer.from(canonicalize(unsigned), "utf8");
  const signatureValue = sign(null, material, privateKey).toString("base64url");
  const attestationId = `attestation_${sha256({ unsigned, signatureValue }).slice(0, 32)}`;
  return deepFreeze({ ...unsigned, attestationId, signature: { algorithm: "Ed25519", value: signatureValue } });
}

export function verifyReviewAttestationSignature(attestation, publicKey) {
  try {
    if (attestation?.signature?.algorithm !== "Ed25519" || typeof attestation.signature.value !== "string") return false;
    const unsigned = attestationSigningMaterial(attestation);
    const expectedId = `attestation_${sha256({ unsigned, signatureValue: attestation.signature.value }).slice(0, 32)}`;
    if (attestation.attestationId !== expectedId) return false;
    return verify(null, Buffer.from(canonicalize(unsigned), "utf8"), createPublicKey(publicKey), Buffer.from(attestation.signature.value, "base64url"));
  } catch {
    return false;
  }
}

export function credentialDigest(credential) {
  return sha256(cloneJson(credential));
}
