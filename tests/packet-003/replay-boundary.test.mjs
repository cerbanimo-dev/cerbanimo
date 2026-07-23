import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EncryptedEvidenceStore } from "../../packages/evidence-store/src/index.mjs";
import {
  closeEvidenceBundle,
  createEvidenceDraft,
  createProofPolicy,
  deterministicProofEventDrafts,
  evaluateDeterministicProof,
  replayEvidenceState,
} from "../../packages/proof/src/index.mjs";
import {
  commitAssignmentSeed,
  createReviewContract,
  createReviewPacket,
  openReviewState,
  recordReviewAttestation,
  replayReviewState,
  snapshotEligibleReviewerPool,
} from "../../packages/review/src/index.mjs";
import { SqliteJournal } from "../../packages/storage-sqlite/src/index.mjs";
import { canonicalCommand, commitRequest } from "../storage/support.mjs";
import { candidate, captureActor, disclosure, purgeActor, retention, serviceActor, signedAttestation } from "./support.mjs";

const temporaryDirectories = [];
test.after(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); });
function workspace() { const directory = mkdtempSync(path.join(os.tmpdir(), "cerbanimo-packet-003-replay-")); temporaryDirectories.push(directory); return directory; }

function eventEnvelope(command, streamVersion, draft) {
  return {
    schemaVersion: "cerbanimo.event/1.1.0",
    eventId: `evt_packet003_${String(streamVersion).padStart(2, "0")}`,
    type: draft.type,
    streamId: command.streamId,
    streamVersion,
    occurredAt: command.issuedAt,
    actor: command.actor,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    correlationId: command.correlationId,
    causationId: command.causationId,
    payload: draft.payload,
  };
}

test("journal replay reproduces evidence and review state without artifact bytes", (t) => {
  const directory = workspace();
  const evidenceStore = new EncryptedEvidenceStore(path.join(directory, "evidence"), randomBytes(32));
  t.after(() => evidenceStore.close());
  const secretArtifactBytes = Buffer.from("SECRET-ARTIFACT-BYTES-NEVER-IN-JOURNAL");
  const stored = evidenceStore.putArtifact({
    custodyId: "custody_replay", artifactId: "artifact_replay", artifactKind: "screenshot", ownerIdentityId: "root_author",
    bytes: secretArtifactBytes, mediaType: "image/png", privacyClassification: "restricted", retentionPolicy: retention(),
    disclosureScope: disclosure(), publicMetadata: { description: "Public manifest metadata only." }, requirementIds: ["req_done"],
    capturedAt: "2026-07-22T15:00:00.000Z", capturedBy: captureActor, captureKind: "local-upload", sourceUri: null,
  });
  const draft = createEvidenceDraft({
    taskId: "task_replay", submissionId: "submission_replay", authorIdentityId: "root_author", evidenceCycleId: "cycle_replay_1",
    narrative: "Replay this canonical state without the artifact secret.", artifacts: [stored.manifest], remoteReferences: [],
    requirementCoverage: [{ requirementId: "req_done", artifactIds: ["artifact_replay"], declaration: "Captured artifact covers the requirement." }],
    narrativeDisclosureScope: disclosure(), updatedAt: "2026-07-22T15:01:00.000Z",
  });
  const bundle = closeEvidenceBundle({ draft, evidencePolicyVersion: "proof_replay_v1", closureActor: captureActor, closedAt: "2026-07-22T15:02:00.000Z" });
  const policy = createProofPolicy({ policyVersion: "proof_replay_v1", requiredArtifactKinds: ["screenshot"], allowedMediaTypes: ["image/png"], maxArtifactBytes: 1024, maxTotalBytes: 1024, requiredRequirementIds: ["req_done"], explicitNonCompletionPhrases: ["not complete"], machineAssertionIds: [] });
  const proofResult = evaluateDeterministicProof({ bundle, policy, actor: serviceActor, evaluatedAt: "2026-07-22T15:03:00.000Z" });
  assert.equal(proofResult.decision, "pass");

  const reviewer = candidate("reviewer_replay", bundle.bundleDigest, { reviewerKind: "human" });
  const pool = snapshotEligibleReviewerPool({ candidates: [reviewer.candidate], taskId: bundle.taskId, submissionId: bundle.submissionId, evidenceDigest: bundle.bundleDigest, policyVersion: bundle.evidencePolicyVersion, authorIdentityId: bundle.authorIdentityId, taskOwnerIdentityId: null, excludeTaskOwner: false, snapshotAt: "2026-07-22T15:04:00.000Z" });
  const seed = commitAssignmentSeed();
  const contract = createReviewContract({ reviewContractId: "review_replay", poolSnapshot: pool, seedCommitment: seed.commitment, revealedSeed: seed.seed, assignmentCount: 1, quorum: 1, maxReassignments: 0, assignedAt: "2026-07-22T15:05:00.000Z", expiresAt: "2026-07-22T16:00:00.000Z" });
  const proofEvents = deterministicProofEventDrafts(proofResult, contract);
  const reviewPacket = createReviewPacket({ bundle, contract, assignmentId: contract.assignments[0].assignmentId, audience: "review-node", purpose: "independent-review", issuedAt: "2026-07-22T15:06:00.000Z" });
  const attestation = signedAttestation(contract, contract.assignments[0], reviewer.privateKey, "approve", "2026-07-22T15:07:00.000Z");
  const recorded = recordReviewAttestation(openReviewState(contract), attestation, { reviewPacket });
  assert.equal(recorded.state.status, "approved");

  const purged = evidenceStore.purgeCustody({ custodyId: "custody_replay", actor: purgeActor, purgedAt: "2026-07-24T00:00:00.000Z", reason: "Authorized retention expiry." });
  const drafts = [
    { type: "EvidenceClosed", payload: { taskId: bundle.taskId, evidenceCycleId: bundle.evidenceCycleId, bundle } },
    ...proofEvents,
    ...recorded.events,
    purged.event,
  ];
  const command = canonicalCommand("CloseEvidence", "task:replay-packet003", 0, { taskId: bundle.taskId, submissionId: bundle.submissionId, expectedBundleDigest: bundle.bundleDigest });
  const events = drafts.map((draftEvent, index) => eventEnvelope(command, index + 1, draftEvent));
  const journal = new SqliteJournal(path.join(directory, "canonical-journal.sqlite"));
  t.after(() => journal.close());
  journal.commit(commitRequest(command, [{ streamId: command.streamId, streamType: "task", expectedStreamVersion: 0 }], [{ streamId: command.streamId, events }]));
  const exported = journal.exportCanonicalData();
  assert.equal(exported.includes(secretArtifactBytes.toString()), false);
  assert.equal(exported.includes("privateKey"), false);
  const replayEvents = journal.readAll().map(({ event }) => event);
  const evidenceState = replayEvidenceState(replayEvents);
  const reviewState = replayReviewState(replayEvents);
  assert.equal(evidenceState.bundle.bundleDigest, bundle.bundleDigest);
  assert.equal(evidenceState.deterministicResult.decision, "pass");
  assert.equal(evidenceState.artifactTombstones[0].reviewability, "not-reviewable-through-this-custody");
  assert.equal(reviewState.status, "approved");
  assert.equal(reviewState.attestations[0].attestationId, attestation.attestationId);
  assert.throws(() => evidenceStore.readArtifact("custody_replay", { audience: "review-node", purpose: "independent-review", reviewerIdentityId: "reviewer_replay" }), (error) => error.code === "ARTIFACT_PURGED");
});
