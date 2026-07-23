import {
  digestJson,
  type CanonicalCommand,
  type FormalProposal,
  type JsonValue,
  type ProposalAggregate,
  type ProposedOperation,
  type SemanticDiff,
  type StreamExpectation,
} from "../../schemas/src/index.js";
import type { EventDraft } from "../../events/src/index.js";
import { reject } from "./errors.js";

type Payload = Record<string, unknown>;

function payload(command: CanonicalCommand): Payload {
  return command.payload as Payload;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) reject("INVALID_COMMAND", `${field} is required`, { field });
  return value;
}

export function sameExpectations(left: StreamExpectation[], right: StreamExpectation[]): boolean {
  const normalize = (items: StreamExpectation[]) => [...items]
    .sort((a, b) => a.streamId.localeCompare(b.streamId))
    .map(({ streamId, expectedStreamVersion }) => `${streamId}@${expectedStreamVersion}`);
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function assertNoSecretProposalPayload(value: unknown, path = "operation.payload"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretProposalPayload(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (["privatekey", "rootprivatekey", "secretkey", "mnemonic", "seedphrase"].includes(normalized)) {
      reject("PASSPORT_CUSTODY_VIOLATION", "Proposal payloads cannot carry private key or recovery secrets", { path: `${path}.${key}` });
    }
    assertNoSecretProposalPayload(child, `${path}.${key}`);
  }
}

export function emptyProposalAggregate(streamId: string): ProposalAggregate {
  return { aggregateType: "proposal", streamId, version: 0, proposal: null };
}

export function deriveSemanticDiffDigest(semanticDiff: SemanticDiff): string {
  return digestJson(semanticDiff as unknown as JsonValue);
}

export function proposalDigestMaterial(input: {
  proposalId: string;
  summary: string;
  preparedBy: FormalProposal["preparedBy"];
  operations: ProposedOperation[];
  streamExpectations: StreamExpectation[];
  semanticDiffDigest: string;
  createdAt: string;
  expiresAt: string;
}): JsonValue {
  return {
    proposalId: input.proposalId,
    summary: input.summary,
    preparedBy: input.preparedBy,
    operations: input.operations,
    streamExpectations: [...input.streamExpectations].sort((left, right) => left.streamId.localeCompare(right.streamId)),
    semanticDiffDigest: input.semanticDiffDigest,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  } as unknown as JsonValue;
}

export function deriveProposalDigest(input: Parameters<typeof proposalDigestMaterial>[0]): string {
  return digestJson(proposalDigestMaterial(input));
}

export function assertProposalConfirmationBinding(proposal: FormalProposal, command: CanonicalCommand): StreamExpectation[] {
  const input = payload(command);
  if (proposal.status !== "pending") reject("INVALID_TRANSITION", `Cannot confirm and execute a ${proposal.status} proposal`);
  if (command.actor.kind !== "human") reject("PROPOSAL_BINDING_MISMATCH", "Only a human actor can confirm a proposal");
  if (input.proposalId !== proposal.proposalId || input.proposalDigest !== proposal.proposalDigest || input.semanticDiffDigest !== proposal.semanticDiffDigest) {
    reject("PROPOSAL_BINDING_MISMATCH", "Confirmation does not bind to the exact proposal and semantic diff the person saw");
  }
  const confirmed = input.confirmedStreamExpectations as StreamExpectation[];
  if (!Array.isArray(confirmed) || !sameExpectations(confirmed, proposal.streamExpectations)) {
    reject("PROPOSAL_BINDING_MISMATCH", "Confirmed stream versions differ from the displayed proposal");
  }
  if (Date.parse(command.issuedAt) > Date.parse(proposal.expiresAt)) reject("INVALID_TRANSITION", "Proposal has expired");
  return confirmed;
}

function decideRecord(command: CanonicalCommand, state: ProposalAggregate): EventDraft<unknown>[] {
  if (state.proposal) reject("CONFLICT", "Proposal stream is already initialized");
  const input = payload(command);
  const operations = input.operations as ProposedOperation[];
  const streamExpectations = input.streamExpectations as StreamExpectation[];
  const semanticDiff = input.semanticDiff as SemanticDiff;
  if (!Array.isArray(operations) || operations.length === 0 || !Array.isArray(streamExpectations) || streamExpectations.length === 0) reject("INVALID_COMMAND", "Proposal needs operations and stream expectations");
  if (!semanticDiff || semanticDiff.schemaVersion !== "cerbanimo.semantic-diff/1.0.0" || semanticDiff.entries.length === 0) reject("INVALID_COMMAND", "Proposal needs a versioned non-empty semantic diff");
  if (new Set(streamExpectations.map(({ streamId }) => streamId)).size !== streamExpectations.length) reject("INVALID_COMMAND", "Proposal stream expectations must be unique");
  if (new Set(operations.map(({ operationId }) => operationId)).size !== operations.length) reject("INVALID_COMMAND", "Proposal operation IDs must be unique");
  for (const operation of operations) {
    assertNoSecretProposalPayload(operation.payload);
    const expectation = streamExpectations.find(({ streamId }) => streamId === operation.streamId);
    if (!expectation || expectation.expectedStreamVersion !== operation.expectedStreamVersion) reject("PROPOSAL_BINDING_MISMATCH", "Every operation must bind to its target stream version", { operationId: operation.operationId });
    if (["RecordProposal", "ConfirmAndExecuteProposal", "CancelProposal"].includes(operation.commandType)) reject("INVALID_COMMAND", "Proposal commands cannot recursively propose proposal lifecycle commands");
  }
  const semanticDiffDigest = deriveSemanticDiffDigest(semanticDiff);
  if (input.semanticDiffDigest !== semanticDiffDigest) reject("PROPOSAL_BINDING_MISMATCH", "Semantic diff digest does not match the displayed diff");
  const material = {
    proposalId: requiredText(input.proposalId, "proposalId"),
    summary: requiredText(input.summary, "summary"),
    preparedBy: input.preparedBy as FormalProposal["preparedBy"],
    operations,
    streamExpectations,
    semanticDiffDigest,
    createdAt: command.issuedAt,
    expiresAt: requiredText(input.expiresAt, "expiresAt"),
  };
  const proposalDigest = deriveProposalDigest(material);
  if (input.proposalDigest !== proposalDigest) reject("PROPOSAL_BINDING_MISMATCH", "Proposal digest does not match proposal content, diff, and versions");
  const proposal: FormalProposal = {
    ...material,
    semanticDiff,
    proposalDigest,
    status: "pending",
    executedBy: null,
    executedAt: null,
    cancelledAt: null,
  };
  return [{ type: "ProposalRecorded", payload: { proposal } }];
}

export function decideProposalCommand(state: ProposalAggregate, command: CanonicalCommand): EventDraft<unknown>[] {
  if (command.type === "RecordProposal") return decideRecord(command, state);
  const proposal = state.proposal;
  if (!proposal) reject("NOT_FOUND", "Proposal does not exist");
  const input = payload(command);
  if (input.proposalId !== proposal.proposalId || input.proposalDigest !== proposal.proposalDigest) reject("PROPOSAL_BINDING_MISMATCH", "Command does not bind to the exact proposal");
  switch (command.type) {
    case "CancelProposal":
      if (proposal.status !== "pending") reject("INVALID_TRANSITION", `Cannot cancel a ${proposal.status} proposal`);
      return [{ type: "ProposalCancelled", payload: { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest, reason: requiredText(input.reason, "reason"), cancelledAt: command.issuedAt } }];
    case "ConfirmAndExecuteProposal":
      reject("INVALID_COMMAND", "ConfirmAndExecuteProposal must use the atomic proposal coordinator");
    default:
      reject("INVALID_COMMAND", `${command.type} is not a proposal command`);
  }
}

export function evolveProposal(state: ProposalAggregate, event: { type: string; streamVersion: number; payload: unknown }): ProposalAggregate {
  const next = structuredClone(state);
  const input = event.payload as Payload;
  switch (event.type) {
    case "ProposalRecorded":
      next.proposal = input.proposal as FormalProposal;
      break;
    case "ProposalCancelled":
      next.proposal!.status = "cancelled";
      next.proposal!.cancelledAt = input.cancelledAt as string;
      break;
    case "ProposalConfirmedAndExecuted":
      next.proposal!.status = "executed";
      next.proposal!.executedBy = input.executedBy as FormalProposal["executedBy"];
      next.proposal!.executedAt = input.executedAt as string;
      break;
  }
  next.version = event.streamVersion;
  return next;
}
