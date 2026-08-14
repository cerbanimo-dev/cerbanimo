import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureThroughConstrainedFetch, EncryptedEvidenceStore } from "../../packages/evidence-store/src/index.mjs";
import { closeEvidenceBundle, createEvidenceDraft, verifyEvidenceBundle } from "../../packages/proof/src/index.mjs";
import { captureActor, disclosure, purgeActor, retention } from "./support.mjs";

const temporaryDirectories = [];
test.after(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); });

function workspace() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cerbanimo-packet-003-evidence-"));
  temporaryDirectories.push(directory);
  return directory;
}

function artifactInput(bytes, overrides = {}) {
  return {
    custodyId: overrides.custodyId ?? "custody_primary",
    artifactId: overrides.artifactId ?? "artifact_primary",
    artifactKind: overrides.artifactKind ?? "screenshot",
    ownerIdentityId: overrides.ownerIdentityId ?? "root_author",
    bytes,
    mediaType: overrides.mediaType ?? "image/png",
    privacyClassification: overrides.privacyClassification ?? "private",
    retentionPolicy: overrides.retentionPolicy ?? retention(),
    disclosureScope: overrides.disclosureScope ?? disclosure({ reviewerIdentityIds: ["reviewer_alpha"] }),
    publicMetadata: overrides.publicMetadata ?? { captureTool: "local-test" },
    requirementIds: overrides.requirementIds ?? ["req_done"],
    capturedAt: overrides.capturedAt ?? "2026-07-22T10:00:00.000Z",
    capturedBy: captureActor,
    captureKind: overrides.captureKind ?? "local-upload",
    sourceUri: overrides.sourceUri ?? null,
  };
}

test("one-byte evidence changes the digest and a closed canonical bundle cannot mutate", (t) => {
  const store = new EncryptedEvidenceStore(workspace(), randomBytes(32));
  t.after(() => store.close());
  const first = store.putArtifact(artifactInput(Buffer.from("immutable-evidence-A")));
  const second = store.putArtifact(artifactInput(Buffer.from("immutable-evidence-B"), { custodyId: "custody_changed", artifactId: "artifact_changed" }));
  assert.notEqual(first.manifest.contentDigest, second.manifest.contentDigest);
  const base = {
    taskId: "task_evidence", submissionId: "submission_evidence", authorIdentityId: "root_author", evidenceCycleId: "cycle_1",
    narrative: "Completed the requested work.\r\nEvidence is attached.   ", remoteReferences: [],
    requirementCoverage: [{ requirementId: "req_done", artifactIds: ["artifact_primary"], declaration: "The screenshot covers completion." }],
    narrativeDisclosureScope: disclosure(), updatedAt: "2026-07-22T10:01:00.000Z",
  };
  const bundle = closeEvidenceBundle({ draft: createEvidenceDraft({ ...base, artifacts: [first.manifest] }), evidencePolicyVersion: "proof_policy_v1", closureActor: captureActor, closedAt: "2026-07-22T10:02:00.000Z" });
  const changedBundle = closeEvidenceBundle({ draft: createEvidenceDraft({ ...base, artifacts: [{ ...second.manifest, artifactId: "artifact_primary" }], requirementCoverage: base.requirementCoverage }), evidencePolicyVersion: "proof_policy_v1", closureActor: captureActor, closedAt: "2026-07-22T10:02:00.000Z" });
  assert.notEqual(bundle.bundleDigest, changedBundle.bundleDigest);
  assert.equal(bundle.normalizedNarrative, "Completed the requested work.\nEvidence is attached.");
  assert.equal(verifyEvidenceBundle(bundle).valid, true);
  assert.throws(() => { bundle.normalizedNarrative = "tampered"; }, TypeError);
  const tampered = structuredClone(bundle);
  tampered.normalizedNarrative = "tampered";
  assert.deepEqual(verifyEvidenceBundle(tampered).code, "BUNDLE_DIGEST_MISMATCH");
  assert.equal(bundle.normalizedNarrative, "Completed the requested work.\nEvidence is attached.");
});

test("content deduplication preserves separate ownership and disclosure permissions", (t) => {
  const directory = workspace();
  const plaintext = Buffer.from("same-preserved-bytes-with-separate-custody");
  const store = new EncryptedEvidenceStore(directory, randomBytes(32));
  t.after(() => store.close());
  const alpha = store.putArtifact(artifactInput(plaintext, { custodyId: "custody_alpha", artifactId: "artifact_alpha", ownerIdentityId: "owner_alpha", disclosureScope: disclosure({ reviewerIdentityIds: ["reviewer_alpha"] }) }));
  const beta = store.putArtifact(artifactInput(plaintext, { custodyId: "custody_beta", artifactId: "artifact_beta", ownerIdentityId: "owner_beta", disclosureScope: disclosure({ reviewerIdentityIds: ["reviewer_beta"] }) }));
  assert.equal(alpha.deduplicated, false);
  assert.equal(beta.deduplicated, true);
  assert.equal(Number(store.db.prepare("SELECT COUNT(*) AS count FROM artifacts").get().count), 1);
  assert.equal(Number(store.db.prepare("SELECT COUNT(*) AS count FROM custodies").get().count), 2);
  assert.equal(store.getCustody("custody_alpha").ownerIdentityId, "owner_alpha");
  assert.equal(store.getCustody("custody_beta").ownerIdentityId, "owner_beta");
  assert.throws(() => store.readArtifact("custody_alpha", { audience: "review-node", purpose: "independent-review", reviewerIdentityId: "reviewer_beta" }), (error) => error.code === "DISCLOSURE_NOT_AUTHORIZED");
  assert.equal(store.readArtifact("custody_beta", { audience: "review-node", purpose: "independent-review", reviewerIdentityId: "reviewer_beta" }).toString(), plaintext.toString());
  const artifact = store.db.prepare("SELECT blob_path FROM artifacts").get();
  assert.equal(readFileSync(path.join(directory, artifact.blob_path)).includes(plaintext), false);
});

test("authorized cryptographic erasure preserves honest immutable tombstones", (t) => {
  const directory = workspace();
  const store = new EncryptedEvidenceStore(directory, randomBytes(32));
  t.after(() => store.close());
  const bytes = Buffer.from("erasable-but-deduplicated-content");
  store.putArtifact(artifactInput(bytes, { custodyId: "custody_purge_alpha", ownerIdentityId: "owner_alpha", disclosureScope: disclosure({ reviewerIdentityIds: ["reviewer_alpha"] }) }));
  store.putArtifact(artifactInput(bytes, { custodyId: "custody_purge_beta", artifactId: "artifact_beta", ownerIdentityId: "owner_beta", disclosureScope: disclosure({ reviewerIdentityIds: ["reviewer_beta"] }) }));
  assert.throws(() => store.purgeCustody({ custodyId: "custody_purge_alpha", actor: { ...purgeActor, roles: ["ordinary-user"] }, purgedAt: "2026-07-24T00:00:00.000Z", reason: "unauthorized" }), (error) => error.code === "PURGE_NOT_AUTHORIZED");
  const first = store.purgeCustody({ custodyId: "custody_purge_alpha", actor: purgeActor, purgedAt: "2026-07-24T00:00:00.000Z", reason: "Retention request approved." });
  assert.equal(first.tombstone.contentStatus, "cryptographically-erased");
  assert.equal(first.tombstone.reviewability, "not-reviewable-through-this-custody");
  assert.equal(first.tombstone.recoverableForOtherCustodies, true);
  assert.throws(() => store.readArtifact("custody_purge_alpha", { audience: "review-node", purpose: "independent-review", reviewerIdentityId: "reviewer_alpha" }), (error) => error.code === "ARTIFACT_PURGED");
  assert.equal(store.readArtifact("custody_purge_beta", { audience: "review-node", purpose: "independent-review", reviewerIdentityId: "reviewer_beta" }).toString(), bytes.toString());
  const blobPath = path.join(directory, store.db.prepare("SELECT blob_path FROM artifacts").get().blob_path);
  const second = store.purgeCustody({ custodyId: "custody_purge_beta", actor: purgeActor, purgedAt: "2026-07-24T00:01:00.000Z", reason: "Retention request approved." });
  assert.equal(second.tombstone.recoverableForOtherCustodies, false);
  assert.equal(existsSync(blobPath), false);
  assert.equal(Number(store.db.prepare("SELECT recoverable FROM artifacts").get().recoverable), 0);
  assert.throws(() => store.db.prepare("DELETE FROM purge_tombstones").run(), /immutable/);
});

test("remote capture is constrained to explicit HTTPS hosts, media types, and byte limits", async (t) => {
  const store = new EncryptedEvidenceStore(workspace(), randomBytes(32));
  t.after(() => store.close());
  let received;
  const fetched = await captureThroughConstrainedFetch(store, {
    url: "https://evidence.example/proof.png", allowedHosts: ["evidence.example"], allowedMediaTypes: ["image/png"], maxBytes: 128,
    fetcher: async (request) => { received = request; return { bytes: Buffer.from("captured-remote-bytes"), mediaType: "image/png", capturedAt: "2026-07-22T11:00:00.000Z" }; },
    custody: artifactInput(Buffer.alloc(0), { custodyId: "custody_remote", artifactId: "artifact_remote", captureKind: "constrained-fetch", sourceUri: "https://evidence.example/proof.png" }),
  });
  assert.equal(received.url, "https://evidence.example/proof.png");
  assert.equal(fetched.manifest.capture.kind, "constrained-fetch");
  assert.equal(fetched.manifest.contentDigest.length, 64);
  await assert.rejects(captureThroughConstrainedFetch(store, {
    url: "https://127.0.0.1/secret", allowedHosts: ["127.0.0.1"], allowedMediaTypes: ["image/png"], maxBytes: 10,
    fetcher: async () => ({ bytes: Buffer.from("x"), mediaType: "image/png" }), custody: artifactInput(Buffer.alloc(0), { custodyId: "denied" }),
  }), (error) => error.code === "REMOTE_FETCH_NOT_ALLOWED");
});
