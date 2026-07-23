import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalize, SqliteJournal } from "../../packages/storage-sqlite/src/index.mjs";
import { canonicalCommand, commitRequest, eventFor } from "./support.mjs";

const temporaryDirectories = [];
test.after(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); });

function workspace(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cerbanimo-projection-"));
  temporaryDirectories.push(directory);
  return directory;
}

const projector = {
  keyFor(event) { return event.streamId.startsWith("task:") ? event.streamId : null; },
  initialState(key) { return { streamId: key, version: 0, status: null, eventTypes: [] }; },
  reduce(state, event) {
    state.version = event.streamVersion;
    state.eventTypes.push(event.type);
    if (event.type === "TaskCreated") state.status = event.payload.task.status;
    if (event.type === "TaskCompleted") state.status = "completed";
    return state;
  },
};

test("transactional canonical projection rebuild is byte-equivalent and completion outbox follows TaskCompleted", async (t) => {
  const directory = workspace(t);
  const databasePath = path.join(directory, "canonical.sqlite");
  const journal = new SqliteJournal(databasePath);
  t.after(() => journal.close());

  const create = canonicalCommand("CreateProject", "task:projection", 0, { taskId: "projection" });
  const created = eventFor(create, "task:projection", 1, "TaskCreated", { task: { taskId: "projection", status: "active" } });
  const activeState = projector.reduce(projector.initialState("task:projection"), created);
  journal.commit(commitRequest(create, [{ streamId: "task:projection", streamType: "task", expectedStreamVersion: 0 }], [{ streamId: "task:projection", events: [created] }], {
    projectionWrites: [{ projectionName: "task_canonical", projectionKey: "task:projection", state: activeState }],
  }));
  assert.equal(journal.listOutbox().length, 0);
  assert.equal(journal.getCheckpoint("task_canonical").lastGlobalPosition, 1);

  const complete = canonicalCommand("FinalizeCompletedTask", "task:projection", 1, { taskId: "projection" });
  const completed = eventFor(complete, "task:projection", 2, "TaskCompleted", { taskId: "projection", completedAt: complete.issuedAt, settlementId: "settlement_projection" });
  const completedState = projector.reduce(structuredClone(activeState), completed);
  journal.commit(commitRequest(complete, [{ streamId: "task:projection", streamType: "task", expectedStreamVersion: 1 }], [{ streamId: "task:projection", events: [completed] }], {
    projectionWrites: [{ projectionName: "task_canonical", projectionKey: "task:projection", state: completedState }],
    outboxMessages: [{ outboxId: "outbox_task_projection", eventId: completed.eventId, topic: "task.completed", payload: { taskId: "projection", settlementId: "settlement_projection" }, createdAt: complete.issuedAt }],
  }));
  assert.equal(journal.listOutbox({ pendingOnly: true }).length, 1);
  assert.equal(journal.getCheckpoint("task_canonical").lastGlobalPosition, 2);
  const originalProjectionBytes = canonicalize(journal.listProjection("task_canonical"));

  journal.deleteProjection("task_canonical");
  assert.equal(journal.listProjection("task_canonical").length, 0);
  const rebuilt = journal.rebuildProjection("task_canonical", projector);
  assert.equal(canonicalize(rebuilt), originalProjectionBytes);
  assert.equal(rebuilt[0].state.status, "completed");

  const backupPath = path.join(directory, "canonical.backup.sqlite");
  await journal.backupTo(backupPath);
  const restored = SqliteJournal.restoreFromBackup(backupPath, path.join(directory, "canonical.restored.sqlite"));
  try {
    assert.equal(restored.readAll().length, 2);
    assert.equal(canonicalize(restored.listProjection("task_canonical")), originalProjectionBytes);
    assert.equal(restored.listOutbox().length, 1);
    assert.equal(restored.verifyIntegrity().ok, true);
  } finally {
    restored.close();
  }
});

test("completion outbox cannot be inserted without TaskCompleted in the same transaction", (t) => {
  const journal = new SqliteJournal(path.join(workspace(t), "outbox-guard.sqlite"));
  t.after(() => journal.close());
  const command = canonicalCommand("RecordReviewAttestation", "task:not-complete", 0, { taskId: "not-complete" });
  const event = eventFor(command, command.streamId, 1, "ReviewAccepted", { taskId: "not-complete", reviewContractId: "review", evidenceDigest: "a".repeat(64), policyVersion: "policy", quorumDigest: "b".repeat(64) });
  const request = commitRequest(command, [{ streamId: command.streamId, streamType: "task", expectedStreamVersion: 0 }], [{ streamId: command.streamId, events: [event] }], {
    outboxMessages: [{ outboxId: "outbox_illegal_completion", eventId: event.eventId, topic: "task.completed", payload: { taskId: "not-complete" }, createdAt: command.issuedAt }],
  });
  assert.throws(() => journal.commit(request), (error) => error.code === "OUTBOX_EVENT_MISMATCH");
  assert.equal(journal.readAll().length, 0);
  assert.equal(journal.listOutbox().length, 0);
  assert.equal(journal.getReceiptByIdempotencyKey(command.idempotencyKey), null);
});
