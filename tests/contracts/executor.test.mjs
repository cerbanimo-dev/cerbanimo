import assert from "node:assert/strict";
import test from "node:test";
import { emptyProjectAggregate, emptyTaskAggregate, executeCommand, executeProjectCommandAtomically } from "../../.build/packages/domain/src/index.js";
import { command, expectAccepted, expectRejected } from "./support/commands.mjs";

const task = {
  taskId: "task_executor",
  title: "Executor task",
  description: "Exercise optimistic concurrency.",
  proofRequirement: "A passing contract test.",
  dependencyIds: [],
  ownerRootIdentityId: null,
};

function createProject(streamId, overrides = {}) {
  const state = emptyProjectAggregate(streamId);
  const create = command("CreateProject", streamId, 0, { projectId: `${streamId}_id`, title: "Before", description: "Before.", tasks: [task] }, overrides);
  const result = executeProjectCommandAtomically(state, { "task:task_executor": emptyTaskAggregate("task:task_executor") }, create);
  assert.equal(result.accepted, true);
  return { create, result };
}

test("accepted multi-stream events and receipts retain complete canonical command metadata", () => {
  const { create, result } = createProject("project_stream_executor", {
    commandId: "cmd_metadata",
    idempotencyKey: "idem_metadata",
    correlationId: "corr_metadata",
    causationId: "cause_metadata",
    issuedAt: "2026-07-22T22:00:00.000Z",
  });
  assert.deepEqual(new Set(result.events.map(({ streamId }) => streamId)), new Set(["project_stream_executor", "task:task_executor"]));
  for (const event of result.events) {
    assert.equal(event.commandId, create.commandId);
    assert.equal(event.idempotencyKey, create.idempotencyKey);
    assert.equal(event.correlationId, create.correlationId);
    assert.equal(event.causationId, create.causationId);
    assert.deepEqual(event.actor, create.actor);
  }
  assert.equal(result.receipt.commandId, create.commandId);
  assert.equal(result.receipt.reasonCode, null);
  assert.equal(result.receipt.requiresRepreview, false);
  assert.equal(result.receipt.resultingStreamVersions.length, 2);
});

test("stale expected versions reject with no events and no state change", () => {
  const { result } = createProject("project_stream_stale");
  const state = result.projectState;
  const stale = executeCommand(state, command("EditProject", state.streamId, 0, { projectId: "project_stream_stale_id", title: "Stale write", description: "Must fail." }));
  expectRejected(stale, "STALE_STREAM_VERSION");
  assert.equal(stale.events.length, 0);
  assert.equal(stale.state.project.title, "Before");
  assert.equal(stale.state.version, state.version);
});

test("an exact idempotent replay returns the original receipt before stale-version evaluation", () => {
  const initial = emptyProjectAggregate("project_stream_replay");
  const taskStates = { "task:task_executor": emptyTaskAggregate("task:task_executor") };
  const create = command("CreateProject", initial.streamId, 0, { projectId: "project_replay", title: "Replay", description: "Replay once.", tasks: [task] }, { idempotencyKey: "idem_replay" });
  const first = executeProjectCommandAtomically(initial, taskStates, create);
  assert.equal(first.accepted, true);
  const replay = executeProjectCommandAtomically(first.projectState, first.taskStates, create, { priorReceipt: first.receipt });
  assert.equal(replay.accepted, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.events.length, 0);
  assert.equal(replay.receipt.receiptId, first.receipt.receiptId);
  assert.equal(replay.projectState.version, first.projectState.version);
});

test("model actors and idempotency-key reuse with changed content are rejected", () => {
  const state = emptyProjectAggregate("project_stream_actor");
  const tasks = { "task:task_executor": emptyTaskAggregate("task:task_executor") };
  const modelCommand = command("CreateProject", state.streamId, 0, { projectId: "project_actor", title: "Actor", description: "Model cannot write.", tasks: [task] }, { actor: { kind: "model", modelId: "model_kamiya", roles: [] } });
  assert.equal(executeProjectCommandAtomically(state, tasks, modelCommand).accepted, false);

  const original = command("CreateProject", state.streamId, 0, { projectId: "project_actor", title: "Original", description: "Original.", tasks: [task] }, { idempotencyKey: "idem_collision" });
  const accepted = executeProjectCommandAtomically(state, tasks, original);
  assert.equal(accepted.accepted, true);
  const changed = { ...original, payload: { ...original.payload, title: "Changed" } };
  const collision = executeProjectCommandAtomically(accepted.projectState, accepted.taskStates, changed, { priorReceipt: accepted.receipt });
  assert.equal(collision.accepted, false);
  assert.equal(collision.rejection.code, "IDEMPOTENCY_KEY_REUSE");
});
