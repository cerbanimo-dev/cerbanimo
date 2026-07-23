import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PROOF_SCHEMAS } from "../../packages/proof/src/index.mjs";
import { REVIEW_SCHEMAS } from "../../packages/review/src/index.mjs";

const root = path.resolve(".");

test("accepted 1.0.0 schema is byte-for-byte frozen", async () => {
  const generated = path.join(root, "packages/schemas/generated");
  const freeze = JSON.parse(await readFile(path.join(generated, "1.0.0.freeze.json"), "utf8"));
  const bytes = await readFile(path.join(generated, freeze.schema));
  assert.equal(bytes.byteLength, freeze.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), freeze.sha256);
  assert.equal(freeze.status, "accepted-immutable");
});

test("frozen Packet 003 schemas remain separately versioned and match their source catalogs", async () => {
  const proof = JSON.parse(await readFile(path.join(root, "packages/proof/generated/evidence-proof-1.1.0.schema.json"), "utf8"));
  const review = JSON.parse(await readFile(path.join(root, "packages/review/generated/independent-review-1.1.0.schema.json"), "utf8"));
  assert.deepEqual(proof, PROOF_SCHEMAS);
  assert.deepEqual(review, REVIEW_SCHEMAS);
  assert.equal(proof.$defs.EvidenceBundle.properties.schemaVersion.const, "cerbanimo.evidence/1.1.0");
  assert.deepEqual(review.$defs.ReviewAttestation.properties.decision.enum, ["approve", "reject", "abstain"]);
});

test("Packet 003 adds only proof, review, and evidence-store package boundaries", async () => {
  const packages = (await readdir(path.join(root, "packages"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
  assert.deepEqual(packages, ["commands", "domain", "events", "evidence-store", "proof", "review", "schemas", "secret-vault", "storage-sqlite"]);
  for (const packageName of ["proof", "review"]) {
    const files = await readdir(path.join(root, "packages", packageName, "src"));
    for (const file of files) {
      const source = await readFile(path.join(root, "packages", packageName, "src", file), "utf8");
      assert.doesNotMatch(source, /node:(?:fs|http|https|net|sqlite)|\b(?:openai|anthropic|postgres|express|react)\b/i);
    }
  }
});
