import type { CommandType, TaskStatus } from "../../schemas/src/index.js";
import { reject } from "./errors.js";

export const TASK_STATES: readonly TaskStatus[] = Object.freeze([
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

export const TASK_COMMAND_ALLOWED_STATES = Object.freeze({
  EditTask: ["open", "active"],
  AssignTask: ["open", "active"],
  ActivateTask: ["open"],
  SubmitEvidenceDraft: ["active", "submitted"],
  WithdrawEvidenceDraft: ["submitted"],
  CloseEvidence: ["submitted"],
  OpenReview: ["evidence_closed"],
  FileDeterministicAppeal: ["rejected"],
  ResolveDeterministicAppeal: ["deterministic_appeal_pending"],
  RecordReviewAttestation: ["review_pending"],
  ResolveReviewInconclusive: ["review_pending"],
  ReassignReviewers: ["review_pending"],
  EscalateReviewToHuman: ["review_pending"],
  BeginCorrectionCycle: ["rejected"],
  SettleAcceptedTask: ["accepted_pending_settlement"],
  FinalizeCompletedTask: ["settled"],
} satisfies Partial<Record<CommandType, readonly TaskStatus[]>>);

export type TaskScopedCommandType = keyof typeof TASK_COMMAND_ALLOWED_STATES;

export const LEGAL_TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = Object.freeze({
  open: ["active"],
  active: ["submitted"],
  submitted: ["submitted", "active", "evidence_closed"],
  evidence_closed: ["review_pending", "rejected"],
  review_pending: ["review_pending", "rejected", "accepted_pending_settlement"],
  rejected: ["active", "deterministic_appeal_pending"],
  deterministic_appeal_pending: ["rejected", "review_pending"],
  accepted_pending_settlement: ["settled"],
  settled: ["completed"],
  completed: [],
});

export function isTaskCommandAllowed(commandType: TaskScopedCommandType, status: TaskStatus): boolean {
  return TASK_COMMAND_ALLOWED_STATES[commandType].includes(status as never);
}

export function assertTaskCommandAllowed(commandType: TaskScopedCommandType, status: TaskStatus): void {
  if (isTaskCommandAllowed(commandType, status)) return;
  const code = status === "completed" ? "SEALED_HISTORY" : "INVALID_TRANSITION";
  reject(code, `${commandType} is forbidden while a task is ${status}`, { commandType, status });
}

export function isTaskStatusTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  return LEGAL_TASK_STATUS_TRANSITIONS[from].includes(to);
}

export function assertTaskStatusTransition(from: TaskStatus, to: TaskStatus, cause: string): void {
  if (isTaskStatusTransitionAllowed(from, to)) return;
  reject("INVALID_TRANSITION", `Task transition ${from} -> ${to} is forbidden`, { from, to, cause });
}
