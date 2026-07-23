import assert from "node:assert/strict";
import test from "node:test";
import {
  PROOF_REASON_CODES,
  closeEvidenceBundle,
  createEvidenceDraft,
  createProofPolicy,
  deterministicProofEventDrafts,
  evaluateDeterministicProof,
  sha256,
} from "../../packages/proof/src/index.mjs";
import { captureActor, disclosure, retention, serviceActor } from "./support.mjs";

function manifest(overrides = {}) {
  const bytes = overrides.bytes ?? Buffer.from("valid proof bytes");
  return {
    artifactId: overrides.artifactId ?? "artifact_screenshot",
    artifactKind: overrides.artifactKind ?? "screenshot",
    contentDigest: sha256(bytes),
    byteSize: overrides.byteSize ?? bytes.byteLength,
    mediaType: overrides.mediaType ?? "image/png",
    capture: { kind: "local-upload", preserved: true, custodyId: overrides.custodyId ?? "custody_proof", capturedAt: "2026-07-22T12:00:00.000Z", capturedBy: captureActor, sourceUri: null },
    requirementIds: overrides.requirementIds ?? ["req_done"], privacyClassification: "private",
    retentionPolicy: retention(), disclosureScope: disclosure(), publicMetadata: {},
  };
}

function bundle(overrides = {}) {
  const artifacts = overrides.artifacts ?? [manifest()];
  const coverage = overrides.requirementCoverage ?? [{ requirementId: "req_done", artifactIds: artifacts.length ? [artifacts[0].artifactId] : [], declaration: "Manifest declares completion coverage." }];
  const draft = createEvidenceDraft({
    taskId: overrides.taskId ?? "task_proof", submissionId: overrides.submissionId ?? "submission_proof", authorIdentityId: "root_author",
    evidenceCycleId: "cycle_proof_1", narrative: overrides.narrative ?? "The required work is complete.", artifacts,
    remoteReferences: overrides.remoteReferences ?? [], requirementCoverage: coverage, narrativeDisclosureScope: disclosure(),
    updatedAt: "2026-07-22T12:01:00.000Z",
  });
  return closeEvidenceBundle({ draft, evidencePolicyVersion: overrides.policyVersion ?? "proof_policy_v1", closureActor: captureActor, closedAt: "2026-07-22T12:02:00.000Z" });
}

const policy = createProofPolicy({
  policyVersion: "proof_policy_v1", requiredArtifactKinds: ["screenshot"], allowedMediaTypes: ["image/png"],
  maxArtifactBytes: 32, maxTotalBytes: 64, requiredRequirementIds: ["req_done"],
  explicitNonCompletionPhrases: ["I did not complete the work"], machineAssertionIds: ["png-structure"],
});

function evaluate(closedBundle, overrides = {}) {
  return evaluateDeterministicProof({
    bundle: closedBundle, policy, priorContentFingerprints: overrides.priorContentFingerprints ?? [],
    assertionEvaluators: overrides.assertionEvaluators ?? { "png-structure": () => ({ passed: true, detail: "Synthetic PNG structure accepted." }) },
    actor: serviceActor, evaluatedAt: "2026-07-22T12:03:00.000Z",
  });
}

test("missing, contradictory, oversized, disallowed, and replayed evidence have stable reason codes", () => {
  const referenceOnly = bundle({
    artifacts: [], requirementCoverage: [{ requirementId: "req_done", artifactIds: [], declaration: "A URL was supplied." }],
    remoteReferences: [{ referenceId: "remote_only", url: "https://example.test/transient", mediaType: "image/png", recordedAt: "2026-07-22T12:00:00.000Z", recordedBy: captureActor, disclosureScope: disclosure() }],
  });
  assert.ok(evaluate(referenceOnly).resultCodes.includes(PROOF_REASON_CODES.missing));
  assert.ok(evaluate(referenceOnly).resultCodes.includes(PROOF_REASON_CODES.coverage));

  const contradictory = evaluate(bundle({ narrative: "I did not complete the work, despite attaching a file." }));
  assert.ok(contradictory.resultCodes.includes(PROOF_REASON_CODES.contradiction));

  const oversized = evaluate(bundle({ artifacts: [manifest({ byteSize: 33 })] }));
  assert.ok(oversized.resultCodes.includes(PROOF_REASON_CODES.oversized));

  const disallowed = evaluate(bundle({ artifacts: [manifest({ mediaType: "application/x-msdownload" })] }));
  assert.ok(disallowed.resultCodes.includes(PROOF_REASON_CODES.mediaType));

  const original = bundle();
  const replayed = evaluate(original, { priorContentFingerprints: [original.contentFingerprint] });
  assert.ok(replayed.resultCodes.includes(PROOF_REASON_CODES.replay));
  for (const result of [contradictory, oversized, disallowed, replayed]) {
    assert.equal(result.decision, "reject");
    assert.equal(result.truthClaim, "none");
    assert.equal(result.evidenceDigest.length, 64);
    assert.equal(result.policyVersion, policy.policyVersion);
  }
});

test("bundle tampering and policy-specific assertions fail closed", () => {
  const closed = bundle();
  const tampered = structuredClone(closed);
  tampered.normalizedNarrative = "Changed after closure";
  assert.ok(evaluate(tampered).resultCodes.includes(PROOF_REASON_CODES.integrity));
  const assertionFailure = evaluate(closed, { assertionEvaluators: { "png-structure": () => ({ passed: false, detail: "Signature bytes absent." }) } });
  assert.ok(assertionFailure.resultCodes.includes(PROOF_REASON_CODES.assertion));
  assert.ok(assertionFailure.checks.some(({ checkId, details }) => checkId === "assertion.png-structure" && details.assertionId === "png-structure"));
});

test("deterministic pass means review eligibility only and opens no completion or reward path", () => {
  const closed = bundle();
  const result = evaluate(closed);
  assert.equal(result.decision, "pass");
  assert.equal(result.meaning, "eligible-for-independent-review");
  assert.equal(result.truthClaim, "none");
  assert.deepEqual(result.resultCodes, [PROOF_REASON_CODES.eligible]);
  const contract = { reviewContractId: "review_proof", taskId: closed.taskId, evidenceDigest: closed.bundleDigest, policyVersion: policy.policyVersion };
  const events = deterministicProofEventDrafts(result, contract);
  assert.deepEqual(events.map(({ type }) => type), ["DeterministicProofPassed", "ReviewOpened"]);
  assert.equal(events[0].payload.evidenceDigest, closed.bundleDigest);
  assert.equal(events[0].payload.policyVersion, policy.policyVersion);
  assert.deepEqual(events[0].payload.evaluatedBy, serviceActor);
  assert.equal(events[0].payload.evaluatedAt, result.evaluatedAt);
  assert.equal(events.some(({ type }) => /Completed|Settlement|Reward/.test(type)), false);
});
