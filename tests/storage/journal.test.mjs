import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { SqliteJournal } from "../../packages/storage-sqlite/src/index.mjs";
import { canonicalCommand, commitRequest, eventFor } from "./support.mjs";

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];
test.after(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); });

function temporaryDatabase(t, name) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cerbanimo-packet-002-"));
  temporaryDirectories.push(directory);
  return path.join(directory, name);
}

test("SQLite opens in WAL mode with foreign keys, bounded timeout, and forward-only migrations", (t) => {
  const journal = new SqliteJournal(temporaryDatabase(t, "configuration.sqlite"));
  t.after(() => journal.close());
  assert.deepEqual(journal.getPragmas(), { journalMode: "wal", foreignKeys: 1, busyTimeoutMs: 2500, synchronous: 2 });
  assert.deepEqual(journal.getMigrations().map(({ version, name }) => ({ version, name })), [
    { version: 1, name: "journal_commands_receipts" },
    { version: 2, name: "projections_checkpoints_outbox" },
  ]);
});

test("journal events and receipts are append-only with global and per-stream positions", (t) => {
  const journal = new SqliteJournal(temporaryDatabase(t, "append.sqlite"));
  t.after(() => journal.close());
  const command = canonicalCommand("EditTask", "task:append", 0, { taskId: "append", title: "Append", description: "Append-only.", proofRequirement: "Immutable event." });
  const event = eventFor(command, command.streamId, 1, "TaskEdited", command.payload);
  const request = commitRequest(command, [{ streamId: command.streamId, streamType: "task", expectedStreamVersion: 0 }], [{ streamId: command.streamId, events: [event] }]);
  const result = journal.commit(request);
  assert.equal(result.eventPositions[0].globalPosition, 1);
  assert.equal(journal.loadStream(command.streamId).version, 1);
  assert.equal(journal.readAll()[0].event.eventId, event.eventId);
  assert.throws(() => journal.db.prepare("UPDATE events SET event_type = 'tampered' WHERE event_id = ?").run(event.eventId), /immutable/);
  assert.throws(() => journal.db.prepare("DELETE FROM receipts WHERE receipt_id = ?").run(request.receipt.receiptId), /immutable/);
  assert.deepEqual(journal.verifyIntegrity(), { ok: true, errors: [], hashSemantics: "corruption-detection-only" });
});

test("multi-stream finalization commits every stream and projection or none", (t) => {
  const journal = new SqliteJournal(temporaryDatabase(t, "atomic.sqlite"));
  t.after(() => journal.close());
  const command = canonicalCommand("FinalizeCompletedTask", "task:finished", 0, { taskId: "finished" });
  const taskEvent = eventFor(command, "task:finished", 1, "TaskCompleted", { taskId: "finished", completedAt: command.issuedAt, settlementId: "settlement_atomic" }, "task");
  const projectEvent = eventFor(command, "project:atomic", 1, "ProjectTaskCompleted", { projectId: "atomic", taskId: "finished", taskStreamId: "task:finished", completedAt: command.issuedAt }, "project");
  const dependentEvent = eventFor(command, "task:dependent", 1, "TaskDependencyActivated", { taskId: "dependent", completedDependencyId: "finished" }, "dependent");
  const request = commitRequest(
    command,
    [
      { streamId: "task:finished", streamType: "task", expectedStreamVersion: 0 },
      { streamId: "project:atomic", streamType: "project", expectedStreamVersion: 0 },
      { streamId: "task:dependent", streamType: "task", expectedStreamVersion: 0 },
    ],
    [
      { streamId: "task:finished", events: [taskEvent] },
      { streamId: "project:atomic", events: [projectEvent] },
      { streamId: "task:dependent", events: [dependentEvent] },
    ],
    { projectionWrites: [{ projectionName: "canonical", projectionKey: "task:finished", state: { streamId: "task:finished", version: 1, status: "completed" } }] },
  );
  assert.throws(() => journal.commit(request, "before-commit"), (error) => error.code === "INJECTED_CRASH");
  assert.equal(journal.readAll().length, 0);
  assert.equal(journal.loadStream("task:finished").version, 0);
  assert.equal(journal.loadStream("project:atomic").version, 0);
  assert.equal(journal.loadStream("task:dependent").version, 0);
  assert.equal(journal.getProjection("canonical", "task:finished"), null);
  const committed = journal.commit(request);
  assert.equal(committed.eventPositions.length, 3);
  assert.equal(journal.loadStream("task:finished").version, 1);
  assert.equal(journal.loadStream("project:atomic").version, 1);
  assert.equal(journal.loadStream("task:dependent").version, 1);
  assert.equal(journal.getProjection("canonical", "task:finished").state.status, "completed");
});

test("crash after commit returns the original immutable receipt on retry", (t) => {
  const journal = new SqliteJournal(temporaryDatabase(t, "crash-retry.sqlite"));
  t.after(() => journal.close());
  const command = canonicalCommand("EditProject", "project:crash", 0, { projectId: "crash", title: "Committed", description: "Response was lost." });
  const event = eventFor(command, command.streamId, 1, "ProjectEdited", command.payload);
  const request = commitRequest(command, [{ streamId: command.streamId, streamType: "project", expectedStreamVersion: 0 }], [{ streamId: command.streamId, events: [event] }]);
  assert.throws(() => journal.commit(request, "after-commit"), (error) => error.code === "INJECTED_CRASH_AFTER_COMMIT");
  assert.equal(journal.loadStream(command.streamId).version, 1);
  const retry = journal.commit(request);
  assert.equal(retry.replayed, true);
  assert.equal(retry.receipt.receiptId, request.receipt.receiptId);
  assert.equal(retry.receipt.replayed, true);
  assert.equal(journal.readAll().length, 1);
});

async function runCompetingWriters(databasePath, mode) {
  const fixture = path.resolve("tests/storage/fixtures/concurrent-writer.mjs");
  const startAt = Date.now() + 400;
  const options = { cwd: path.resolve("."), env: { ...process.env, NODE_NO_WARNINGS: "1" } };
  const [left, right] = await Promise.all([
    execFileAsync(process.execPath, [fixture, databasePath, "left", mode, String(startAt)], options),
    execFileAsync(process.execPath, [fixture, databasePath, "right", mode, String(startAt)], options),
  ]);
  return [JSON.parse(left.stdout), JSON.parse(right.stdout)];
}

test("competing WAL writers cannot violate an expected stream version", async (t) => {
  const databasePath = temporaryDatabase(t, "concurrent.sqlite");
  new SqliteJournal(databasePath).close();
  const results = await runCompetingWriters(databasePath, "version");
  assert.equal(results.filter(({ status }) => status === "committed").length, 1);
  assert.deepEqual(results.filter(({ status }) => status === "rejected").map(({ code }) => code), ["STALE_STREAM_VERSION"]);
  const journal = new SqliteJournal(databasePath);
  t.after(() => journal.close());
  assert.equal(journal.loadStream("task:concurrent").version, 1);
  assert.equal(journal.readAll().length, 1);
});

test("settlement races across streams release one deterministic settlement exactly once", async (t) => {
  const databasePath = temporaryDatabase(t, "settlement-race.sqlite");
  new SqliteJournal(databasePath).close();
  const results = await runCompetingWriters(databasePath, "settlement");
  assert.equal(results.filter(({ status }) => status === "committed").length, 1);
  assert.deepEqual(results.filter(({ status }) => status === "rejected").map(({ code }) => code), ["SETTLEMENT_ALREADY_COMMITTED"]);
  const journal = new SqliteJournal(databasePath);
  t.after(() => journal.close());
  assert.equal(journal.readAll().filter(({ event }) => event.type === "SettlementCommitted").length, 1);
  assert.equal(Number(journal.db.prepare("SELECT COUNT(*) AS count FROM settlement_uniqueness").get().count), 1);
});
