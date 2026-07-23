import { ProofContractError, cloneJson, deepFreeze, requireText, requireTimestamp } from "./canonical.mjs";
import { EVIDENCE_SCHEMA_VERSION, normalizeEvidenceNarrative, verifyEvidenceBundle } from "./evidence.mjs";

export const PROOF_POLICY_SCHEMA_VERSION = "cerbanimo.proof-policy/1.1.0";
export const PROOF_RESULT_SCHEMA_VERSION = "cerbanimo.proof-result/1.1.0";

export const PROOF_REASON_CODES = Object.freeze({
  eligible: "PROOF_ELIGIBLE_FOR_INDEPENDENT_REVIEW",
  schema: "BUNDLE_SCHEMA_UNSUPPORTED",
  integrity: "BUNDLE_DIGEST_MISMATCH",
  invalid: "BUNDLE_INVALID",
  policy: "POLICY_VERSION_MISMATCH",
  missing: "REQUIRED_ARTIFACT_MISSING",
  preserved: "ARTIFACT_NOT_PRESERVED",
  oversized: "ARTIFACT_SIZE_EXCEEDED",
  mediaType: "ARTIFACT_MEDIA_TYPE_DISALLOWED",
  coverage: "REQUIREMENT_COVERAGE_MISSING",
  contradiction: "EXPLICIT_NON_COMPLETION",
  replay: "EVIDENCE_REPLAYED",
  assertion: "MACHINE_ASSERTION_FAILED",
});

function check(checkId, passed, reasonCode, details = {}) {
  return { checkId, passed, reasonCode, details };
}

export function createProofPolicy(input) {
  if (!input || typeof input !== "object") throw new ProofContractError("INVALID_PROOF_POLICY", "Proof policy is required");
  if (!Number.isSafeInteger(input.maxArtifactBytes) || input.maxArtifactBytes < 1) throw new ProofContractError("INVALID_PROOF_POLICY", "maxArtifactBytes must be positive");
  const maxTotalBytes = input.maxTotalBytes ?? input.maxArtifactBytes;
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < input.maxArtifactBytes) throw new ProofContractError("INVALID_PROOF_POLICY", "maxTotalBytes must be at least maxArtifactBytes");
  const policy = {
    schemaVersion: PROOF_POLICY_SCHEMA_VERSION,
    policyVersion: requireText(input.policyVersion, "policyVersion"),
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    requiredArtifactKinds: [...new Set(input.requiredArtifactKinds ?? [])].sort(),
    allowedMediaTypes: [...new Set(input.allowedMediaTypes ?? [])].map((value) => requireText(value, "allowedMediaTypes").toLowerCase()).sort(),
    maxArtifactBytes: input.maxArtifactBytes,
    maxTotalBytes,
    requiredRequirementIds: [...new Set(input.requiredRequirementIds ?? [])].sort(),
    explicitNonCompletionPhrases: [...new Set(input.explicitNonCompletionPhrases ?? [])].map(normalizeEvidenceNarrative).sort(),
    machineAssertionIds: [...new Set(input.machineAssertionIds ?? [])].sort(),
  };
  return deepFreeze(policy);
}

function actorForResult(actor) {
  if (!actor || typeof actor !== "object" || !["human", "service"].includes(actor.kind)) throw new ProofContractError("INVALID_PROOF_ACTOR", "An attributable proof evaluator is required");
  return cloneJson(actor);
}

export function evaluateDeterministicProof({ bundle, policy, priorContentFingerprints = [], assertionEvaluators = {}, actor, evaluatedAt }) {
  if (!policy || policy.schemaVersion !== PROOF_POLICY_SCHEMA_VERSION) throw new ProofContractError("INVALID_PROOF_POLICY", "A versioned proof policy is required");
  const checks = [];
  const integrity = verifyEvidenceBundle(bundle);
  checks.push(check("bundle.integrity", integrity.valid, integrity.valid ? "BUNDLE_INTEGRITY_CONFIRMED" : integrity.code, integrity));
  checks.push(check("bundle.schema", bundle?.schemaVersion === policy.evidenceSchemaVersion, bundle?.schemaVersion === policy.evidenceSchemaVersion ? "BUNDLE_SCHEMA_SUPPORTED" : PROOF_REASON_CODES.schema, { expected: policy.evidenceSchemaVersion, actual: bundle?.schemaVersion ?? null }));
  checks.push(check("bundle.policy", bundle?.evidencePolicyVersion === policy.policyVersion, bundle?.evidencePolicyVersion === policy.policyVersion ? "POLICY_VERSION_CONFIRMED" : PROOF_REASON_CODES.policy, { expected: policy.policyVersion, actual: bundle?.evidencePolicyVersion ?? null }));

  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  for (const kind of policy.requiredArtifactKinds) {
    const present = artifacts.some((artifact) => artifact.artifactKind === kind);
    checks.push(check(`artifact.required.${kind}`, present, present ? "REQUIRED_ARTIFACT_PRESENT" : PROOF_REASON_CODES.missing, { artifactKind: kind }));
  }
  for (const artifact of artifacts) {
    const preserved = artifact.capture?.preserved === true && ["local-upload", "constrained-fetch"].includes(artifact.capture?.kind);
    checks.push(check(`artifact.preserved.${artifact.artifactId}`, preserved, preserved ? "ARTIFACT_PRESERVED" : PROOF_REASON_CODES.preserved, { artifactId: artifact.artifactId }));
    const sizeAllowed = Number.isSafeInteger(artifact.byteSize) && artifact.byteSize <= policy.maxArtifactBytes;
    checks.push(check(`artifact.size.${artifact.artifactId}`, sizeAllowed, sizeAllowed ? "ARTIFACT_SIZE_ALLOWED" : PROOF_REASON_CODES.oversized, { artifactId: artifact.artifactId, byteSize: artifact.byteSize, maximum: policy.maxArtifactBytes }));
    const mediaAllowed = policy.allowedMediaTypes.includes(artifact.mediaType);
    checks.push(check(`artifact.media-type.${artifact.artifactId}`, mediaAllowed, mediaAllowed ? "ARTIFACT_MEDIA_TYPE_ALLOWED" : PROOF_REASON_CODES.mediaType, { artifactId: artifact.artifactId, mediaType: artifact.mediaType }));
  }
  const totalBytes = artifacts.reduce((sum, artifact) => sum + (Number.isSafeInteger(artifact.byteSize) ? artifact.byteSize : 0), 0);
  checks.push(check("artifact.total-size", totalBytes <= policy.maxTotalBytes, totalBytes <= policy.maxTotalBytes ? "TOTAL_SIZE_ALLOWED" : PROOF_REASON_CODES.oversized, { totalBytes, maximum: policy.maxTotalBytes }));

  const coverage = new Map((bundle?.requirementCoverage ?? []).map((entry) => [entry.requirementId, entry]));
  for (const requirementId of policy.requiredRequirementIds) {
    const entry = coverage.get(requirementId);
    const covered = Boolean(entry && entry.declaration && entry.artifactIds.length > 0);
    checks.push(check(`requirement.coverage.${requirementId}`, covered, covered ? "REQUIREMENT_COVERAGE_DECLARED" : PROOF_REASON_CODES.coverage, { requirementId }));
  }

  const narrative = typeof bundle?.normalizedNarrative === "string" ? bundle.normalizedNarrative.toLocaleLowerCase("en-US") : "";
  const contradictions = policy.explicitNonCompletionPhrases.filter((phrase) => narrative.includes(phrase.toLocaleLowerCase("en-US")));
  checks.push(check("narrative.explicit-non-completion", contradictions.length === 0, contradictions.length === 0 ? "NO_EXPLICIT_NON_COMPLETION" : PROOF_REASON_CODES.contradiction, { matchedPhrases: contradictions }));

  const replayed = typeof bundle?.contentFingerprint === "string" && priorContentFingerprints.includes(bundle.contentFingerprint);
  checks.push(check("evidence.replay", !replayed, replayed ? PROOF_REASON_CODES.replay : "EVIDENCE_NOT_REPLAYED", { contentFingerprint: bundle?.contentFingerprint ?? null }));

  for (const assertionId of policy.machineAssertionIds) {
    const evaluator = assertionEvaluators[assertionId];
    let assertionResult;
    try {
      assertionResult = typeof evaluator === "function" ? evaluator(deepFreeze(cloneJson(bundle))) : { passed: false, detail: "Evaluator unavailable" };
    } catch (error) {
      assertionResult = { passed: false, detail: error instanceof Error ? error.message : String(error) };
    }
    const passed = assertionResult?.passed === true;
    checks.push(check(`assertion.${assertionId}`, passed, passed ? "MACHINE_ASSERTION_PASSED" : PROOF_REASON_CODES.assertion, { assertionId, detail: String(assertionResult?.detail ?? "") }));
  }

  const failures = checks.filter(({ passed }) => !passed);
  const resultCodes = failures.length === 0
    ? [PROOF_REASON_CODES.eligible]
    : [...new Set(failures.map(({ reasonCode }) => reasonCode))].sort();
  const result = {
    schemaVersion: PROOF_RESULT_SCHEMA_VERSION,
    taskId: bundle?.taskId ?? null,
    submissionId: bundle?.submissionId ?? null,
    evidenceCycleId: bundle?.evidenceCycleId ?? null,
    evidenceSchemaVersion: bundle?.schemaVersion ?? null,
    evidenceDigest: bundle?.bundleDigest ?? null,
    contentFingerprint: bundle?.contentFingerprint ?? null,
    policySchemaVersion: policy.schemaVersion,
    policyVersion: policy.policyVersion,
    decision: failures.length === 0 ? "pass" : "reject",
    meaning: failures.length === 0 ? "eligible-for-independent-review" : "structurally-ineligible",
    truthClaim: "none",
    checks,
    resultCodes,
    evaluatedBy: actorForResult(actor),
    evaluatedAt: requireTimestamp(evaluatedAt, "evaluatedAt"),
  };
  return deepFreeze(result);
}

export function deterministicProofEventDrafts(result, reviewContract = null) {
  if (!result || result.schemaVersion !== PROOF_RESULT_SCHEMA_VERSION) throw new ProofContractError("INVALID_PROOF_RESULT", "A versioned deterministic result is required");
  const base = {
    taskId: result.taskId,
    evidenceDigest: result.evidenceDigest,
    evidenceSchemaVersion: result.evidenceSchemaVersion,
    policyVersion: result.policyVersion,
    resultCodes: cloneJson(result.resultCodes),
    evaluatedBy: cloneJson(result.evaluatedBy),
    evaluatedAt: result.evaluatedAt,
    result: cloneJson(result),
  };
  if (result.decision === "reject") return [{ type: "DeterministicProofRejected", payload: { ...base, rejectionStage: "deterministic" } }];
  if (!reviewContract || reviewContract.evidenceDigest !== result.evidenceDigest || reviewContract.policyVersion !== result.policyVersion) {
    throw new ProofContractError("REVIEW_BINDING_MISMATCH", "A passing gate must open review against the same evidence and policy");
  }
  return [
    { type: "DeterministicProofPassed", payload: base },
    { type: "ReviewOpened", payload: { taskId: result.taskId, contract: cloneJson(reviewContract) } },
  ];
}
