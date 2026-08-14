const text = { type: "string", minLength: 1 };
const timestamp = { type: "string", format: "date-time" };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const strings = { type: "array", items: text, uniqueItems: true };
const nullableText = { anyOf: [text, { type: "null" }] };
const object = (required, properties) => ({ type: "object", required, properties, additionalProperties: false });

const credential = object([
  "credentialId", "reviewerIdentityId", "controllingIdentityId", "reviewerKind", "issuer", "scopes", "assuranceLevel",
  "publicKey", "algorithm", "issuedAt", "expiresAt", "status", "proof",
], {
  credentialId: text, reviewerIdentityId: text, controllingIdentityId: nullableText, reviewerKind: { enum: ["human", "model"] },
  issuer: text, scopes: strings, assuranceLevel: { enum: ["substantial", "high", "service"] }, publicKey: text,
  algorithm: { const: "Ed25519" }, issuedAt: timestamp, expiresAt: timestamp, status: { enum: ["active", "revoked"] }, proof: text,
});
const conflict = object(["disclosureId", "reviewerIdentityId", "evidenceDigest", "hasConflict", "conflictTypes", "statement", "disclosedAt", "signature"], {
  disclosureId: text, reviewerIdentityId: text, evidenceDigest: digest, hasConflict: { type: "boolean" }, conflictTypes: strings,
  statement: text, disclosedAt: timestamp, signature: text,
});
const candidate = object(["reviewerIdentityId", "controllingIdentityId", "reviewerKind", "authorized", "credential", "conflictDisclosure"], {
  reviewerIdentityId: text, controllingIdentityId: nullableText, reviewerKind: { enum: ["human", "model"] }, authorized: { type: "boolean" },
  credential, conflictDisclosure: conflict,
});
const exclusion = object(["reviewerIdentityId", "reason"], { reviewerIdentityId: text, reason: text });
const pool = object([
  "schemaVersion", "taskId", "submissionId", "evidenceDigest", "policyVersion", "authorIdentityId", "taskOwnerIdentityId",
  "excludeTaskOwner", "snapshotAt", "eligible", "exclusions", "selectionCaveat", "poolDigest",
], {
  schemaVersion: { const: "cerbanimo.reviewer-pool/1.1.0" }, taskId: text, submissionId: text, evidenceDigest: digest,
  policyVersion: text, authorIdentityId: text, taskOwnerIdentityId: nullableText, excludeTaskOwner: { type: "boolean" }, snapshotAt: timestamp,
  eligible: { type: "array", items: candidate, uniqueItems: true }, exclusions: { type: "array", items: exclusion }, selectionCaveat: text, poolDigest: digest,
});
const assignment = object([
  "assignmentId", "ordinal", "round", "reviewerIdentityId", "controllingIdentityId", "reviewerKind", "credential",
  "conflictDisclosure", "assignedAt", "expiresAt", "status",
], {
  assignmentId: text, ordinal: { type: "integer", minimum: 0 }, round: { type: "integer", minimum: 0 }, reviewerIdentityId: text,
  controllingIdentityId: nullableText, reviewerKind: { enum: ["human", "model"] }, credential, conflictDisclosure: conflict,
  assignedAt: timestamp, expiresAt: timestamp, status: { enum: ["assigned", "returned", "expired", "revoked"] },
});
const contract = object([
  "schemaVersion", "reviewContractId", "taskId", "submissionId", "evidenceDigest", "policyVersion", "openingBasis", "appealId",
  "poolSnapshot", "poolDigest", "assignmentSeedCommitment", "revealedAssignmentSeed", "assignmentOrder", "assignments",
  "quorum", "maxReassignments", "reassignmentsUsed", "assignedAt", "expiresAt",
], {
  schemaVersion: { const: "cerbanimo.review/1.1.0" }, reviewContractId: text, taskId: text, submissionId: text,
  evidenceDigest: digest, policyVersion: text, openingBasis: { enum: ["deterministic-pass", "appeal-overturn"] }, appealId: nullableText,
  poolSnapshot: pool, poolDigest: digest, assignmentSeedCommitment: digest, revealedAssignmentSeed: text, assignmentOrder: strings,
  assignments: { type: "array", items: assignment, minItems: 1, uniqueItems: true }, quorum: { type: "integer", minimum: 1 },
  maxReassignments: { type: "integer", minimum: 0, maximum: 20 }, reassignmentsUsed: { type: "integer", minimum: 0, maximum: 20 },
  assignedAt: timestamp, expiresAt: timestamp,
});
const reason = object(["code", "explanation"], { code: text, explanation: text });
const citation = object(["artifactId", "manifestPath", "excerptDigest"], { artifactId: nullableText, manifestPath: text, excerptDigest: { anyOf: [digest, { type: "null" }] } });
const attestation = object([
  "schemaVersion", "reviewContractId", "assignmentId", "taskId", "submissionId", "evidenceDigest", "policyVersion",
  "reviewerIdentityId", "credentialId", "credentialDigest", "decision", "confidence", "reasons", "citations", "issuedAt",
  "attestationId", "signature",
], {
  schemaVersion: { const: "cerbanimo.review-attestation/1.1.0" }, reviewContractId: text, assignmentId: text, taskId: text,
  submissionId: text, evidenceDigest: digest, policyVersion: text, reviewerIdentityId: text, credentialId: text, credentialDigest: digest,
  decision: { enum: ["approve", "reject", "abstain"] }, confidence: { type: "number", minimum: 0, maximum: 1 },
  reasons: { type: "array", items: reason, minItems: 1 }, citations: { type: "array", items: citation }, issuedAt: timestamp,
  attestationId: text, signature: object(["algorithm", "value"], { algorithm: { const: "Ed25519" }, value: text }),
});
const packet = object([
  "schemaVersion", "reviewContractId", "assignmentId", "reviewerIdentityId", "taskId", "submissionId", "evidenceDigest",
  "policyVersion", "audience", "purpose", "issuedAt", "expiresAt", "instructions", "untrustedEvidence", "packetDigest",
], {
  schemaVersion: { const: "cerbanimo.review-packet/1.1.0" }, reviewContractId: text, assignmentId: text, reviewerIdentityId: text,
  taskId: text, submissionId: text, evidenceDigest: digest, policyVersion: text, audience: text, purpose: text,
  issuedAt: timestamp, expiresAt: timestamp,
  instructions: object(["authority", "evidenceTreatment", "allowedDecisions", "truthBoundary"], { authority: text, evidenceTreatment: text, allowedDecisions: strings, truthBoundary: text }),
  untrustedEvidence: object(["delimiterStart", "normalizedNarrative", "artifactManifests", "remoteReferences", "requirementCoverage", "delimiterEnd"], {
    delimiterStart: { const: "-----BEGIN UNTRUSTED EVIDENCE CONTENT-----" }, normalizedNarrative: text,
    artifactManifests: { type: "array", items: { type: "object" } }, remoteReferences: { type: "array", items: { type: "object" } },
    requirementCoverage: { type: "array", items: { type: "object" } }, delimiterEnd: { const: "-----END UNTRUSTED EVIDENCE CONTENT-----" },
  }),
  packetDigest: digest,
});

export const REVIEW_SCHEMAS = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.cerbanimo.local/independent-review/1.1.0",
  title: "Cerbanimo Packet 003 independent-review contracts",
  oneOf: [{ $ref: "#/$defs/ReviewerPoolSnapshot" }, { $ref: "#/$defs/ReviewContract" }, { $ref: "#/$defs/ReviewPacket" }, { $ref: "#/$defs/ReviewAttestation" }],
  $defs: { ReviewerCredential: credential, ConflictDisclosure: conflict, ReviewerCandidate: candidate, ReviewerPoolSnapshot: pool, ReviewAssignment: assignment, ReviewContract: contract, ReviewReason: reason, ReviewCitation: citation, ReviewAttestation: attestation, ReviewPacket: packet },
});
