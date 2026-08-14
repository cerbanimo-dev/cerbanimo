import { EVENT_TYPES, type EventType } from "../../schemas/src/index.js";

export interface EventDefinition {
  type: EventType;
  aggregate: "project" | "task" | "passport" | "proposal";
  category: "project" | "task-graph" | "evidence" | "review" | "settlement" | "passport" | "proposal";
  description: string;
}

function definition(
  type: EventType,
  aggregate: EventDefinition["aggregate"],
  category: EventDefinition["category"],
  description: string,
): EventDefinition {
  return { type, aggregate, category, description };
}

export const EVENT_CATALOG: Readonly<Record<EventType, EventDefinition>> = Object.freeze({
  ProjectCreated: definition("ProjectCreated", "project", "project", "A project identity and metadata were created."),
  ProjectEdited: definition("ProjectEdited", "project", "project", "Inspectable project metadata changed."),
  ProjectCompleted: definition("ProjectCompleted", "project", "project", "All project tasks reached completed after settlement."),
  ProjectContinued: definition("ProjectContinued", "project", "project", "A chosen horizon appended another chapter to the same project."),
  TaskAdded: definition("TaskAdded", "project", "task-graph", "An acyclic task node was added."),
  TaskCreated: definition("TaskCreated", "task", "task-graph", "A per-task lifecycle stream was initialized."),
  TaskEdited: definition("TaskEdited", "task", "task-graph", "An uncompleted task definition changed."),
  TaskAssigned: definition("TaskAssigned", "task", "task-graph", "Task accountability changed."),
  TaskDependenciesSet: definition("TaskDependenciesSet", "project", "task-graph", "A task's dependency edges changed."),
  TaskActivated: definition("TaskActivated", "task", "task-graph", "A traversable task became active."),
  EvidenceDraftSubmitted: definition("EvidenceDraftSubmitted", "task", "evidence", "A mutable evidence draft was submitted."),
  EvidenceDraftWithdrawn: definition("EvidenceDraftWithdrawn", "task", "evidence", "A mutable draft returned to active work."),
  EvidenceClosed: definition("EvidenceClosed", "task", "evidence", "An immutable evidence bundle and digest were closed."),
  DeterministicProofPassed: definition("DeterministicProofPassed", "task", "review", "The deterministic gate passed with attributable result codes before independent review opened."),
  DeterministicProofRejected: definition("DeterministicProofRejected", "task", "review", "The deterministic gate rejected closed evidence without opening review."),
  DeterministicAppealFiled: definition("DeterministicAppealFiled", "task", "review", "The evidence cycle's single deterministic appeal was filed."),
  DeterministicAppealUpheld: definition("DeterministicAppealUpheld", "task", "review", "An eligible human upheld deterministic rejection."),
  DeterministicAppealOverturned: definition("DeterministicAppealOverturned", "task", "review", "An eligible human overturned deterministic rejection without approving the task."),
  ReviewOpened: definition("ReviewOpened", "task", "review", "Digest-bound review opened after deterministic proof passed."),
  ReviewAttestationRecorded: definition("ReviewAttestationRecorded", "task", "review", "An assigned reviewer returned an attributable attestation."),
  ReviewAccepted: definition("ReviewAccepted", "task", "review", "Approving quorum escrowed an entitlement without releasing effects."),
  ReviewRejected: definition("ReviewRejected", "task", "review", "Symmetrical rejecting quorum preserved reasons and immutable evidence."),
  ReviewInconclusive: definition("ReviewInconclusive", "task", "review", "Review ended without either quorum; timeout did not imply rejection."),
  ReviewersReassigned: definition("ReviewersReassigned", "task", "review", "Unavailable reviewers were replaced within a bounded policy."),
  ReviewEscalatedToHuman: definition("ReviewEscalatedToHuman", "task", "review", "An inconclusive review was escalated to named human reviewers."),
  CorrectionCycleStarted: definition("CorrectionCycleStarted", "task", "evidence", "A new mutable evidence cycle began after rejection."),
  SettlementCommitted: definition("SettlementCommitted", "task", "settlement", "The accepted entitlement was committed exactly once."),
  TaskCompleted: definition("TaskCompleted", "task", "settlement", "The settled task stream recorded completion."),
  ProjectTaskCompleted: definition("ProjectTaskCompleted", "project", "settlement", "The project graph recorded a task completion atomically."),
  TaskDependencyActivated: definition("TaskDependencyActivated", "task", "task-graph", "A dependent task stream became traversable after completion."),
  ContinuationOffered: definition("ContinuationOffered", "project", "settlement", "Three continuation horizons were offered after project completion."),
  PassportRootRegistered: definition("PassportRootRegistered", "passport", "passport", "Public person-controlled root identity material was registered."),
  DeviceAuthorized: definition("DeviceAuthorized", "passport", "passport", "A device key received bounded authorization."),
  DeviceRevoked: definition("DeviceRevoked", "passport", "passport", "One device authorization was revoked."),
  MembershipJoined: definition("MembershipJoined", "passport", "passport", "A federation membership was recorded independently."),
  MembershipLeft: definition("MembershipLeft", "passport", "passport", "A federation relationship ended without erasing identity."),
  ClaimIssued: definition("ClaimIssued", "passport", "passport", "An attributable claim was recorded."),
  ClaimRevoked: definition("ClaimRevoked", "passport", "passport", "A claim was revoked without rewriting its issue event."),
  ProgressionReceiptRecorded: definition("ProgressionReceiptRecorded", "passport", "passport", "A portable progression receipt was recorded."),
  ProgressionReceiptRevoked: definition("ProgressionReceiptRevoked", "passport", "passport", "A progression receipt was revoked independently."),
  RecoveryMethodAdded: definition("RecoveryMethodAdded", "passport", "passport", "Public recovery metadata was added."),
  RecoveryMethodRevoked: definition("RecoveryMethodRevoked", "passport", "passport", "One recovery method was revoked."),
  RootIdentityRevoked: definition("RootIdentityRevoked", "passport", "passport", "Root identity was revoked while history remained intact."),
  StableRootConsentIssued: definition("StableRootConsentIssued", "passport", "passport", "A high-assurance device issued short-lived audience/purpose-bound stable-root consent."),
  StableRootConsentRevoked: definition("StableRootConsentRevoked", "passport", "passport", "Stable-root disclosure consent was revoked independently."),
  PassportPresentationIssued: definition("PassportPresentationIssued", "passport", "passport", "A selective public presentation digest was recorded."),
  ProposalRecorded: definition("ProposalRecorded", "proposal", "proposal", "A non-mutating formal proposal and semantic diff were recorded."),
  ProposalCancelled: definition("ProposalCancelled", "proposal", "proposal", "A person declined a proposal with a non-mutation record."),
  ProposalConfirmedAndExecuted: definition("ProposalConfirmedAndExecuted", "proposal", "proposal", "Human confirmation and all mutations committed atomically at bound versions."),
});

if (Object.keys(EVENT_CATALOG).length !== EVENT_TYPES.length) {
  throw new Error("Event catalog and schema event list differ");
}
