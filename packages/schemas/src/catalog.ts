export type JsonSchema = Record<string, unknown>;

export const SCHEMA_VERSIONS = Object.freeze({
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
} as const);

export const COMMAND_TYPES = [
  "CreateProject",
  "EditProject",
  "ContinueProject",
  "AddTask",
  "EditTask",
  "AssignTask",
  "SetTaskDependencies",
  "ActivateTask",
  "SubmitEvidenceDraft",
  "WithdrawEvidenceDraft",
  "CloseEvidence",
  "OpenReview",
  "FileDeterministicAppeal",
  "ResolveDeterministicAppeal",
  "RecordReviewAttestation",
  "ResolveReviewInconclusive",
  "ReassignReviewers",
  "EscalateReviewToHuman",
  "BeginCorrectionCycle",
  "SettleAcceptedTask",
  "FinalizeCompletedTask",
  "RegisterRootIdentity",
  "AuthorizeDevice",
  "RevokeDevice",
  "JoinMembership",
  "LeaveMembership",
  "IssueClaim",
  "RevokeClaim",
  "RecordProgressionReceipt",
  "RevokeProgressionReceipt",
  "AddRecoveryMethod",
  "RevokeRecoveryMethod",
  "RevokeRootIdentity",
  "IssueStableRootConsent",
  "RevokeStableRootConsent",
  "CreatePassportPresentation",
  "RecordProposal",
  "ConfirmAndExecuteProposal",
  "CancelProposal",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

export const EVENT_TYPES = [
  "ProjectCreated",
  "ProjectEdited",
  "ProjectCompleted",
  "ProjectContinued",
  "TaskAdded",
  "TaskCreated",
  "TaskEdited",
  "TaskAssigned",
  "TaskDependenciesSet",
  "TaskActivated",
  "EvidenceDraftSubmitted",
  "EvidenceDraftWithdrawn",
  "EvidenceClosed",
  "DeterministicProofPassed",
  "DeterministicProofRejected",
  "DeterministicAppealFiled",
  "DeterministicAppealUpheld",
  "DeterministicAppealOverturned",
  "ReviewOpened",
  "ReviewAttestationRecorded",
  "ReviewAccepted",
  "ReviewRejected",
  "ReviewInconclusive",
  "ReviewersReassigned",
  "ReviewEscalatedToHuman",
  "CorrectionCycleStarted",
  "SettlementCommitted",
  "TaskCompleted",
  "ProjectTaskCompleted",
  "TaskDependencyActivated",
  "ContinuationOffered",
  "PassportRootRegistered",
  "DeviceAuthorized",
  "DeviceRevoked",
  "MembershipJoined",
  "MembershipLeft",
  "ClaimIssued",
  "ClaimRevoked",
  "ProgressionReceiptRecorded",
  "ProgressionReceiptRevoked",
  "RecoveryMethodAdded",
  "RecoveryMethodRevoked",
  "RootIdentityRevoked",
  "StableRootConsentIssued",
  "StableRootConsentRevoked",
  "PassportPresentationIssued",
  "ProposalRecorded",
  "ProposalCancelled",
  "ProposalConfirmedAndExecuted",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const id: JsonSchema = { type: "string", minLength: 1, maxLength: 200 };
const text: JsonSchema = { type: "string", minLength: 1, maxLength: 20_000 };
const timestamp: JsonSchema = { type: "string", format: "date-time" };
const digest: JsonSchema = { type: "string", pattern: "^[a-f0-9]{64}$" };
const version: JsonSchema = { type: "integer", minimum: 0 };
const stringArray: JsonSchema = { type: "array", items: { type: "string" }, uniqueItems: true };

function object(required: string[], properties: Record<string, JsonSchema>, additionalProperties = false): JsonSchema {
  return { type: "object", required, properties, additionalProperties };
}

function array(items: JsonSchema, options: Record<string, unknown> = {}): JsonSchema {
  return { type: "array", items, ...options };
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

const actor = {
  oneOf: [
    object(
      ["kind", "rootIdentityId", "deviceId", "roles"],
      { kind: { const: "human" }, rootIdentityId: id, deviceId: id, roles: stringArray },
    ),
    object(
      ["kind", "serviceId", "delegatedByRootIdentityId", "roles"],
      { kind: { const: "service" }, serviceId: id, delegatedByRootIdentityId: id, roles: stringArray },
    ),
  ],
} satisfies JsonSchema;

const artifactReference = object(
  ["artifactId", "uri", "mediaType", "digest"],
  { artifactId: id, uri: text, mediaType: id, digest: nullable(digest) },
);

const taskDefinition = object(
  ["taskId", "title", "description", "proofRequirement", "dependencyIds", "ownerRootIdentityId"],
  {
    taskId: id,
    title: text,
    description: text,
    proofRequirement: text,
    dependencyIds: array(id, { uniqueItems: true }),
    ownerRootIdentityId: nullable(id),
  },
);

const deterministicGate = object(
  ["policyVersion", "evidenceDigest", "decision", "checks", "resultCodes", "rejectionReasons", "evaluatedBy", "evaluatedAt"],
  {
    policyVersion: id,
    evidenceDigest: digest,
    decision: { enum: ["pass", "reject"] },
    checks: array(object(["checkId", "passed", "detail"], { checkId: id, passed: { type: "boolean" }, detail: text }), { minItems: 1 }),
    resultCodes: array(id, { minItems: 1, uniqueItems: true }),
    rejectionReasons: array(text),
    evaluatedBy: actor,
    evaluatedAt: timestamp,
  },
);

const humanReviewCredential = object(
  ["credentialId", "subjectRootIdentityId", "issuer", "role", "scopes", "assuranceLevel", "issuedAt", "expiresAt", "status", "proof"],
  {
    credentialId: id,
    subjectRootIdentityId: id,
    issuer: id,
    role: { const: "evidence-reviewer" },
    scopes: array({ enum: ["independent-review", "deterministic-appeal"] }, { minItems: 1, uniqueItems: true }),
    assuranceLevel: { enum: ["substantial", "high"] },
    issuedAt: timestamp,
    expiresAt: timestamp,
    status: { enum: ["active", "revoked"] },
    proof: text,
  },
);

const conflictDisclosure = object(
  ["disclosureId", "reviewerRootIdentityId", "evidenceDigest", "hasConflict", "conflictTypes", "statement", "disclosedAt", "signature"],
  { disclosureId: id, reviewerRootIdentityId: id, evidenceDigest: digest, hasConflict: { type: "boolean" }, conflictTypes: array(id, { uniqueItems: true }), statement: text, disclosedAt: timestamp, signature: text },
);

const reviewAssignment = object(
  ["reviewerRootIdentityId", "reviewerKind", "humanReviewCredential", "conflictDisclosure", "assignedAt", "assignmentProof", "status"],
  {
    reviewerRootIdentityId: id,
    reviewerKind: { enum: ["model", "human"] },
    humanReviewCredential: nullable(humanReviewCredential),
    conflictDisclosure: nullable(conflictDisclosure),
    assignedAt: timestamp,
    assignmentProof: text,
    status: { enum: ["assigned", "returned", "expired", "revoked"] },
  },
);

const reviewAttestation = object(
  ["attestationId", "reviewContractId", "taskId", "submissionId", "evidenceDigest", "reviewerRootIdentityId", "decision", "confidence", "reasons", "policyVersion", "signature", "issuedAt"],
  {
    attestationId: id,
    reviewContractId: id,
    taskId: id,
    submissionId: id,
    evidenceDigest: digest,
    reviewerRootIdentityId: id,
    decision: { enum: ["approve", "reject"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasons: array(text, { minItems: 1 }),
    policyVersion: id,
    signature: text,
    issuedAt: timestamp,
  },
);

const reviewContract = object(
  ["reviewContractId", "taskId", "submissionId", "evidenceDigest", "policyVersion", "deterministicGate", "openingBasis", "appealId", "assignmentSeedCommitment", "assignments", "quorum", "maxReassignments", "expiresAt"],
  {
    reviewContractId: id,
    taskId: id,
    submissionId: id,
    evidenceDigest: digest,
    policyVersion: id,
    deterministicGate,
    openingBasis: { enum: ["deterministic-pass", "appeal-overturn"] },
    appealId: nullable(id),
    assignmentSeedCommitment: digest,
    assignments: array(reviewAssignment),
    quorum: { type: "integer", minimum: 1 },
    maxReassignments: { type: "integer", minimum: 0, maximum: 20 },
    expiresAt: timestamp,
  },
);

const settlementEffects = object(
  ["baseCurrency", "xp", "skillXp", "specimens", "other"],
  {
    baseCurrency: array(object(["accountId", "currency", "amount"], { accountId: id, currency: id, amount: { type: "integer", minimum: 0 } })),
    xp: array(object(["accountId", "amount"], { accountId: id, amount: { type: "integer", minimum: 0 } })),
    skillXp: array(object(["accountId", "skillId", "amount"], { accountId: id, skillId: id, amount: { type: "integer", minimum: 0 } })),
    specimens: array(object(["specimenId", "name", "glyph"], { specimenId: id, name: text, glyph: text })),
    other: array(object(["effectType", "targetId", "value"], { effectType: id, targetId: id, value: {} })),
  },
);

const settlementIntent = object(
  ["settlementId", "taskId", "acceptedEvidenceDigest", "policyVersion", "reviewContractId", "quorumDigest", "effects", "idempotencyKey"],
  {
    settlementId: id,
    taskId: id,
    acceptedEvidenceDigest: digest,
    policyVersion: id,
    reviewContractId: id,
    quorumDigest: digest,
    effects: settlementEffects,
    idempotencyKey: id,
  },
);

const semanticDiffEntry = object(
  ["operation", "path", "beforeDigest", "afterDigest", "summary"],
  {
    operation: { enum: ["add", "replace", "remove"] },
    path: text,
    beforeDigest: nullable(digest),
    afterDigest: nullable(digest),
    summary: text,
  },
);

const semanticDiff = object(
  ["schemaVersion", "entries"],
  { schemaVersion: { const: SCHEMA_VERSIONS.semanticDiff }, entries: array(semanticDiffEntry, { minItems: 1 }) },
);

const proposedOperation = object(
  ["operationId", "commandType", "streamId", "expectedStreamVersion", "payload"],
  {
    operationId: id,
    commandType: { enum: [...COMMAND_TYPES.filter((type) => !["RecordProposal", "ConfirmAndExecuteProposal", "CancelProposal"].includes(type))] },
    streamId: id,
    expectedStreamVersion: version,
    payload: { type: "object" },
  },
);

const rootIdentity = object(
  ["rootIdentityId", "publicKey", "algorithm", "createdAt", "status"],
  { rootIdentityId: id, publicKey: text, algorithm: { const: "Ed25519" }, createdAt: timestamp, status: { enum: ["active", "revoked"] } },
);

const deviceAuthorization = object(
  ["deviceId", "publicKey", "capabilities", "assuranceLevel", "authorizedAt", "status", "revokedAt"],
  { deviceId: id, publicKey: text, capabilities: stringArray, assuranceLevel: { enum: ["standard", "high"] }, authorizedAt: timestamp, status: { enum: ["active", "revoked"] }, revokedAt: nullable(timestamp) },
);

const membership = object(
  ["membershipId", "federationId", "subjectRootIdentityId", "role", "joinedAt", "status", "endedAt"],
  { membershipId: id, federationId: id, subjectRootIdentityId: id, role: id, joinedAt: timestamp, status: { enum: ["active", "left", "revoked"] }, endedAt: nullable(timestamp) },
);

const claim = object(
  ["claimId", "subjectRootIdentityId", "issuer", "claimType", "value", "issuedAt", "expiresAt", "proof", "status", "revokedAt"],
  { claimId: id, subjectRootIdentityId: id, issuer: id, claimType: id, value: {}, issuedAt: timestamp, expiresAt: nullable(timestamp), proof: text, status: { enum: ["active", "revoked", "expired"] }, revokedAt: nullable(timestamp) },
);

const progressionReceipt = object(
  ["progressionReceiptId", "subjectRootIdentityId", "sourceNodeId", "settlementId", "effectsDigest", "portableEffects", "issuedAt", "proof", "status"],
  { progressionReceiptId: id, subjectRootIdentityId: id, sourceNodeId: id, settlementId: id, effectsDigest: digest, portableEffects: {}, issuedAt: timestamp, proof: text, status: { enum: ["active", "revoked"] } },
);

const recoveryMethod = object(
  ["recoveryMethodId", "methodType", "publicMaterial", "addedAt", "status", "revokedAt"],
  { recoveryMethodId: id, methodType: { enum: ["recovery-key", "trusted-contact", "offline-code"] }, publicMaterial: text, addedAt: timestamp, status: { enum: ["active", "revoked"] }, revokedAt: nullable(timestamp) },
);

const stableRootConsent = object(
  ["consentReceiptId", "rootIdentityId", "deviceId", "audience", "purpose", "issuedAt", "expiresAt", "status", "proof", "revokedAt"],
  { consentReceiptId: id, rootIdentityId: id, deviceId: id, audience: text, purpose: text, issuedAt: timestamp, expiresAt: timestamp, status: { enum: ["active", "revoked", "expired"] }, proof: text, revokedAt: nullable(timestamp) },
);

const presentationSelection = object(
  ["deviceIds", "membershipIds", "claimIds", "progressionReceiptIds"],
  { deviceIds: array(id, { uniqueItems: true }), membershipIds: array(id, { uniqueItems: true }), claimIds: array(id, { uniqueItems: true }), progressionReceiptIds: array(id, { uniqueItems: true }) },
);

const payloadSchemas: Record<CommandType, JsonSchema> = {
  CreateProject: object(["projectId", "title", "description", "tasks"], { projectId: id, title: text, description: text, tasks: array(taskDefinition, { minItems: 1 }) }),
  EditProject: object(["projectId", "title", "description"], { projectId: id, title: text, description: text }),
  ContinueProject: object(["projectId", "continuationId", "tasks"], { projectId: id, continuationId: id, tasks: array(taskDefinition, { minItems: 1 }) }),
  AddTask: object(["projectId", "task"], { projectId: id, task: taskDefinition }),
  EditTask: object(["taskId", "title", "description", "proofRequirement"], { taskId: id, title: text, description: text, proofRequirement: text }),
  AssignTask: object(["taskId", "ownerRootIdentityId"], { taskId: id, ownerRootIdentityId: nullable(id) }),
  SetTaskDependencies: object(["taskId", "dependencyIds"], { taskId: id, dependencyIds: array(id, { uniqueItems: true }) }),
  ActivateTask: object(["taskId"], { taskId: id }),
  SubmitEvidenceDraft: object(["taskId", "submissionId", "narrative", "artifacts"], { taskId: id, submissionId: id, narrative: text, artifacts: array(artifactReference) }),
  WithdrawEvidenceDraft: object(["taskId", "submissionId"], { taskId: id, submissionId: id }),
  CloseEvidence: object(["taskId", "submissionId", "expectedBundleDigest"], { taskId: id, submissionId: id, expectedBundleDigest: digest }),
  OpenReview: object(["taskId", "reviewContract"], { taskId: id, reviewContract }),
  FileDeterministicAppeal: object(["taskId", "appealId", "grounds"], { taskId: id, appealId: id, grounds: text }),
  ResolveDeterministicAppeal: object(["taskId", "appealId", "decision", "reasons", "reviewerCredential", "conflictDisclosure", "reviewContract"], { taskId: id, appealId: id, decision: { enum: ["uphold", "overturn"] }, reasons: array(text, { minItems: 1 }), reviewerCredential: humanReviewCredential, conflictDisclosure, reviewContract: nullable(reviewContract) }),
  RecordReviewAttestation: object(["taskId", "attestation"], { taskId: id, attestation: reviewAttestation }),
  ResolveReviewInconclusive: object(["taskId", "resolvedAt"], { taskId: id, resolvedAt: timestamp }),
  ReassignReviewers: object(["taskId", "expiredReviewerRootIdentityIds", "newAssignments"], { taskId: id, expiredReviewerRootIdentityIds: array(id, { minItems: 1, uniqueItems: true }), newAssignments: array(reviewAssignment, { minItems: 1 }) }),
  EscalateReviewToHuman: object(["taskId", "humanAssignments", "reason"], { taskId: id, humanAssignments: array(reviewAssignment, { minItems: 1 }), reason: text }),
  BeginCorrectionCycle: object(["taskId"], { taskId: id }),
  SettleAcceptedTask: object(["taskId", "intent", "transactionId"], { taskId: id, intent: settlementIntent, transactionId: id }),
  FinalizeCompletedTask: object(["taskId", "projectExpectation", "dependentTaskExpectations", "continuationOptions"], { taskId: id, projectExpectation: object(["streamId", "expectedStreamVersion"], { streamId: id, expectedStreamVersion: version }), dependentTaskExpectations: array(object(["streamId", "expectedStreamVersion"], { streamId: id, expectedStreamVersion: version }), { uniqueItems: true }), continuationOptions: array(object(["continuationId", "title", "description"], { continuationId: id, title: text, description: text }), { maxItems: 3 }) }),
  RegisterRootIdentity: object(["rootIdentity"], { rootIdentity }),
  AuthorizeDevice: object(["device"], { device: deviceAuthorization }),
  RevokeDevice: object(["deviceId", "revocationId", "reason"], { deviceId: id, revocationId: id, reason: text }),
  JoinMembership: object(["membership"], { membership }),
  LeaveMembership: object(["membershipId", "reason"], { membershipId: id, reason: text }),
  IssueClaim: object(["claim"], { claim }),
  RevokeClaim: object(["claimId", "revocationId", "reason"], { claimId: id, revocationId: id, reason: text }),
  RecordProgressionReceipt: object(["progressionReceipt"], { progressionReceipt }),
  RevokeProgressionReceipt: object(["progressionReceiptId", "revocationId", "reason"], { progressionReceiptId: id, revocationId: id, reason: text }),
  AddRecoveryMethod: object(["recoveryMethod"], { recoveryMethod }),
  RevokeRecoveryMethod: object(["recoveryMethodId", "revocationId", "reason"], { recoveryMethodId: id, revocationId: id, reason: text }),
  RevokeRootIdentity: object(["revocationId", "reason"], { revocationId: id, reason: text }),
  IssueStableRootConsent: object(["consent"], { consent: stableRootConsent }),
  RevokeStableRootConsent: object(["consentReceiptId", "revocationId", "reason"], { consentReceiptId: id, revocationId: id, reason: text }),
  CreatePassportPresentation: object(["presentationId", "audience", "purpose", "expiresAt", "selection", "pairwiseIdentity", "stableRootDisclosure", "proof"], { presentationId: id, audience: text, purpose: text, expiresAt: timestamp, identityMode: { enum: ["pairwise", "stable-root"], default: "pairwise" }, pairwiseIdentity: nullable(object(["pairwiseId", "audience", "publicKey", "proof"], { pairwiseId: id, audience: text, publicKey: text, proof: text })), stableRootDisclosure: nullable(object(["consentReceiptId", "reason"], { consentReceiptId: id, reason: text })), selection: presentationSelection, proof: text }),
  RecordProposal: object(["proposalId", "summary", "preparedBy", "operations", "streamExpectations", "semanticDiff", "semanticDiffDigest", "proposalDigest", "expiresAt"], {
    proposalId: id,
    summary: text,
    preparedBy: object(["kind", "identifier"], { kind: { enum: ["human", "model", "service"] }, identifier: id }),
    operations: array(proposedOperation, { minItems: 1 }),
    streamExpectations: array(object(["streamId", "expectedStreamVersion"], { streamId: id, expectedStreamVersion: version }), { minItems: 1 }),
    semanticDiff,
    semanticDiffDigest: digest,
    proposalDigest: digest,
    expiresAt: timestamp,
  }),
  ConfirmAndExecuteProposal: object(["proposalId", "proposalDigest", "semanticDiffDigest", "confirmedStreamExpectations"], { proposalId: id, proposalDigest: digest, semanticDiffDigest: digest, confirmedStreamExpectations: array(object(["streamId", "expectedStreamVersion"], { streamId: id, expectedStreamVersion: version }), { minItems: 1 }) }),
  CancelProposal: object(["proposalId", "proposalDigest", "reason"], { proposalId: id, proposalDigest: digest, reason: text }),
};

const looseObject: JsonSchema = { type: "object" };

const eventPayloadSchemas: Record<EventType, JsonSchema> = {
  ProjectCreated: object(["project"], { project: looseObject }),
  ProjectEdited: object(["projectId", "title", "description"], { projectId: id, title: text, description: text }),
  ProjectCompleted: object(["projectId", "completedAt"], { projectId: id, completedAt: timestamp }),
  ProjectContinued: object(["projectId", "continuationId", "chapter", "taskIds"], { projectId: id, continuationId: id, chapter: { type: "integer", minimum: 2 }, taskIds: array(id, { minItems: 1, uniqueItems: true }) }),
  TaskAdded: object(["task", "node"], { task: looseObject, node: looseObject }),
  TaskCreated: object(["task"], { task: looseObject }),
  TaskEdited: object(["taskId", "title", "description", "proofRequirement"], { taskId: id, title: text, description: text, proofRequirement: text }),
  TaskAssigned: object(["taskId", "ownerRootIdentityId"], { taskId: id, ownerRootIdentityId: nullable(id) }),
  TaskDependenciesSet: object(["taskId", "dependencyIds"], { taskId: id, dependencyIds: array(id, { uniqueItems: true }) }),
  TaskActivated: object(["taskId"], { taskId: id }),
  EvidenceDraftSubmitted: object(["taskId", "cycle", "draft"], { taskId: id, cycle: { type: "integer", minimum: 1 }, draft: looseObject }),
  EvidenceDraftWithdrawn: object(["taskId", "cycle", "submissionId"], { taskId: id, cycle: { type: "integer", minimum: 1 }, submissionId: id }),
  EvidenceClosed: object(["taskId", "cycle", "bundle"], { taskId: id, cycle: { type: "integer", minimum: 1 }, bundle: looseObject }),
  DeterministicProofPassed: object(["taskId", "evidenceDigest", "policyVersion", "resultCodes", "evaluatedBy", "evaluatedAt"], { taskId: id, evidenceDigest: digest, policyVersion: id, resultCodes: array(id, { minItems: 1, uniqueItems: true }), evaluatedBy: actor, evaluatedAt: timestamp }),
  DeterministicProofRejected: object(["taskId", "evidenceDigest", "policyVersion", "resultCodes", "rejectionStage", "reasons", "evaluatedBy", "evaluatedAt"], { taskId: id, evidenceDigest: digest, policyVersion: id, resultCodes: array(id, { minItems: 1, uniqueItems: true }), rejectionStage: { const: "deterministic" }, reasons: array(text, { minItems: 1 }), evaluatedBy: actor, evaluatedAt: timestamp }),
  DeterministicAppealFiled: object(["taskId", "cycle", "appeal"], { taskId: id, cycle: { type: "integer", minimum: 1 }, appeal: looseObject }),
  DeterministicAppealUpheld: object(["taskId", "cycle", "appealId", "evidenceDigest", "resolvedByRootIdentityId", "reviewerCredentialId", "conflictDisclosureId", "reasons", "resolvedAt"], { taskId: id, cycle: { type: "integer", minimum: 1 }, appealId: id, evidenceDigest: digest, resolvedByRootIdentityId: id, reviewerCredentialId: id, conflictDisclosureId: id, reasons: array(text, { minItems: 1 }), resolvedAt: timestamp }),
  DeterministicAppealOverturned: object(["taskId", "cycle", "appealId", "evidenceDigest", "resolvedByRootIdentityId", "reviewerCredentialId", "conflictDisclosureId", "reasons", "resolvedAt"], { taskId: id, cycle: { type: "integer", minimum: 1 }, appealId: id, evidenceDigest: digest, resolvedByRootIdentityId: id, reviewerCredentialId: id, conflictDisclosureId: id, reasons: array(text, { minItems: 1 }), resolvedAt: timestamp }),
  ReviewOpened: object(["taskId", "contract"], { taskId: id, contract: looseObject }),
  ReviewAttestationRecorded: object(["taskId", "attestation"], { taskId: id, attestation: reviewAttestation }),
  ReviewAccepted: object(["taskId", "reviewContractId", "evidenceDigest", "policyVersion", "quorumDigest"], { taskId: id, reviewContractId: id, evidenceDigest: digest, policyVersion: id, quorumDigest: digest }),
  ReviewRejected: object(["taskId", "reviewContractId", "evidenceDigest", "quorumDigest", "rejectionStage", "reasons"], { taskId: id, reviewContractId: id, evidenceDigest: digest, quorumDigest: digest, rejectionStage: { const: "independent" }, reasons: array(text, { minItems: 1 }) }),
  ReviewInconclusive: object(["taskId", "reviewContractId", "reason", "approvals", "rejections", "outstanding", "expiredReviewerRootIdentityIds", "resolvedAt"], { taskId: id, reviewContractId: id, reason: { enum: ["timeout", "exhausted-without-quorum", "split-decision"] }, approvals: { type: "integer", minimum: 0 }, rejections: { type: "integer", minimum: 0 }, outstanding: { type: "integer", minimum: 0 }, expiredReviewerRootIdentityIds: array(id, { uniqueItems: true }), resolvedAt: timestamp }),
  ReviewersReassigned: object(["taskId", "reviewContractId", "expiredReviewerRootIdentityIds", "newAssignments", "reassignmentsUsed"], { taskId: id, reviewContractId: id, expiredReviewerRootIdentityIds: array(id, { minItems: 1, uniqueItems: true }), newAssignments: array(reviewAssignment, { minItems: 1 }), reassignmentsUsed: { type: "integer", minimum: 1 } }),
  ReviewEscalatedToHuman: object(["taskId", "reviewContractId", "replacedModelReviewerRootIdentityIds", "humanAssignments", "reason"], { taskId: id, reviewContractId: id, replacedModelReviewerRootIdentityIds: array(id, { uniqueItems: true }), humanAssignments: array(reviewAssignment, { minItems: 1 }), reason: text }),
  CorrectionCycleStarted: object(["taskId", "cycle"], { taskId: id, cycle: { type: "integer", minimum: 2 } }),
  SettlementCommitted: object(["taskId", "intent", "transactionId", "committedAt"], { taskId: id, intent: settlementIntent, transactionId: id, committedAt: timestamp }),
  TaskCompleted: object(["taskId", "completedAt", "settlementId"], { taskId: id, completedAt: timestamp, settlementId: id }),
  ProjectTaskCompleted: object(["projectId", "taskId", "taskStreamId", "completedAt"], { projectId: id, taskId: id, taskStreamId: id, completedAt: timestamp }),
  TaskDependencyActivated: object(["taskId", "completedDependencyId"], { taskId: id, completedDependencyId: id }),
  ContinuationOffered: object(["projectId", "options"], { projectId: id, options: array(looseObject, { minItems: 3, maxItems: 3 }) }),
  PassportRootRegistered: object(["rootIdentity"], { rootIdentity }),
  DeviceAuthorized: object(["device"], { device: deviceAuthorization }),
  DeviceRevoked: object(["deviceId", "revokedAt", "revocation"], { deviceId: id, revokedAt: timestamp, revocation: looseObject }),
  MembershipJoined: object(["membership"], { membership }),
  MembershipLeft: object(["membershipId", "reason", "endedAt"], { membershipId: id, reason: text, endedAt: timestamp }),
  ClaimIssued: object(["claim"], { claim }),
  ClaimRevoked: object(["claimId", "revokedAt", "revocation"], { claimId: id, revokedAt: timestamp, revocation: looseObject }),
  ProgressionReceiptRecorded: object(["progressionReceipt"], { progressionReceipt }),
  ProgressionReceiptRevoked: object(["progressionReceiptId", "revocation"], { progressionReceiptId: id, revocation: looseObject }),
  RecoveryMethodAdded: object(["recoveryMethod"], { recoveryMethod }),
  RecoveryMethodRevoked: object(["recoveryMethodId", "revokedAt", "revocation"], { recoveryMethodId: id, revokedAt: timestamp, revocation: looseObject }),
  RootIdentityRevoked: object(["rootIdentityId", "revocation"], { rootIdentityId: id, revocation: looseObject }),
  StableRootConsentIssued: object(["consent"], { consent: stableRootConsent }),
  StableRootConsentRevoked: object(["consentReceiptId", "revokedAt", "revocation"], { consentReceiptId: id, revokedAt: timestamp, revocation: looseObject }),
  PassportPresentationIssued: object(["presentation", "presentationDigest"], { presentation: looseObject, presentationDigest: digest }),
  ProposalRecorded: object(["proposal"], { proposal: looseObject }),
  ProposalCancelled: object(["proposalId", "proposalDigest", "reason", "cancelledAt"], { proposalId: id, proposalDigest: digest, reason: text, cancelledAt: timestamp }),
  ProposalConfirmedAndExecuted: object(["proposalId", "proposalDigest", "semanticDiffDigest", "streamExpectations", "executedBy", "executedAt"], { proposalId: id, proposalDigest: digest, semanticDiffDigest: digest, streamExpectations: array(looseObject, { minItems: 1 }), executedBy: actor, executedAt: timestamp }),
};

function commandVariant(type: CommandType): JsonSchema {
  return object(
    ["schemaVersion", "commandId", "type", "streamId", "expectedStreamVersion", "actor", "idempotencyKey", "correlationId", "causationId", "issuedAt", "payload"],
    {
      schemaVersion: { const: SCHEMA_VERSIONS.command },
      commandId: id,
      type: { const: type },
      streamId: id,
      expectedStreamVersion: version,
      actor,
      idempotencyKey: id,
      correlationId: id,
      causationId: id,
      issuedAt: timestamp,
      payload: payloadSchemas[type],
    },
  );
}

function eventVariant(type: EventType): JsonSchema {
  return object(
    ["schemaVersion", "eventId", "type", "streamId", "streamVersion", "occurredAt", "actor", "commandId", "idempotencyKey", "correlationId", "causationId", "payload"],
    {
      schemaVersion: { const: SCHEMA_VERSIONS.event },
      eventId: id,
      type: { const: type },
      streamId: id,
      streamVersion: { type: "integer", minimum: 1 },
      occurredAt: timestamp,
      actor,
      commandId: id,
      idempotencyKey: id,
      correlationId: id,
      causationId: id,
      payload: eventPayloadSchemas[type],
    },
  );
}

const streamExpectation = object(["streamId", "expectedStreamVersion"], { streamId: id, expectedStreamVersion: version });
const continuationOffer = object(["continuationId", "title", "description"], { continuationId: id, title: text, description: text });
const evidenceDraft = object(
  ["submissionId", "narrative", "artifacts", "submittedByRootIdentityId", "submittedAt"],
  { submissionId: id, narrative: text, artifacts: array(artifactReference), submittedByRootIdentityId: id, submittedAt: timestamp },
);
const closedEvidenceBundle = object(
  ["taskId", "submissionId", "cycle", "narrative", "artifacts", "authorRootIdentityId", "closedAt", "digest"],
  { taskId: id, submissionId: id, cycle: { type: "integer", minimum: 1 }, narrative: text, artifacts: array(artifactReference), authorRootIdentityId: id, closedAt: timestamp, digest },
);
const deterministicAppeal = object(
  ["appealId", "cycle", "evidenceDigest", "filedByRootIdentityId", "grounds", "filedAt", "status", "resolvedByRootIdentityId", "reviewerCredentialId", "conflictDisclosureId", "reasons", "resolvedAt"],
  { appealId: id, cycle: { type: "integer", minimum: 1 }, evidenceDigest: digest, filedByRootIdentityId: id, grounds: text, filedAt: timestamp, status: { enum: ["pending", "upheld", "overturned"] }, resolvedByRootIdentityId: nullable(id), reviewerCredentialId: nullable(id), conflictDisclosureId: nullable(id), reasons: array(text), resolvedAt: nullable(timestamp) },
);
const evidenceCycle = object(
  ["cycle", "status", "draft", "closedBundle", "rejectionReasons", "deterministicAppeal"],
  {
    cycle: { type: "integer", minimum: 1 },
    status: { enum: ["draft", "closed", "rejected", "accepted"] },
    draft: nullable({ $ref: "#/$defs/EvidenceDraft" }),
    closedBundle: nullable({ $ref: "#/$defs/ClosedEvidenceBundle" }),
    rejectionReasons: array(text),
    deterministicAppeal: nullable({ $ref: "#/$defs/DeterministicAppeal" }),
  },
);
const reviewContractState = object(
  ["reviewContractId", "taskId", "submissionId", "evidenceDigest", "policyVersion", "deterministicGate", "openingBasis", "appealId", "assignmentSeedCommitment", "assignments", "quorum", "maxReassignments", "reassignmentsUsed", "expiresAt", "status", "resolution", "attestations", "quorumDigest"],
  {
    reviewContractId: id,
    taskId: id,
    submissionId: id,
    evidenceDigest: digest,
    policyVersion: id,
    deterministicGate,
    openingBasis: { enum: ["deterministic-pass", "appeal-overturn"] },
    appealId: nullable(id),
    assignmentSeedCommitment: digest,
    assignments: array(reviewAssignment),
    quorum: { type: "integer", minimum: 1 },
    maxReassignments: { type: "integer", minimum: 0, maximum: 20 },
    reassignmentsUsed: { type: "integer", minimum: 0, maximum: 20 },
    expiresAt: timestamp,
    status: { enum: ["collecting", "approved", "rejected", "inconclusive", "human_escalation"] },
    resolution: nullable({ enum: ["approved", "rejected", "inconclusive", "human_escalation"] }),
    attestations: array(reviewAttestation),
    quorumDigest: nullable(digest),
  },
);
const settlementRecord = object(
  ["intent", "committedAt", "transactionId"],
  { intent: settlementIntent, committedAt: timestamp, transactionId: id },
);
const taskState = object(
  ["taskId", "projectId", "title", "description", "proofRequirement", "dependencyIds", "ownerRootIdentityId", "status", "evidenceCycles", "activeEvidenceCycle", "reviewContract", "settlement", "rejectionStage", "completedAt"],
  {
    taskId: id,
    projectId: id,
    title: text,
    description: text,
    proofRequirement: text,
    dependencyIds: array(id, { uniqueItems: true }),
    ownerRootIdentityId: nullable(id),
    status: { enum: ["open", "active", "submitted", "evidence_closed", "review_pending", "rejected", "deterministic_appeal_pending", "accepted_pending_settlement", "settled", "completed"] },
    evidenceCycles: array({ $ref: "#/$defs/EvidenceCycle" }),
    activeEvidenceCycle: { type: "integer", minimum: 1 },
    reviewContract: nullable({ $ref: "#/$defs/ReviewContractState" }),
    settlement: nullable({ $ref: "#/$defs/SettlementRecord" }),
    rejectionStage: nullable({ enum: ["deterministic", "independent"] }),
    completedAt: nullable(timestamp),
  },
);
const projectTaskNode = object(
  ["taskId", "taskStreamId", "dependencyIds", "ordinal"],
  { taskId: id, taskStreamId: id, dependencyIds: array(id, { uniqueItems: true }), ordinal: { type: "integer", minimum: 0 } },
);
const projectState = object(
  ["projectId", "title", "description", "status", "chapter", "taskOrder", "continuationOffers"],
  { projectId: id, title: text, description: text, status: { enum: ["active", "completed"] }, chapter: { type: "integer", minimum: 1 }, taskOrder: array(id, { uniqueItems: true }), continuationOffers: array(continuationOffer) },
);
const projectAggregate = object(
  ["aggregateType", "streamId", "version", "project", "taskGraph", "completedTaskIds"],
  {
    aggregateType: { const: "project" },
    streamId: id,
    version,
    project: nullable({ $ref: "#/$defs/Project" }),
    taskGraph: { type: "object", additionalProperties: { $ref: "#/$defs/ProjectTaskNode" } },
    completedTaskIds: array(id, { uniqueItems: true }),
  },
);
const taskAggregate = object(
  ["aggregateType", "streamId", "version", "task"],
  { aggregateType: { const: "task" }, streamId: id, version, task: nullable({ $ref: "#/$defs/Task" }) },
);
const revocationRecord = object(
  ["revocationId", "targetType", "targetId", "reason", "revokedAt", "actor"],
  { revocationId: id, targetType: { enum: ["root", "device", "membership", "claim", "progression-receipt", "recovery-method", "stable-root-consent"] }, targetId: id, reason: text, revokedAt: timestamp, actor },
);
const pairwiseIdentity = object(["pairwiseId", "audience", "publicKey", "proof"], { pairwiseId: id, audience: text, publicKey: text, proof: text });
const stableRootDisclosure = object(["rootIdentityId", "consentReceiptId", "authorizedDeviceId", "consentIssuedAt", "consentExpiresAt", "reason"], { rootIdentityId: id, consentReceiptId: id, authorizedDeviceId: id, consentIssuedAt: timestamp, consentExpiresAt: timestamp, reason: text });
const passportPresentation = object(
  ["schemaVersion", "presentationId", "identityMode", "subjectId", "pairwiseIdentity", "stableRootDisclosure", "audience", "purpose", "issuedAt", "expiresAt", "rootIdentity", "devices", "memberships", "claims", "progressionReceipts", "proof"],
  {
    schemaVersion: { const: SCHEMA_VERSIONS.passportPresentation },
    presentationId: id,
    identityMode: { enum: ["pairwise", "stable-root"] },
    subjectId: id,
    pairwiseIdentity: nullable(pairwiseIdentity),
    stableRootDisclosure: nullable(stableRootDisclosure),
    audience: text,
    purpose: text,
    issuedAt: timestamp,
    expiresAt: timestamp,
    rootIdentity: nullable(rootIdentity),
    devices: array(deviceAuthorization),
    memberships: array(membership),
    claims: array(claim),
    progressionReceipts: array(progressionReceipt),
    proof: text,
  },
);
const passportAggregate = object(
  ["aggregateType", "streamId", "version", "rootIdentity", "devices", "memberships", "claims", "progressionReceipts", "recoveryMethods", "stableRootConsents", "revocations", "presentationDigests"],
  {
    aggregateType: { const: "passport" }, streamId: id, version, rootIdentity: nullable(rootIdentity),
    devices: { type: "object", additionalProperties: deviceAuthorization },
    memberships: { type: "object", additionalProperties: membership },
    claims: { type: "object", additionalProperties: claim },
    progressionReceipts: { type: "object", additionalProperties: progressionReceipt },
    recoveryMethods: { type: "object", additionalProperties: recoveryMethod },
    stableRootConsents: { type: "object", additionalProperties: stableRootConsent },
    revocations: array(revocationRecord), presentationDigests: array(digest),
  },
);
const formalProposal = object(
  ["proposalId", "status", "summary", "preparedBy", "operations", "streamExpectations", "semanticDiff", "semanticDiffDigest", "proposalDigest", "createdAt", "expiresAt", "executedBy", "executedAt", "cancelledAt"],
  {
    proposalId: id, status: { enum: ["pending", "executed", "cancelled"] }, summary: text,
    preparedBy: object(["kind", "identifier"], { kind: { enum: ["human", "model", "service"] }, identifier: id }),
    operations: array(proposedOperation, { minItems: 1 }), streamExpectations: array(streamExpectation, { minItems: 1 }),
    semanticDiff, semanticDiffDigest: digest, proposalDigest: digest, createdAt: timestamp, expiresAt: timestamp,
    executedBy: nullable(actor), executedAt: nullable(timestamp), cancelledAt: nullable(timestamp),
  },
);
const proposalAggregate = object(
  ["aggregateType", "streamId", "version", "proposal"],
  { aggregateType: { const: "proposal" }, streamId: id, version, proposal: nullable({ $ref: "#/$defs/FormalProposal" }) },
);
const eventPosition = object(["streamId", "streamVersion", "eventId"], { streamId: id, streamVersion: { type: "integer", minimum: 1 }, eventId: id });
const commandReceipt = object(
  ["schemaVersion", "receiptId", "commandId", "commandType", "idempotencyKey", "correlationId", "causationId", "actor", "status", "commandFingerprint", "eventPositions", "resultingStreamVersions", "createdAt", "replayed", "reasonCode", "requiresRepreview", "proposalId", "settlementId"],
  {
    schemaVersion: { const: SCHEMA_VERSIONS.receipt }, receiptId: id, commandId: id, commandType: { enum: [...COMMAND_TYPES] },
    idempotencyKey: id, correlationId: id, causationId: id, actor, status: { enum: ["executed", "cancelled", "not-executed"] },
    commandFingerprint: digest, eventPositions: array(eventPosition), resultingStreamVersions: array(streamExpectation, { minItems: 1 }),
    createdAt: timestamp, replayed: { type: "boolean" }, reasonCode: nullable(id), requiresRepreview: { type: "boolean" }, proposalId: nullable(id), settlementId: nullable(id),
  },
);

export const CONTRACT_SCHEMAS: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.cerbanimo.local/contracts/1.0.0",
  title: "Cerbanimo production contracts",
  description: "Packet 001 pure external contracts. No persistence or transport semantics are implied.",
  type: "object",
  properties: {
    schemaVersion: { const: SCHEMA_VERSIONS.catalog },
  },
  required: ["schemaVersion"],
  additionalProperties: false,
  $defs: {
    Actor: actor,
    ArtifactReference: artifactReference,
    TaskDefinition: taskDefinition,
    StreamExpectation: streamExpectation,
    ContinuationOffer: continuationOffer,
    EvidenceDraft: evidenceDraft,
    ClosedEvidenceBundle: closedEvidenceBundle,
    DeterministicAppeal: deterministicAppeal,
    EvidenceCycle: evidenceCycle,
    DeterministicProofGate: deterministicGate,
    HumanReviewCredential: humanReviewCredential,
    ConflictDisclosure: conflictDisclosure,
    ReviewAssignment: reviewAssignment,
    ReviewAttestation: reviewAttestation,
    ReviewContract: reviewContract,
    ReviewContractState: reviewContractState,
    SettlementEffects: settlementEffects,
    SettlementIntent: settlementIntent,
    SettlementRecord: settlementRecord,
    ProjectTaskNode: projectTaskNode,
    Project: projectState,
    ProjectAggregate: projectAggregate,
    Task: taskState,
    TaskAggregate: taskAggregate,
    SemanticDiff: semanticDiff,
    ProposedOperation: proposedOperation,
    RootIdentity: rootIdentity,
    DeviceAuthorization: deviceAuthorization,
    FederationMembership: membership,
    PassportClaim: claim,
    ProgressionReceipt: progressionReceipt,
    RecoveryMethod: recoveryMethod,
    StableRootConsent: stableRootConsent,
    RevocationRecord: revocationRecord,
    PairwiseIdentity: pairwiseIdentity,
    StableRootDisclosure: stableRootDisclosure,
    PassportPresentation: passportPresentation,
    PassportAggregate: passportAggregate,
    FormalProposal: formalProposal,
    ProposalAggregate: proposalAggregate,
    EventPosition: eventPosition,
    CommandReceipt: commandReceipt,
    CommandEnvelope: { oneOf: COMMAND_TYPES.map(commandVariant) },
    EventEnvelope: { oneOf: EVENT_TYPES.map(eventVariant) },
    ...Object.fromEntries(COMMAND_TYPES.map((type) => [`${type}Command`, commandVariant(type)])),
    ...Object.fromEntries(EVENT_TYPES.map((type) => [`${type}Event`, eventVariant(type)])),
  },
};

export const COMMAND_PAYLOAD_SCHEMAS = Object.freeze(payloadSchemas);
export const EVENT_PAYLOAD_SCHEMAS = Object.freeze(eventPayloadSchemas);
