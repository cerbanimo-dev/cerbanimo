import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { LocalSecretVault } from "../../packages/secret-vault/src/index.mjs";
import { SqliteJournal } from "../../packages/storage-sqlite/src/index.mjs";
import { canonicalCommand, commitRequest, eventFor, receiptFor } from "./support.mjs";

const temporaryDirectories = [];
test.after(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); });

function workspace(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cerbanimo-vault-"));
  temporaryDirectories.push(directory);
  return directory;
}

test("stale proposal execution durably records only its idempotent zero-event receipt", (t) => {
  const journal = new SqliteJournal(path.join(workspace(t), "proposal.sqlite"));
  t.after(() => journal.close());
  const command = canonicalCommand("ConfirmAndExecuteProposal", "proposal:stale", 1, {
    proposalId: "proposal_stale",
    proposalDigest: "a".repeat(64),
    semanticDiffDigest: "b".repeat(64),
    confirmedStreamExpectations: [{ streamId: "project:target", expectedStreamVersion: 4 }],
  });
  const { fingerprint, receipt } = receiptFor(command, [], { status: "not-executed", reasonCode: "STALE_STREAM_VERSION", requiresRepreview: true, proposalId: "proposal_stale" });
  const request = { command, commandFingerprint: fingerprint, expectedStreams: [], eventBatches: [], receipt, projectionWrites: [], outboxMessages: [] };
  const committed = journal.commit(request);
  assert.equal(committed.replayed, false);
  assert.equal(journal.readAll().length, 0);
  assert.equal(Number(journal.db.prepare("SELECT COUNT(*) AS count FROM commands").get().count), 1);
  assert.equal(Number(journal.db.prepare("SELECT COUNT(*) AS count FROM receipts").get().count), 1);
  const retry = journal.commit(request);
  assert.equal(retry.replayed, true);
  assert.equal(retry.receipt.receiptId, receipt.receiptId);
  assert.equal(retry.receipt.status, "not-executed");
  assert.equal(retry.receipt.requiresRepreview, true);
});

test("encrypted local vault is physically and logically separate from canonical storage", (t) => {
  const directory = workspace(t);
  const journalPath = path.join(directory, "journal.sqlite");
  const vaultPath = path.join(directory, "vault.sqlite");
  const journal = new SqliteJournal(journalPath);
  t.after(() => journal.close());
  const firstKey = randomBytes(32);
  const secondKey = randomBytes(32);
  const secret = "cerbanimo-root-private-material-never-export";
  let vault = new LocalSecretVault(vaultPath, firstKey);
  vault.putSecret({ secretId: "root_signing_key", kind: "ed25519-private-key", plaintext: secret, metadata: { keyId: "root_public_1", purpose: "local-signing" }, now: "2026-07-23T02:00:00.000Z" });
  assert.equal(vault.getSecret("root_signing_key").plaintext.toString("utf8"), secret);
  assert.deepEqual(vault.listMetadata()[0].metadata, { keyId: "root_public_1", purpose: "local-signing" });
  vault.rotateKey(secondKey, "2026-07-23T02:01:00.000Z");
  assert.equal(vault.getSecret("root_signing_key").plaintext.toString("utf8"), secret);
  vault.close();
  const rawVault = readFileSync(vaultPath);
  assert.equal(rawVault.includes(Buffer.from(secret, "utf8")), false);
  vault = new LocalSecretVault(vaultPath, secondKey);
  t.after(() => vault.close());
  assert.equal(vault.getSecret("root_signing_key").plaintext.toString("utf8"), secret);

  const journalTables = journal.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(({ name }) => name);
  const vaultTables = vault.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(({ name }) => name);
  assert.equal(journalTables.includes("vault_secrets"), false);
  assert.equal(vaultTables.includes("events"), false);

  const unsafeCommand = canonicalCommand("IssueClaim", "passport:secret", 0, { claimId: "unsafe" });
  const unsafeEvent = eventFor(unsafeCommand, unsafeCommand.streamId, 1, "ClaimIssued", { claim: { privateKey: secret } });
  const unsafeRequest = commitRequest(unsafeCommand, [{ streamId: unsafeCommand.streamId, streamType: "passport", expectedStreamVersion: 0 }], [{ streamId: unsafeCommand.streamId, events: [unsafeEvent] }]);
  assert.throws(() => journal.commit(unsafeRequest), (error) => error.code === "SECRET_BOUNDARY_VIOLATION");

  const receiptCommand = canonicalCommand("EditProject", "project:secret-receipt", 0, { projectId: "safe", title: "Safe", description: "Safe." });
  const receiptEvent = eventFor(receiptCommand, receiptCommand.streamId, 1, "ProjectEdited", receiptCommand.payload);
  const unsafeReceipt = commitRequest(receiptCommand, [{ streamId: receiptCommand.streamId, streamType: "project", expectedStreamVersion: 0 }], [{ streamId: receiptCommand.streamId, events: [receiptEvent] }]);
  unsafeReceipt.receipt.apiKey = secret;
  assert.throws(() => journal.commit(unsafeReceipt), (error) => error.code === "SECRET_BOUNDARY_VIOLATION");

  const projectionCommand = canonicalCommand("EditProject", "project:secret-projection", 0, { projectId: "safe", title: "Safe", description: "Safe." });
  const projectionEvent = eventFor(projectionCommand, projectionCommand.streamId, 1, "ProjectEdited", projectionCommand.payload);
  const unsafeProjection = commitRequest(projectionCommand, [{ streamId: projectionCommand.streamId, streamType: "project", expectedStreamVersion: 0 }], [{ streamId: projectionCommand.streamId, events: [projectionEvent] }], { projectionWrites: [{ projectionName: "unsafe", projectionKey: "unsafe", state: { mnemonic: secret } }] });
  assert.throws(() => journal.commit(unsafeProjection), (error) => error.code === "SECRET_BOUNDARY_VIOLATION");

  const outboxCommand = canonicalCommand("FinalizeCompletedTask", "task:secret-outbox", 0, { taskId: "safe" });
  const outboxEvent = eventFor(outboxCommand, outboxCommand.streamId, 1, "TaskCompleted", { taskId: "safe", completedAt: outboxCommand.issuedAt, settlementId: "settlement_safe" });
  const unsafeOutbox = commitRequest(outboxCommand, [{ streamId: outboxCommand.streamId, streamType: "task", expectedStreamVersion: 0 }], [{ streamId: outboxCommand.streamId, events: [outboxEvent] }], { outboxMessages: [{ outboxId: "outbox_unsafe", eventId: outboxEvent.eventId, topic: "task.completed", payload: { accessToken: secret }, createdAt: outboxCommand.issuedAt }] });
  assert.throws(() => journal.commit(unsafeOutbox), (error) => error.code === "SECRET_BOUNDARY_VIOLATION");

  const safeCommand = canonicalCommand("EditProject", "project:safe-export", 0, { projectId: "safe-export", title: "Safe export", description: "Contains public state only." });
  const safeEvent = eventFor(safeCommand, safeCommand.streamId, 1, "ProjectEdited", safeCommand.payload);
  const observedLogs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...values) => observedLogs.push(values);
  console.warn = (...values) => observedLogs.push(values);
  console.error = (...values) => observedLogs.push(values);
  try {
    journal.commit(commitRequest(safeCommand, [{ streamId: safeCommand.streamId, streamType: "project", expectedStreamVersion: 0 }], [{ streamId: safeCommand.streamId, events: [safeEvent] }]));
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.deepEqual(observedLogs, []);
  assert.equal(journal.readAll().length, 1);
  assert.doesNotMatch(journal.exportCanonicalData(), /private-material|privateKey|ciphertext|mnemonic|seedPhrase|accessToken|apiKey/);
});

test("migration checksums are forward-only and hashes detect corruption without claiming authenticity", (t) => {
  const databasePath = path.join(workspace(t), "integrity.sqlite");
  let journal = new SqliteJournal(databasePath);
  const command = canonicalCommand("EditProject", "project:integrity", 0, { projectId: "integrity", title: "Integrity", description: "Detect corruption." });
  const event = eventFor(command, command.streamId, 1, "ProjectEdited", command.payload);
  journal.commit(commitRequest(command, [{ streamId: command.streamId, streamType: "project", expectedStreamVersion: 0 }], [{ streamId: command.streamId, events: [event] }]));
  journal.db.exec("BEGIN IMMEDIATE; DROP TRIGGER events_immutable_update; DROP TRIGGER receipts_immutable_update; UPDATE events SET event_json = replace(event_json, 'Integrity', 'Corrupted') WHERE event_id = '" + event.eventId + "'; UPDATE receipts SET receipt_json = replace(receipt_json, 'executed', 'cancelled') WHERE command_id = '" + command.commandId + "'; COMMIT");
  const integrity = journal.verifyIntegrity();
  assert.equal(integrity.ok, false);
  assert.equal(integrity.hashSemantics, "corruption-detection-only");
  assert.ok(integrity.errors.some(({ kind }) => kind === "event"));
  assert.ok(integrity.errors.some(({ kind }) => kind === "receipt"));
  journal.db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run("0".repeat(64));
  journal.close();
  assert.throws(() => { journal = new SqliteJournal(databasePath); }, (error) => error.code === "MIGRATION_CHECKSUM_MISMATCH");
});
