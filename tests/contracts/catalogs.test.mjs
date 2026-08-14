import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { COMMAND_CATALOG } from "../../.build/packages/commands/src/index.js";
import { EVENT_CATALOG } from "../../.build/packages/events/src/index.js";
import { COMMAND_TYPES, CONTRACT_SCHEMAS, EVENT_TYPES, SCHEMA_VERSIONS } from "../../.build/packages/schemas/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("schema versions are explicit and independently namespaced", () => {
  assert.deepEqual(SCHEMA_VERSIONS, {
    catalog: "cerbanimo.contracts/1.0.0",
    command: "cerbanimo.command/1.0.0",
    event: "cerbanimo.event/1.0.0",
    project: "cerbanimo.project/1.0.0",
    task: "cerbanimo.task/1.0.0",
    evidence: "cerbanimo.evidence/1.0.0",
    review: "cerbanimo.review/1.0.0",
    settlement: "cerbanimo.settlement/1.0.0",
    passport: "cerbanimo.passport/1.0.0",
    passportPresentation: "cerbanimo.passport-presentation/1.0.0",
    proposal: "cerbanimo.proposal/1.0.0",
    semanticDiff: "cerbanimo.semantic-diff/1.0.0",
    receipt: "cerbanimo.receipt/1.0.0",
  });
});

test("command and event catalogs exactly cover the schema catalogs", () => {
  assert.equal(COMMAND_TYPES.length, 39);
  assert.equal(EVENT_TYPES.length, 49);
  assert.deepEqual(Object.keys(COMMAND_CATALOG), [...COMMAND_TYPES]);
  assert.deepEqual(Object.keys(EVENT_CATALOG), [...EVENT_TYPES]);
});

test("every canonical command schema requires all authority and concurrency metadata", () => {
  const required = [
    "schemaVersion",
    "commandId",
    "type",
    "streamId",
    "expectedStreamVersion",
    "actor",
    "idempotencyKey",
    "correlationId",
    "causationId",
    "issuedAt",
    "payload",
  ];
  const variants = CONTRACT_SCHEMAS.$defs.CommandEnvelope.oneOf;
  assert.equal(variants.length, COMMAND_TYPES.length);
  for (const variant of variants) {
    assert.deepEqual(variant.required, required);
    assert.equal(variant.additionalProperties, false);
    assert.equal(variant.properties.actor.oneOf.length, 2);
    assert.ok(!JSON.stringify(variant.properties.actor).includes('"model"'));
  }
});

test("every event schema retains actor, command, causation, correlation, and idempotency", () => {
  const requiredMetadata = ["actor", "commandId", "idempotencyKey", "correlationId", "causationId"];
  const variants = CONTRACT_SCHEMAS.$defs.EventEnvelope.oneOf;
  assert.equal(variants.length, EVENT_TYPES.length);
  for (const variant of variants) {
    for (const field of requiredMetadata) assert.ok(variant.required.includes(field), `${variant.properties.type.const} lacks ${field}`);
    assert.equal(variant.additionalProperties, false);
    assert.ok(variant.properties.payload.required.length > 0, `${variant.properties.type.const} lacks a specific payload contract`);
    assert.equal(variant.properties.payload.additionalProperties, false);
  }
});

test("generated JSON Schema is byte-semantically equal to the compiled source catalog", async () => {
  const generated = JSON.parse(await readFile(path.join(root, "packages/schemas/generated/cerbanimo-contracts-1.0.0.schema.json"), "utf8"));
  assert.deepEqual(generated, CONTRACT_SCHEMAS);
});

test("aggregate, passport presentation, proposal, and receipt schemas are explicit", () => {
  const definitions = CONTRACT_SCHEMAS.$defs;
  for (const name of [
    "ProjectAggregate",
    "TaskAggregate",
    "EvidenceCycle",
    "ReviewContractState",
    "SettlementIntent",
    "SettlementRecord",
    "PassportAggregate",
    "PassportPresentation",
    "FormalProposal",
    "ProposalAggregate",
    "CommandReceipt",
  ]) assert.ok(definitions[name], `missing schema definition ${name}`);
  assert.equal("tasks" in definitions.ProjectAggregate.properties, false);
  assert.equal(definitions.TaskAggregate.properties.aggregateType.const, "task");
  assert.deepEqual(definitions.PassportPresentation.properties.identityMode.enum, ["pairwise", "stable-root"]);
  assert.ok(definitions.CommandReceipt.required.includes("requiresRepreview"));
  assert.deepEqual(definitions.CommandReceipt.properties.status.enum, ["executed", "cancelled", "not-executed"]);
});

test("amended event schemas include cross-stream and rejection-stage fields", () => {
  assert.deepEqual(CONTRACT_SCHEMAS.$defs.TaskAddedEvent.properties.payload.required, ["task", "node"]);
  assert.ok(CONTRACT_SCHEMAS.$defs.ReviewRejectedEvent.properties.payload.required.includes("rejectionStage"));
  assert.equal(CONTRACT_SCHEMAS.$defs.DeterministicProofRejectedEvent.properties.payload.properties.rejectionStage.const, "deterministic");
  assert.ok(CONTRACT_SCHEMAS.$defs.DeterministicProofPassedEvent.properties.payload.required.includes("resultCodes"));
});

test("Packet 001 core remains pure while Packet 002 adds only its authorized boundaries", async () => {
  const packages = (await readdir(path.join(root, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
  assert.deepEqual(packages, ["commands", "domain", "events", "evidence-store", "proof", "review", "schemas", "secret-vault", "storage-sqlite"]);
  const forbiddenImports = /node:(fs|http|https|net|sqlite)|from\s+["'](?:express|react|next|drizzle|pg|better-sqlite3)/;
  for (const packageName of ["commands", "domain", "events", "schemas"]) {
    const sourceDirectory = path.join(root, "packages", packageName, "src");
    for (const entry of await readdir(sourceDirectory)) {
      if (!entry.endsWith(".ts")) continue;
      const source = await readFile(path.join(sourceDirectory, entry), "utf8");
      assert.doesNotMatch(source, forbiddenImports, `${packageName}/${entry} imports a forbidden Packet 001 dependency`);
    }
  }
});
