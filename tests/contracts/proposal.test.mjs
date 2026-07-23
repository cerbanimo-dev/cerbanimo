import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmAndExecuteProposalAtomically,
  deriveProposalDigest,
  deriveSemanticDiffDigest,
  emptyProjectAggregate,
  emptyProposalAggregate,
  emptyTaskAggregate,
  executeCommand,
  executeProjectCommandAtomically,
} from "../../.build/packages/domain/src/index.js";
import { command, expectAccepted } from "./support/commands.mjs";

function initialProject(streamId = "project_stream_proposal") {
  const task = { taskId: `task_${streamId}`, title: "Existing", description: "Existing task.", proofRequirement: "Existing proof.", dependencyIds: [], ownerRootIdentityId: null };
  const created = executeProjectCommandAtomically(
    emptyProjectAggregate(streamId),
    { [`task:${task.taskId}`]: emptyTaskAggregate(`task:${task.taskId}`) },
    command("CreateProject", streamId, 0, { projectId: "project_proposal", title: "Proposal target", description: "State before confirmation.", tasks: [task] }),
  );
  assert.equal(created.accepted, true);
  return created.projectState;
}

function buildProposalRecord(proposalState, targetState, operations, suffix = "one") {
  const issuedAt = "2026-07-22T23:00:00.000Z";
  const semanticDiff = {
    schemaVersion: "cerbanimo.semantic-diff/1.0.0",
    entries: operations.map((operation, index) => ({
      operation: "replace",
      path: `/operations/${index}`,
      beforeDigest: "1".repeat(64),
      afterDigest: "2".repeat(64),
      summary: `Apply ${operation.commandType} to ${operation.streamId}.`,
    })),
  };
  const semanticDiffDigest = deriveSemanticDiffDigest(semanticDiff);
  const streamExpectations = [{ streamId: targetState.streamId, expectedStreamVersion: targetState.version }];
  const material = {
    proposalId: `proposal_${suffix}`,
    summary: `Proposal ${suffix}`,
    preparedBy: { kind: "model", identifier: "model_kamiya_interpreter" },
    operations,
    streamExpectations,
    semanticDiffDigest,
    createdAt: issuedAt,
    expiresAt: "2026-07-23T23:00:00.000Z",
  };
  const proposalDigest = deriveProposalDigest(material);
  const record = command("RecordProposal", proposalState.streamId, proposalState.version, { ...material, semanticDiff, proposalDigest }, { issuedAt });
  return { record, material, semanticDiffDigest, proposalDigest, streamExpectations };
}

function confirmation(proposalState, built, overrides = {}) {
  return command("ConfirmAndExecuteProposal", proposalState.streamId, proposalState.version, {
    proposalId: built.material.proposalId,
    proposalDigest: built.proposalDigest,
    semanticDiffDigest: built.semanticDiffDigest,
    confirmedStreamExpectations: built.streamExpectations,
    ...overrides,
  });
}

test("confirmation and exact state-bound mutation commit atomically in one command", () => {
  const target = initialProject();
  let proposal = emptyProposalAggregate("proposal_stream_one");
  const operation = {
    operationId: "op_edit_project",
    commandType: "EditProject",
    streamId: target.streamId,
    expectedStreamVersion: target.version,
    payload: { projectId: "project_proposal", title: "Confirmed title", description: "Only after atomic confirmation." },
  };
  const built = buildProposalRecord(proposal, target, [operation]);
  proposal = expectAccepted(executeCommand(proposal, built.record)).state;
  assert.equal(target.project.title, "Proposal target", "recording the proposal is inert");
  assert.equal(proposal.proposal.status, "pending");

  const wrongDiff = confirmAndExecuteProposalAtomically(proposal, confirmation(proposal, built, { semanticDiffDigest: "f".repeat(64) }), { [target.streamId]: target });
  assert.equal(wrongDiff.accepted, false);
  assert.equal(wrongDiff.rejection.code, "PROPOSAL_BINDING_MISMATCH");
  assert.equal(wrongDiff.events.length, 0);

  const confirm = confirmation(proposal, built);
  const atomic = confirmAndExecuteProposalAtomically(proposal, confirm, { [target.streamId]: target });
  assert.equal(atomic.accepted, true);
  assert.equal(atomic.executed, true);
  assert.equal(atomic.proposalState.proposal.status, "executed");
  assert.equal(atomic.targetStates[target.streamId].project.title, "Confirmed title");
  assert.equal(atomic.events.at(-1).type, "ProposalConfirmedAndExecuted");
  assert.equal(atomic.receipt.status, "executed");
  assert.equal(atomic.receipt.requiresRepreview, false);
  const replay = confirmAndExecuteProposalAtomically(atomic.proposalState, confirm, atomic.targetStates, { priorReceipt: atomic.receipt });
  assert.equal(replay.accepted, true);
  assert.equal(replay.executed, true);
  assert.equal(replay.events.length, 0);
  assert.equal(replay.receipt.replayed, true);
});

test("a stale target commits neither confirmation nor mutation and requires re-preview", () => {
  const original = initialProject("project_stream_stale_proposal");
  let proposal = emptyProposalAggregate("proposal_stream_stale");
  const operation = {
    operationId: "op_stale",
    commandType: "EditProject",
    streamId: original.streamId,
    expectedStreamVersion: original.version,
    payload: { projectId: "project_proposal", title: "Proposed title", description: "Proposed description." },
  };
  const built = buildProposalRecord(proposal, original, [operation], "stale");
  proposal = expectAccepted(executeCommand(proposal, built.record)).state;
  const changed = expectAccepted(executeCommand(original, command("EditProject", original.streamId, original.version, { projectId: "project_proposal", title: "Concurrent title", description: "Concurrent state." }))).state;
  const atomic = confirmAndExecuteProposalAtomically(proposal, confirmation(proposal, built), { [changed.streamId]: changed });
  assert.equal(atomic.accepted, true);
  assert.equal(atomic.executed, false);
  assert.equal(atomic.events.length, 0);
  assert.equal(atomic.receipt.status, "not-executed");
  assert.equal(atomic.receipt.reasonCode, "STALE_STREAM_VERSION");
  assert.equal(atomic.receipt.requiresRepreview, true);
  assert.equal(atomic.receipt.eventPositions.length, 0);
  assert.equal(atomic.targetStates[changed.streamId].project.title, "Concurrent title");
  assert.equal(atomic.proposalState.proposal.status, "pending");
});

test("a failing operation applies none of an otherwise valid proposal", () => {
  const target = initialProject("project_stream_atomic");
  let proposal = emptyProposalAggregate("proposal_stream_atomic");
  const operations = [
    {
      operationId: "op_valid_first",
      commandType: "EditProject",
      streamId: target.streamId,
      expectedStreamVersion: target.version,
      payload: { projectId: "project_proposal", title: "Must not persist", description: "Rolled back with the batch." },
    },
    {
      operationId: "op_invalid_second",
      commandType: "SetTaskDependencies",
      streamId: target.streamId,
      expectedStreamVersion: target.version,
      payload: { taskId: "missing_task", dependencyIds: [] },
    },
  ];
  const built = buildProposalRecord(proposal, target, operations, "atomic");
  proposal = expectAccepted(executeCommand(proposal, built.record)).state;
  const atomic = confirmAndExecuteProposalAtomically(proposal, confirmation(proposal, built), { [target.streamId]: target });
  assert.equal(atomic.accepted, false);
  assert.equal(atomic.events.length, 0);
  assert.equal(atomic.targetStates[target.streamId].project.title, "Proposal target");
  assert.equal(atomic.proposalState.proposal.status, "pending");
});
