const text = { type: "string", minLength: 1 };
const timestamp = { type: "string", format: "date-time" };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const stringArray = { type: "array", items: text, uniqueItems: true };
const object = (required, properties) => ({ type: "object", required, properties, additionalProperties: false });

const actor = {
  oneOf: [
    object(["kind", "rootIdentityId", "deviceId", "roles"], { kind: { const: "human" }, rootIdentityId: text, deviceId: text, roles: stringArray }),
    object(["kind", "serviceId", "delegatedByRootIdentityId", "roles"], { kind: { const: "service" }, serviceId: text, delegatedByRootIdentityId: text, roles: stringArray }),
  ],
};
const disclosure = object(["audiences", "purposes", "reviewerIdentityIds"], { audiences: stringArray, purposes: stringArray, reviewerIdentityIds: stringArray });
const retention = object(["policyId", "mode", "purgeEligibleAt", "authorizedPurgerRoles"], {
  policyId: text,
  mode: { enum: ["retain-until", "purge-after", "legal-hold"] },
  purgeEligibleAt: { anyOf: [timestamp, { type: "null" }] },
  authorizedPurgerRoles: stringArray,
});
const artifact = object([
  "artifactId", "artifactKind", "contentDigest", "byteSize", "mediaType", "capture", "requirementIds",
  "privacyClassification", "retentionPolicy", "disclosureScope", "publicMetadata",
], {
  artifactId: text,
  artifactKind: text,
  contentDigest: digest,
  byteSize: { type: "integer", minimum: 0 },
  mediaType: text,
  capture: object(["kind", "preserved", "custodyId", "capturedAt", "capturedBy", "sourceUri"], {
    kind: { enum: ["local-upload", "constrained-fetch"] }, preserved: { const: true }, custodyId: text,
    capturedAt: timestamp, capturedBy: actor, sourceUri: { anyOf: [text, { type: "null" }] },
  }),
  requirementIds: stringArray,
  privacyClassification: { enum: ["public", "community", "private", "restricted"] },
  retentionPolicy: retention,
  disclosureScope: disclosure,
  publicMetadata: { type: "object" },
});
const remoteReference = object(["referenceId", "url", "mediaType", "preservationStatus", "recordedAt", "recordedBy", "disclosureScope"], {
  referenceId: text, url: { type: "string", format: "uri" }, mediaType: text, preservationStatus: { const: "reference-only" },
  recordedAt: timestamp, recordedBy: actor, disclosureScope: disclosure,
});
const coverage = object(["requirementId", "artifactIds", "declaration"], { requirementId: text, artifactIds: stringArray, declaration: text });

const evidenceBundle = object([
  "schemaVersion", "taskId", "submissionId", "authorIdentityId", "evidenceCycleId", "normalizedNarrative",
  "artifacts", "remoteReferences", "requirementCoverage", "narrativeDisclosureScope", "evidencePolicyVersion",
  "closureActor", "closedAt", "contentFingerprint", "bundleDigest",
], {
  schemaVersion: { const: "cerbanimo.evidence/1.1.0" }, taskId: text, submissionId: text, authorIdentityId: text,
  evidenceCycleId: text, normalizedNarrative: text, artifacts: { type: "array", items: artifact, uniqueItems: true },
  remoteReferences: { type: "array", items: remoteReference, uniqueItems: true },
  requirementCoverage: { type: "array", items: coverage, uniqueItems: true }, narrativeDisclosureScope: disclosure,
  evidencePolicyVersion: text, closureActor: actor, closedAt: timestamp, contentFingerprint: digest, bundleDigest: digest,
});
const proofPolicy = object([
  "schemaVersion", "policyVersion", "evidenceSchemaVersion", "requiredArtifactKinds", "allowedMediaTypes",
  "maxArtifactBytes", "maxTotalBytes", "requiredRequirementIds", "explicitNonCompletionPhrases", "machineAssertionIds",
], {
  schemaVersion: { const: "cerbanimo.proof-policy/1.1.0" }, policyVersion: text,
  evidenceSchemaVersion: { const: "cerbanimo.evidence/1.1.0" }, requiredArtifactKinds: stringArray,
  allowedMediaTypes: stringArray, maxArtifactBytes: { type: "integer", minimum: 1 }, maxTotalBytes: { type: "integer", minimum: 1 },
  requiredRequirementIds: stringArray, explicitNonCompletionPhrases: stringArray, machineAssertionIds: stringArray,
});
const proofCheck = object(["checkId", "passed", "reasonCode", "details"], { checkId: text, passed: { type: "boolean" }, reasonCode: text, details: { type: "object" } });
const proofResult = object([
  "schemaVersion", "taskId", "submissionId", "evidenceCycleId", "evidenceSchemaVersion", "evidenceDigest",
  "contentFingerprint", "policySchemaVersion", "policyVersion", "decision", "meaning", "truthClaim", "checks",
  "resultCodes", "evaluatedBy", "evaluatedAt",
], {
  schemaVersion: { const: "cerbanimo.proof-result/1.1.0" }, taskId: text, submissionId: text, evidenceCycleId: text,
  evidenceSchemaVersion: { const: "cerbanimo.evidence/1.1.0" }, evidenceDigest: digest, contentFingerprint: digest,
  policySchemaVersion: { const: "cerbanimo.proof-policy/1.1.0" }, policyVersion: text,
  decision: { enum: ["pass", "reject"] }, meaning: { enum: ["eligible-for-independent-review", "structurally-ineligible"] },
  truthClaim: { const: "none" }, checks: { type: "array", items: proofCheck, minItems: 1 }, resultCodes: stringArray,
  evaluatedBy: actor, evaluatedAt: timestamp,
});

export const PROOF_SCHEMAS = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.cerbanimo.local/evidence-proof/1.1.0",
  title: "Cerbanimo Packet 003 evidence custody and deterministic proof contracts",
  oneOf: [{ $ref: "#/$defs/EvidenceBundle" }, { $ref: "#/$defs/ProofPolicy" }, { $ref: "#/$defs/ProofResult" }],
  $defs: { Actor: actor, DisclosureScope: disclosure, RetentionPolicy: retention, ArtifactManifest: artifact, RemoteReference: remoteReference, RequirementCoverage: coverage, EvidenceBundle: evidenceBundle, ProofPolicy: proofPolicy, ProofCheck: proofCheck, ProofResult: proofResult },
});
