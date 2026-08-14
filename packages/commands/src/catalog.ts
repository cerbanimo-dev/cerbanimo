import { COMMAND_TYPES, type CommandType } from "../../schemas/src/index.js";

export type AggregateType = "project" | "task" | "passport" | "proposal";

export interface CommandDefinition {
  type: CommandType;
  aggregate: AggregateType;
  category: "project" | "task-graph" | "evidence" | "review" | "settlement" | "passport" | "proposal";
  allowedActorKinds: ReadonlyArray<"human" | "service">;
  consequence: string;
}

function definition(
  type: CommandType,
  aggregate: AggregateType,
  category: CommandDefinition["category"],
  consequence: string,
  allowedActorKinds: CommandDefinition["allowedActorKinds"] = ["human", "service"],
): CommandDefinition {
  return { type, aggregate, category, consequence, allowedActorKinds };
}

export const COMMAND_CATALOG: Readonly<Record<CommandType, CommandDefinition>> = Object.freeze({
  CreateProject: definition("CreateProject", "project", "project", "Creates a project and its initial acyclic task graph.", ["human"]),
  EditProject: definition("EditProject", "project", "project", "Changes inspectable project metadata."),
  ContinueProject: definition("ContinueProject", "project", "project", "Chooses a completion horizon and appends a new chapter to the same project.", ["human"]),
  AddTask: definition("AddTask", "project", "task-graph", "Adds one uncompleted task with backward-resolving dependencies."),
  EditTask: definition("EditTask", "task", "task-graph", "Changes an uncompleted task definition."),
  AssignTask: definition("AssignTask", "task", "task-graph", "Assigns or clears an accountable owner on uncompleted work."),
  SetTaskDependencies: definition("SetTaskDependencies", "project", "task-graph", "Replaces dependencies while preserving an acyclic graph."),
  ActivateTask: definition("ActivateTask", "task", "task-graph", "Activates an open task after project-topology validation."),
  SubmitEvidenceDraft: definition("SubmitEvidenceDraft", "task", "evidence", "Creates or replaces the mutable draft for the active evidence cycle."),
  WithdrawEvidenceDraft: definition("WithdrawEvidenceDraft", "task", "evidence", "Returns a submitted draft to active work without changing closed evidence."),
  CloseEvidence: definition("CloseEvidence", "task", "evidence", "Freezes a canonical evidence bundle at the confirmed digest."),
  OpenReview: definition("OpenReview", "task", "review", "Records deterministic rejection or opens review after a passing gate."),
  FileDeterministicAppeal: definition("FileDeterministicAppeal", "task", "review", "Files the evidence cycle's single appeal against deterministic rejection.", ["human"]),
  ResolveDeterministicAppeal: definition("ResolveDeterministicAppeal", "task", "review", "An eligible conflict-free human upholds rejection or opens independent review on the unchanged digest.", ["human"]),
  RecordReviewAttestation: definition("RecordReviewAttestation", "task", "review", "Records one assigned, digest-bound, attributable review opinion."),
  ResolveReviewInconclusive: definition("ResolveReviewInconclusive", "task", "review", "Records a non-rejecting inconclusive resolution, including timeout."),
  ReassignReviewers: definition("ReassignReviewers", "task", "review", "Replaces unavailable reviewers within the policy bound."),
  EscalateReviewToHuman: definition("EscalateReviewToHuman", "task", "review", "Escalates an inconclusive contract to named human reviewers."),
  BeginCorrectionCycle: definition("BeginCorrectionCycle", "task", "evidence", "Starts a new evidence cycle while preserving the rejected cycle."),
  SettleAcceptedTask: definition("SettleAcceptedTask", "task", "settlement", "Commits the exact accepted entitlement once."),
  FinalizeCompletedTask: definition("FinalizeCompletedTask", "task", "settlement", "Atomically completes a task, project record, and dependent task activations."),
  RegisterRootIdentity: definition("RegisterRootIdentity", "passport", "passport", "Registers person-controlled public root identity material.", ["human"]),
  AuthorizeDevice: definition("AuthorizeDevice", "passport", "passport", "Adds an independently revocable device authorization.", ["human"]),
  RevokeDevice: definition("RevokeDevice", "passport", "passport", "Revokes one device without revoking root identity.", ["human"]),
  JoinMembership: definition("JoinMembership", "passport", "passport", "Records an independently removable federation membership.", ["human"]),
  LeaveMembership: definition("LeaveMembership", "passport", "passport", "Ends membership without erasing identity or portable receipts.", ["human"]),
  IssueClaim: definition("IssueClaim", "passport", "passport", "Records an attributable platform or federation claim."),
  RevokeClaim: definition("RevokeClaim", "passport", "passport", "Revokes one claim independently."),
  RecordProgressionReceipt: definition("RecordProgressionReceipt", "passport", "passport", "Records a portable signed progression receipt."),
  RevokeProgressionReceipt: definition("RevokeProgressionReceipt", "passport", "passport", "Revokes one progression receipt without rewriting it."),
  AddRecoveryMethod: definition("AddRecoveryMethod", "passport", "passport", "Adds independently revocable public recovery metadata.", ["human"]),
  RevokeRecoveryMethod: definition("RevokeRecoveryMethod", "passport", "passport", "Revokes one recovery method.", ["human"]),
  RevokeRootIdentity: definition("RevokeRootIdentity", "passport", "passport", "Revokes the root identity while preserving the audit history.", ["human"]),
  IssueStableRootConsent: definition("IssueStableRootConsent", "passport", "passport", "Issues short-lived audience/purpose consent from a high-assurance authorized device.", ["human"]),
  RevokeStableRootConsent: definition("RevokeStableRootConsent", "passport", "passport", "Revokes one stable-root disclosure consent.", ["human"]),
  CreatePassportPresentation: definition("CreatePassportPresentation", "passport", "passport", "Creates a selective public presentation without root private key transfer.", ["human"]),
  RecordProposal: definition("RecordProposal", "proposal", "proposal", "Records a non-mutating, state-bound proposal and semantic diff."),
  ConfirmAndExecuteProposal: definition("ConfirmAndExecuteProposal", "proposal", "proposal", "Atomically confirms and executes exact proposal operations at bound versions.", ["human"]),
  CancelProposal: definition("CancelProposal", "proposal", "proposal", "Cancels a pending proposal and returns a non-mutation receipt.", ["human"]),
});

if (Object.keys(COMMAND_CATALOG).length !== COMMAND_TYPES.length) {
  throw new Error("Command catalog and schema command list differ");
}
