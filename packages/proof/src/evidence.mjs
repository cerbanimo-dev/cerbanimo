import {
  ProofContractError,
  assertPublicMetadata,
  canonicalize,
  cloneJson,
  deepFreeze,
  requireDigest,
  requireText,
  requireTimestamp,
  sha256,
  uniqueSorted,
} from "./canonical.mjs";

export const EVIDENCE_SCHEMA_VERSION = "cerbanimo.evidence/1.1.0";
export const EVIDENCE_DRAFT_SCHEMA_VERSION = "cerbanimo.evidence-draft/1.1.0";
export const PRIVACY_CLASSIFICATIONS = Object.freeze(["public", "community", "private", "restricted"]);

export function normalizeEvidenceNarrative(narrative) {
  const text = requireText(narrative, "narrative").normalize("NFC").replace(/\r\n?/g, "\n");
  return text.split("\n").map((line) => line.replace(/[\t ]+$/g, "")).join("\n").replace(/^\n+|\n+$/g, "");
}

function normalizeActor(actor, field) {
  if (!actor || typeof actor !== "object" || !["human", "service"].includes(actor.kind)) throw new ProofContractError("INVALID_EVIDENCE", `${field} must be an attributable actor`);
  if (actor.kind === "human") {
    return {
      kind: "human",
      rootIdentityId: requireText(actor.rootIdentityId, `${field}.rootIdentityId`),
      deviceId: requireText(actor.deviceId, `${field}.deviceId`),
      roles: uniqueSorted(actor.roles, `${field}.roles`),
    };
  }
  return {
    kind: "service",
    serviceId: requireText(actor.serviceId, `${field}.serviceId`),
    delegatedByRootIdentityId: requireText(actor.delegatedByRootIdentityId, `${field}.delegatedByRootIdentityId`),
    roles: uniqueSorted(actor.roles, `${field}.roles`),
  };
}

export function normalizeDisclosureScope(scope, field = "disclosureScope") {
  if (!scope || typeof scope !== "object") throw new ProofContractError("INVALID_DISCLOSURE_SCOPE", `${field} is required`);
  return {
    audiences: uniqueSorted(scope.audiences, `${field}.audiences`),
    purposes: uniqueSorted(scope.purposes, `${field}.purposes`),
    reviewerIdentityIds: uniqueSorted(scope.reviewerIdentityIds ?? [], `${field}.reviewerIdentityIds`),
  };
}

export function disclosureAllows(scope, audience, purpose, reviewerIdentityId) {
  return scope.audiences.includes(audience)
    && scope.purposes.includes(purpose)
    && (scope.reviewerIdentityIds.length === 0 || scope.reviewerIdentityIds.includes(reviewerIdentityId));
}

export function normalizeRetentionPolicy(policy, field = "retentionPolicy") {
  if (!policy || typeof policy !== "object") throw new ProofContractError("INVALID_RETENTION_POLICY", `${field} is required`);
  const mode = policy.mode;
  if (!["retain-until", "purge-after", "legal-hold"].includes(mode)) throw new ProofContractError("INVALID_RETENTION_POLICY", `${field}.mode is invalid`);
  const purgeEligibleAt = policy.purgeEligibleAt === null ? null : requireTimestamp(policy.purgeEligibleAt, `${field}.purgeEligibleAt`);
  if (mode === "purge-after" && purgeEligibleAt === null) throw new ProofContractError("INVALID_RETENTION_POLICY", "purge-after requires purgeEligibleAt");
  if (mode !== "purge-after" && purgeEligibleAt !== null) throw new ProofContractError("INVALID_RETENTION_POLICY", `${mode} cannot carry purgeEligibleAt`);
  return {
    policyId: requireText(policy.policyId, `${field}.policyId`),
    mode,
    purgeEligibleAt,
    authorizedPurgerRoles: uniqueSorted(policy.authorizedPurgerRoles, `${field}.authorizedPurgerRoles`),
  };
}

function normalizeArtifact(artifact, index) {
  const field = `artifacts[${index}]`;
  if (!artifact || typeof artifact !== "object") throw new ProofContractError("INVALID_EVIDENCE", `${field} is invalid`);
  if (!PRIVACY_CLASSIFICATIONS.includes(artifact.privacyClassification)) throw new ProofContractError("INVALID_EVIDENCE", `${field}.privacyClassification is invalid`);
  if (!Number.isSafeInteger(artifact.byteSize) || artifact.byteSize < 0) throw new ProofContractError("INVALID_EVIDENCE", `${field}.byteSize must be a non-negative integer`);
  const capture = artifact.capture;
  if (!capture || typeof capture !== "object" || !["local-upload", "constrained-fetch"].includes(capture.kind) || capture.preserved !== true) {
    throw new ProofContractError("INVALID_EVIDENCE", `${field}.capture must identify preserved content`);
  }
  const publicMetadata = cloneJson(artifact.publicMetadata ?? {});
  assertPublicMetadata(publicMetadata, `${field}.publicMetadata`);
  return {
    artifactId: requireText(artifact.artifactId, `${field}.artifactId`),
    artifactKind: requireText(artifact.artifactKind, `${field}.artifactKind`),
    contentDigest: requireDigest(artifact.contentDigest, `${field}.contentDigest`),
    byteSize: artifact.byteSize,
    mediaType: requireText(artifact.mediaType, `${field}.mediaType`).toLowerCase(),
    capture: {
      kind: capture.kind,
      preserved: true,
      custodyId: requireText(capture.custodyId, `${field}.capture.custodyId`),
      capturedAt: requireTimestamp(capture.capturedAt, `${field}.capture.capturedAt`),
      capturedBy: normalizeActor(capture.capturedBy, `${field}.capture.capturedBy`),
      sourceUri: capture.sourceUri === null ? null : requireText(capture.sourceUri, `${field}.capture.sourceUri`),
    },
    requirementIds: uniqueSorted(artifact.requirementIds, `${field}.requirementIds`),
    privacyClassification: artifact.privacyClassification,
    retentionPolicy: normalizeRetentionPolicy(artifact.retentionPolicy, `${field}.retentionPolicy`),
    disclosureScope: normalizeDisclosureScope(artifact.disclosureScope, `${field}.disclosureScope`),
    publicMetadata,
  };
}

function normalizeRemoteReference(reference, index) {
  const field = `remoteReferences[${index}]`;
  if (!reference || typeof reference !== "object") throw new ProofContractError("INVALID_EVIDENCE", `${field} is invalid`);
  let parsed;
  try { parsed = new URL(reference.url); } catch { throw new ProofContractError("INVALID_EVIDENCE", `${field}.url is invalid`); }
  if (!new Set(["https:", "http:"]).has(parsed.protocol)) throw new ProofContractError("INVALID_EVIDENCE", `${field}.url must be HTTP(S)`);
  return {
    referenceId: requireText(reference.referenceId, `${field}.referenceId`),
    url: parsed.toString(),
    mediaType: requireText(reference.mediaType, `${field}.mediaType`).toLowerCase(),
    preservationStatus: "reference-only",
    recordedAt: requireTimestamp(reference.recordedAt, `${field}.recordedAt`),
    recordedBy: normalizeActor(reference.recordedBy, `${field}.recordedBy`),
    disclosureScope: normalizeDisclosureScope(reference.disclosureScope, `${field}.disclosureScope`),
  };
}

function normalizeCoverage(entries, artifactIds) {
  if (!Array.isArray(entries)) throw new ProofContractError("INVALID_EVIDENCE", "requirementCoverage must be an array");
  const normalized = entries.map((entry, index) => ({
    requirementId: requireText(entry?.requirementId, `requirementCoverage[${index}].requirementId`),
    artifactIds: uniqueSorted(entry?.artifactIds, `requirementCoverage[${index}].artifactIds`),
    declaration: requireText(entry?.declaration, `requirementCoverage[${index}].declaration`),
  })).sort((left, right) => left.requirementId.localeCompare(right.requirementId));
  if (new Set(normalized.map(({ requirementId }) => requirementId)).size !== normalized.length) throw new ProofContractError("INVALID_EVIDENCE", "Requirement coverage IDs must be unique");
  for (const entry of normalized) {
    for (const artifactId of entry.artifactIds) if (!artifactIds.has(artifactId)) throw new ProofContractError("INVALID_EVIDENCE", "Requirement coverage refers to an unknown artifact", { requirementId: entry.requirementId, artifactId });
  }
  return normalized;
}

function contentFingerprintMaterial(bundle) {
  return {
    normalizedNarrative: bundle.normalizedNarrative,
    artifacts: bundle.artifacts.map(({ artifactKind, contentDigest, byteSize, mediaType, requirementIds }) => ({ artifactKind, contentDigest, byteSize, mediaType, requirementIds })),
    requirementCoverage: bundle.requirementCoverage,
    remoteReferences: bundle.remoteReferences.map(({ url, mediaType, preservationStatus }) => ({ url, mediaType, preservationStatus })),
  };
}

export function createEvidenceDraft(input) {
  const draft = {
    schemaVersion: EVIDENCE_DRAFT_SCHEMA_VERSION,
    taskId: requireText(input.taskId, "taskId"),
    submissionId: requireText(input.submissionId, "submissionId"),
    authorIdentityId: requireText(input.authorIdentityId, "authorIdentityId"),
    evidenceCycleId: requireText(input.evidenceCycleId, "evidenceCycleId"),
    normalizedNarrative: normalizeEvidenceNarrative(input.narrative),
    artifacts: (input.artifacts ?? []).map(normalizeArtifact),
    remoteReferences: (input.remoteReferences ?? []).map(normalizeRemoteReference),
    requirementCoverage: [],
    narrativeDisclosureScope: normalizeDisclosureScope(input.narrativeDisclosureScope),
    updatedAt: requireTimestamp(input.updatedAt, "updatedAt"),
  };
  const ids = new Set(draft.artifacts.map(({ artifactId }) => artifactId));
  if (ids.size !== draft.artifacts.length) throw new ProofContractError("INVALID_EVIDENCE", "Artifact IDs must be unique");
  draft.requirementCoverage = normalizeCoverage(input.requirementCoverage ?? [], ids);
  return draft;
}

export function updateEvidenceDraft(draft, changes) {
  if (draft.schemaVersion !== EVIDENCE_DRAFT_SCHEMA_VERSION) throw new ProofContractError("INVALID_EVIDENCE", "Only a draft can be updated");
  return createEvidenceDraft({
    ...draft,
    narrative: changes.narrative ?? draft.normalizedNarrative,
    artifacts: changes.artifacts ?? draft.artifacts,
    remoteReferences: changes.remoteReferences ?? draft.remoteReferences,
    requirementCoverage: changes.requirementCoverage ?? draft.requirementCoverage,
    narrativeDisclosureScope: changes.narrativeDisclosureScope ?? draft.narrativeDisclosureScope,
    updatedAt: changes.updatedAt,
  });
}

export function closeEvidenceBundle({ draft, evidencePolicyVersion, closureActor, closedAt }) {
  if (!draft || draft.schemaVersion !== EVIDENCE_DRAFT_SCHEMA_VERSION) throw new ProofContractError("INVALID_EVIDENCE", "A versioned evidence draft is required");
  const unsigned = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    taskId: draft.taskId,
    submissionId: draft.submissionId,
    authorIdentityId: draft.authorIdentityId,
    evidenceCycleId: draft.evidenceCycleId,
    normalizedNarrative: draft.normalizedNarrative,
    artifacts: cloneJson(draft.artifacts).sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    remoteReferences: cloneJson(draft.remoteReferences).sort((left, right) => left.referenceId.localeCompare(right.referenceId)),
    requirementCoverage: cloneJson(draft.requirementCoverage),
    narrativeDisclosureScope: cloneJson(draft.narrativeDisclosureScope),
    evidencePolicyVersion: requireText(evidencePolicyVersion, "evidencePolicyVersion"),
    closureActor: normalizeActor(closureActor, "closureActor"),
    closedAt: requireTimestamp(closedAt, "closedAt"),
  };
  const contentFingerprint = sha256(contentFingerprintMaterial(unsigned));
  const bundleDigest = sha256({ ...unsigned, contentFingerprint });
  return deepFreeze({ ...unsigned, contentFingerprint, bundleDigest });
}

export function calculateBundleDigest(bundle) {
  const { bundleDigest: _digest, ...unsigned } = cloneJson(bundle);
  return sha256(unsigned);
}

export function verifyEvidenceBundle(bundle) {
  if (!bundle || bundle.schemaVersion !== EVIDENCE_SCHEMA_VERSION) return { valid: false, code: "BUNDLE_SCHEMA_UNSUPPORTED" };
  try {
    requireDigest(bundle.bundleDigest, "bundleDigest");
    const actual = calculateBundleDigest(bundle);
    if (actual !== bundle.bundleDigest) return { valid: false, code: "BUNDLE_DIGEST_MISMATCH", expected: bundle.bundleDigest, actual };
    const expectedFingerprint = sha256(contentFingerprintMaterial(bundle));
    if (expectedFingerprint !== bundle.contentFingerprint) return { valid: false, code: "BUNDLE_DIGEST_MISMATCH", expected: bundle.contentFingerprint, actual: expectedFingerprint };
    return { valid: true, code: "BUNDLE_INTEGRITY_CONFIRMED", digest: actual };
  } catch (error) {
    return { valid: false, code: "BUNDLE_INVALID", detail: error instanceof Error ? error.message : String(error) };
  }
}

export function replayEvidenceState(events) {
  const state = { bundle: null, deterministicResult: null, artifactTombstones: [] };
  for (const event of events) {
    if (event.type === "EvidenceClosed") state.bundle = cloneJson(event.payload.bundle);
    if (["DeterministicProofPassed", "DeterministicProofRejected"].includes(event.type)) state.deterministicResult = cloneJson(event.payload.result);
    if (event.type === "EvidenceArtifactPurged") state.artifactTombstones.push(cloneJson(event.payload.tombstone));
  }
  return state;
}

export function evidenceManifestBytes(bundle) {
  return Buffer.from(canonicalize(bundle), "utf8");
}
