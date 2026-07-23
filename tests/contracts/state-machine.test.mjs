import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGAL_TASK_STATUS_TRANSITIONS,
  TASK_COMMAND_ALLOWED_STATES,
  TASK_STATES,
  assertTaskCommandAllowed,
  assertTaskStatusTransition,
  isTaskCommandAllowed,
  isTaskStatusTransitionAllowed,
} from "../../.build/packages/domain/src/index.js";

test("the canonical evidence and settlement state set is complete", () => {
  assert.deepEqual(TASK_STATES, [
    "open",
    "active",
    "submitted",
    "evidence_closed",
    "review_pending",
    "rejected",
    "deterministic_appeal_pending",
    "accepted_pending_settlement",
    "settled",
    "completed",
  ]);
});

test("all 160 task-command/state combinations are classified", () => {
  let legal = 0;
  let forbidden = 0;
  for (const commandType of Object.keys(TASK_COMMAND_ALLOWED_STATES)) {
    for (const state of TASK_STATES) {
      const expected = TASK_COMMAND_ALLOWED_STATES[commandType].includes(state);
      assert.equal(isTaskCommandAllowed(commandType, state), expected);
      if (expected) {
        assert.doesNotThrow(() => assertTaskCommandAllowed(commandType, state));
        legal += 1;
      } else {
        assert.throws(() => assertTaskCommandAllowed(commandType, state), /forbidden/);
        forbidden += 1;
      }
    }
  }
  assert.equal(legal, 19);
  assert.equal(forbidden, 141);
  assert.equal(legal + forbidden, 160);
});

test("all 100 state-to-state transitions are classified", () => {
  let legal = 0;
  let forbidden = 0;
  for (const from of TASK_STATES) {
    for (const to of TASK_STATES) {
      const expected = LEGAL_TASK_STATUS_TRANSITIONS[from].includes(to);
      assert.equal(isTaskStatusTransitionAllowed(from, to), expected);
      if (expected) {
        assert.doesNotThrow(() => assertTaskStatusTransition(from, to, "test"));
        legal += 1;
      } else {
        assert.throws(() => assertTaskStatusTransition(from, to, "test"), /forbidden/);
        forbidden += 1;
      }
    }
  }
  assert.equal(legal, 16);
  assert.equal(forbidden, 84);
  assert.equal(legal + forbidden, 100);
});
