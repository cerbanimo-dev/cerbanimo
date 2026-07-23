export type Identifier = string;
export type IsoTimestamp = string;
export type Digest = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Actor =
  | {
      kind: "human";
      rootIdentityId: Identifier;
      deviceId: Identifier;
      roles: string[];
    }
  | {
      kind: "service";
      serviceId: Identifier;
      delegatedByRootIdentityId: Identifier;
      roles: string[];
    };

export interface StreamExpectation {
  streamId: Identifier;
  expectedStreamVersion: number;
}

export interface CanonicalCommand<TType extends string = string, TPayload = unknown> {
  schemaVersion: "cerbanimo.command/1.0.0";
  commandId: Identifier;
  type: TType;
  streamId: Identifier;
  expectedStreamVersion: number;
  actor: Actor;
  idempotencyKey: Identifier;
  correlationId: Identifier;
  causationId: Identifier;
  issuedAt: IsoTimestamp;
  payload: TPayload;
}

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  schemaVersion: "cerbanimo.event/1.0.0";
  eventId: Identifier;
  type: TType;
  streamId: Identifier;
  streamVersion: number;
  occurredAt: IsoTimestamp;
  actor: Actor;
  commandId: Identifier;
  idempotencyKey: Identifier;
  correlationId: Identifier;
  causationId: Identifier;
  payload: TPayload;
}

export type TaskStatus =
  | "open"
  | "active"
  | "submitted"
  | "evidence_closed"
  | "review_pending"
  | "rejected"
  | "deterministic_appeal_pending"
  | "accepted_pending_settlement"
  | "settled"
  | "completed";

export interface TaskDefinition {
  taskId: Identifier;
  title: string;
  description: string;
  proofRequirement: string;
  dependencyIds: Identifier[];
  ownerRootIdentityId: Identifier | null;
}

export interface Project {
  projectId: Identifier;
  title: string;
  description: string;
  status: "active" | "completed";
  chapter: number;
  taskOrder: Identifier[];
  continuationOffers: ContinuationOffer[];
}

export interface ArtifactReference {
  artifactId: Identifier;
  uri: string;
  mediaType: string;
  digest: Digest | null;
}

export interface EvidenceDraft {
  submissionId: Identifier;
  narrative: string;
  artifacts: ArtifactReference[];
  submittedByRootIdentityId: Identifier;
  submittedAt: IsoTimestamp;
}

export interface ClosedEvidenceBundle {
  taskId: Identifier;
  submissionId: Identifier;
  cycle: number;
  narrative: string;
  artifacts: ArtifactReference[];
  authorRootIdentityId: Identifier;
  closedAt: IsoTimestamp;
  digest: Digest;
}

export interface EvidenceCycle {
  cycle: number;
  status: "draft" | "closed" | "rejected" | "accepted";
  draft: EvidenceDraft | null;
  closedBundle: ClosedEvidenceBundle | null;
  rejectionReasons: string[];
  deterministicAppeal: DeterministicAppeal | null;
}

export interface DeterministicProofGate {
  policyVersion: string;
  evidenceDigest: Digest;
  decision: "pass" | "reject";
  checks: Array<{ checkId: string; passed: boolean; detail: string }>;
  resultCodes: string[];
  rejectionReasons: string[];
  evaluatedBy: Actor;
  evaluatedAt: IsoTimestamp;
}

export interface HumanReviewCredential {
  credentialId: Identifier;
  subjectRootIdentityId: Identifier;
  issuer: Identifier;
  role: "evidence-reviewer";
  scopes: Array<"independent-review" | "deterministic-appeal">;
  assuranceLevel: "substantial" | "high";
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  status: "active" | "revoked";
  proof: string;
}

export interface ConflictDisclosure {
  disclosureId: Identifier;
  reviewerRootIdentityId: Identifier;
  evidenceDigest: Digest;
  hasConflict: boolean;
  conflictTypes: string[];
  statement: string;
  disclosedAt: IsoTimestamp;
  signature: string;
}

export interface DeterministicAppeal {
  appealId: Identifier;
  cycle: number;
  evidenceDigest: Digest;
  filedByRootIdentityId: Identifier;
  grounds: string;
  filedAt: IsoTimestamp;
  status: "pending" | "upheld" | "overturned";
  resolvedByRootIdentityId: Identifier | null;
  reviewerCredentialId: Identifier | null;
  conflictDisclosureId: Identifier | null;
  reasons: string[];
  resolvedAt: IsoTimestamp | null;
}

export interface ReviewAssignment {
  reviewerRootIdentityId: Identifier;
  reviewerKind: "model" | "human";
  humanReviewCredential: HumanReviewCredential | null;
  conflictDisclosure: ConflictDisclosure | null;
  assignedAt: IsoTimestamp;
  assignmentProof: string;
  status: "assigned" | "returned" | "expired" | "revoked";
}

export interface ReviewAttestation {
  attestationId: Identifier;
  reviewContractId: Identifier;
  taskId: Identifier;
  submissionId: Identifier;
  evidenceDigest: Digest;
  reviewerRootIdentityId: Identifier;
  decision: "approve" | "reject";
  confidence: number;
  reasons: string[];
  policyVersion: string;
  signature: string;
  issuedAt: IsoTimestamp;
}

export interface ReviewContract {
  reviewContractId: Identifier;
  taskId: Identifier;
  submissionId: Identifier;
  evidenceDigest: Digest;
  policyVersion: string;
  deterministicGate: DeterministicProofGate;
  openingBasis: "deterministic-pass" | "appeal-overturn";
  appealId: Identifier | null;
  assignmentSeedCommitment: Digest;
  assignments: ReviewAssignment[];
  quorum: number;
  maxReassignments: number;
  reassignmentsUsed: number;
  expiresAt: IsoTimestamp;
  status: "collecting" | "approved" | "rejected" | "inconclusive" | "human_escalation";
  resolution: "approved" | "rejected" | "inconclusive" | "human_escalation" | null;
  attestations: ReviewAttestation[];
  quorumDigest: Digest | null;
}

export interface SettlementEffects {
  baseCurrency: Array<{ accountId: Identifier; currency: string; amount: number }>;
  xp: Array<{ accountId: Identifier; amount: number }>;
  skillXp: Array<{ accountId: Identifier; skillId: Identifier; amount: number }>;
  specimens: Array<{ specimenId: Identifier; name: string; glyph: string }>;
  other: Array<{ effectType: string; targetId: Identifier; value: JsonValue }>;
}

export interface SettlementIntent {
  settlementId: Identifier;
  taskId: Identifier;
  acceptedEvidenceDigest: Digest;
  policyVersion: string;
  reviewContractId: Identifier;
  quorumDigest: Digest;
  effects: SettlementEffects;
  idempotencyKey: Identifier;
}

export interface SettlementRecord {
  intent: SettlementIntent;
  committedAt: IsoTimestamp;
  transactionId: Identifier;
}

export interface ContinuationOffer {
  continuationId: Identifier;
  title: string;
  description: string;
}

export interface Task {
  taskId: Identifier;
  projectId: Identifier;
  title: string;
  description: string;
  proofRequirement: string;
  dependencyIds: Identifier[];
  ownerRootIdentityId: Identifier | null;
  status: TaskStatus;
  evidenceCycles: EvidenceCycle[];
  activeEvidenceCycle: number;
  reviewContract: ReviewContract | null;
  settlement: SettlementRecord | null;
  rejectionStage: "deterministic" | "independent" | null;
  completedAt: IsoTimestamp | null;
}

export interface ProjectTaskNode {
  taskId: Identifier;
  taskStreamId: Identifier;
  dependencyIds: Identifier[];
  ordinal: number;
}

export interface ProjectAggregate {
  aggregateType: "project";
  streamId: Identifier;
  version: number;
  project: Project | null;
  taskGraph: Record<Identifier, ProjectTaskNode>;
  completedTaskIds: Identifier[];
}

export interface TaskAggregate {
  aggregateType: "task";
  streamId: Identifier;
  version: number;
  task: Task | null;
}

export interface SemanticDiffEntry {
  operation: "add" | "replace" | "remove";
  path: string;
  beforeDigest: Digest | null;
  afterDigest: Digest | null;
  summary: string;
}

export interface SemanticDiff {
  schemaVersion: "cerbanimo.semantic-diff/1.0.0";
  entries: SemanticDiffEntry[];
}

export interface ProposedOperation {
  operationId: Identifier;
  commandType: string;
  streamId: Identifier;
  expectedStreamVersion: number;
  payload: JsonValue;
}

export interface FormalProposal {
  proposalId: Identifier;
  status: "pending" | "executed" | "cancelled";
  summary: string;
  preparedBy: { kind: "human" | "model" | "service"; identifier: Identifier };
  operations: ProposedOperation[];
  streamExpectations: StreamExpectation[];
  semanticDiff: SemanticDiff;
  semanticDiffDigest: Digest;
  proposalDigest: Digest;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  executedBy: Actor | null;
  executedAt: IsoTimestamp | null;
  cancelledAt: IsoTimestamp | null;
}

export interface ProposalAggregate {
  aggregateType: "proposal";
  streamId: Identifier;
  version: number;
  proposal: FormalProposal | null;
}

export interface RootIdentity {
  rootIdentityId: Identifier;
  publicKey: string;
  algorithm: "Ed25519";
  createdAt: IsoTimestamp;
  status: "active" | "revoked";
}

export interface DeviceAuthorization {
  deviceId: Identifier;
  publicKey: string;
  capabilities: string[];
  assuranceLevel: "standard" | "high";
  authorizedAt: IsoTimestamp;
  status: "active" | "revoked";
  revokedAt: IsoTimestamp | null;
}

export interface FederationMembership {
  membershipId: Identifier;
  federationId: Identifier;
  subjectRootIdentityId: Identifier;
  role: string;
  joinedAt: IsoTimestamp;
  status: "active" | "left" | "revoked";
  endedAt: IsoTimestamp | null;
}

export interface PassportClaim {
  claimId: Identifier;
  subjectRootIdentityId: Identifier;
  issuer: Identifier;
  claimType: string;
  value: JsonValue;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp | null;
  proof: string;
  status: "active" | "revoked" | "expired";
  revokedAt: IsoTimestamp | null;
}

export interface ProgressionReceipt {
  progressionReceiptId: Identifier;
  subjectRootIdentityId: Identifier;
  sourceNodeId: Identifier;
  settlementId: Identifier;
  effectsDigest: Digest;
  portableEffects: JsonValue;
  issuedAt: IsoTimestamp;
  proof: string;
  status: "active" | "revoked";
}

export interface RecoveryMethod {
  recoveryMethodId: Identifier;
  methodType: "recovery-key" | "trusted-contact" | "offline-code";
  publicMaterial: string;
  addedAt: IsoTimestamp;
  status: "active" | "revoked";
  revokedAt: IsoTimestamp | null;
}

export interface StableRootConsent {
  consentReceiptId: Identifier;
  rootIdentityId: Identifier;
  deviceId: Identifier;
  audience: string;
  purpose: string;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  status: "active" | "revoked" | "expired";
  proof: string;
  revokedAt: IsoTimestamp | null;
}

export interface RevocationRecord {
  revocationId: Identifier;
  targetType: "root" | "device" | "membership" | "claim" | "progression-receipt" | "recovery-method" | "stable-root-consent";
  targetId: Identifier;
  reason: string;
  revokedAt: IsoTimestamp;
  actor: Actor;
}

export interface PassportPresentation {
  schemaVersion: "cerbanimo.passport-presentation/1.0.0";
  presentationId: Identifier;
  identityMode: "pairwise" | "stable-root";
  subjectId: Identifier;
  pairwiseIdentity: {
    pairwiseId: Identifier;
    audience: string;
    publicKey: string;
    proof: string;
  } | null;
  stableRootDisclosure: {
    rootIdentityId: Identifier;
    consentReceiptId: Identifier;
    authorizedDeviceId: Identifier;
    consentIssuedAt: IsoTimestamp;
    consentExpiresAt: IsoTimestamp;
    reason: string;
  } | null;
  audience: string;
  purpose: string;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  rootIdentity: RootIdentity | null;
  devices: DeviceAuthorization[];
  memberships: FederationMembership[];
  claims: PassportClaim[];
  progressionReceipts: ProgressionReceipt[];
  proof: string;
}

export interface PassportAggregate {
  aggregateType: "passport";
  streamId: Identifier;
  version: number;
  rootIdentity: RootIdentity | null;
  devices: Record<Identifier, DeviceAuthorization>;
  memberships: Record<Identifier, FederationMembership>;
  claims: Record<Identifier, PassportClaim>;
  progressionReceipts: Record<Identifier, ProgressionReceipt>;
  recoveryMethods: Record<Identifier, RecoveryMethod>;
  stableRootConsents: Record<Identifier, StableRootConsent>;
  revocations: RevocationRecord[];
  presentationDigests: Digest[];
}

export interface EventPosition {
  streamId: Identifier;
  streamVersion: number;
  eventId: Identifier;
}

export interface CommandReceipt {
  schemaVersion: "cerbanimo.receipt/1.0.0";
  receiptId: Identifier;
  commandId: Identifier;
  commandType: string;
  idempotencyKey: Identifier;
  correlationId: Identifier;
  causationId: Identifier;
  actor: Actor;
  status: "executed" | "cancelled" | "not-executed";
  commandFingerprint: Digest;
  eventPositions: EventPosition[];
  resultingStreamVersions: StreamExpectation[];
  createdAt: IsoTimestamp;
  replayed: boolean;
  reasonCode: string | null;
  requiresRepreview: boolean;
  proposalId: Identifier | null;
  settlementId: Identifier | null;
}

export interface CommandRejection {
  code:
    | "INVALID_COMMAND"
    | "INVALID_TRANSITION"
    | "STALE_STREAM_VERSION"
    | "IDEMPOTENCY_KEY_REUSE"
    | "PROPOSAL_BINDING_MISMATCH"
    | "SEALED_HISTORY"
    | "EVIDENCE_DIGEST_MISMATCH"
    | "REVIEW_POLICY_VIOLATION"
    | "REVIEW_INCONCLUSIVE"
    | "REVIEW_REASSIGNMENT_LIMIT"
    | "REVIEWER_INELIGIBLE"
    | "APPEAL_ALREADY_USED"
    | "SETTLEMENT_MISMATCH"
    | "PASSPORT_CUSTODY_VIOLATION"
    | "CONSENT_INVALID"
    | "AUTHENTICATION_FAILED"
    | "PASSPHRASE_INVALID"
    | "NOT_FOUND"
    | "CONFLICT";
  message: string;
  details: Record<string, JsonValue>;
}
