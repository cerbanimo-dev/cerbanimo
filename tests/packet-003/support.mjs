import { generateKeyPairSync } from "node:crypto";
import { credentialDigest, signReviewAttestation } from "../../packages/review/src/index.mjs";

export const serviceActor = Object.freeze({ kind: "service", serviceId: "proof_gate", delegatedByRootIdentityId: "root_operator", roles: ["proof-evaluator"] });
export const captureActor = Object.freeze({ kind: "human", rootIdentityId: "root_author", deviceId: "device_author", roles: ["evidence-author"] });
export const purgeActor = Object.freeze({ kind: "human", rootIdentityId: "root_custodian", deviceId: "device_custodian", roles: ["evidence-purger"] });

export function disclosure(overrides = {}) {
  return {
    audiences: overrides.audiences ?? ["review-node"],
    purposes: overrides.purposes ?? ["independent-review"],
    reviewerIdentityIds: overrides.reviewerIdentityIds ?? [],
  };
}

export function retention(overrides = {}) {
  return {
    policyId: overrides.policyId ?? "retention_test_v1",
    mode: overrides.mode ?? "purge-after",
    purgeEligibleAt: overrides.purgeEligibleAt ?? "2026-07-23T00:00:00.000Z",
    authorizedPurgerRoles: overrides.authorizedPurgerRoles ?? ["evidence-purger"],
  };
}

export function candidate(identityId, evidenceDigest, overrides = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const reviewerKind = overrides.reviewerKind ?? "model";
  const controllingIdentityId = overrides.controllingIdentityId === undefined ? `controller_${identityId}` : overrides.controllingIdentityId;
  const credential = {
    credentialId: `credential_${identityId}`,
    reviewerIdentityId: identityId,
    controllingIdentityId,
    reviewerKind,
    issuer: "review_authority",
    scopes: overrides.scopes ?? ["independent-review"],
    assuranceLevel: overrides.assuranceLevel ?? (reviewerKind === "human" ? "high" : "service"),
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    algorithm: "Ed25519",
    issuedAt: overrides.issuedAt ?? "2026-07-22T00:00:00.000Z",
    expiresAt: overrides.expiresAt ?? "2027-07-22T00:00:00.000Z",
    status: overrides.status ?? "active",
    proof: `credential-proof-${identityId}`,
  };
  const conflictDisclosure = overrides.conflictDisclosure === null ? null : {
    disclosureId: `disclosure_${identityId}`,
    reviewerIdentityId: identityId,
    evidenceDigest,
    hasConflict: overrides.hasConflict ?? false,
    conflictTypes: overrides.hasConflict ? ["declared"] : [],
    statement: overrides.hasConflict ? "Conflict declared." : "No conflict known.",
    disclosedAt: "2026-07-22T00:05:00.000Z",
    signature: `disclosure-signature-${identityId}`,
  };
  return {
    candidate: { reviewerIdentityId: identityId, controllingIdentityId, authorized: overrides.authorized ?? true, credential, conflictDisclosure },
    privateKey,
  };
}

export function signedAttestation(contract, assignment, privateKey, decision, issuedAt, overrides = {}) {
  return signReviewAttestation({
    reviewContractId: contract.reviewContractId,
    assignmentId: assignment.assignmentId,
    taskId: contract.taskId,
    submissionId: contract.submissionId,
    evidenceDigest: overrides.evidenceDigest ?? contract.evidenceDigest,
    policyVersion: contract.policyVersion,
    reviewerIdentityId: assignment.reviewerIdentityId,
    credentialId: assignment.credential.credentialId,
    credentialDigest: credentialDigest(assignment.credential),
    decision,
    confidence: decision === "abstain" ? 0 : 0.8,
    reasons: [{ code: overrides.reasonCode ?? `REVIEW_${decision.toUpperCase()}`, explanation: overrides.explanation ?? `Deterministic ${decision} test.` }],
    citations: overrides.citations ?? [{ artifactId: null, manifestPath: "/normalizedNarrative", excerptDigest: null }],
    issuedAt,
  }, privateKey);
}
