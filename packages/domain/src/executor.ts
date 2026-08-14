import { COMMAND_CATALOG, commandFingerprint, validateCommandEnvelope } from "../../commands/src/index.js";
import { materializeEvents, materializeEventsForStream, type EventDraft } from "../../events/src/index.js";
import {
  SCHEMA_VERSIONS,
  digestJson,
  type CanonicalCommand,
  type CommandReceipt,
  type CommandRejection,
  type CommandType,
  type ContinuationOffer,
  type DomainEvent,
  type JsonValue,
  type PassportAggregate,
  type ProjectAggregate,
  type ProposalAggregate,
  type StreamExpectation,
  type TaskAggregate,
  type TaskDefinition,
} from "../../schemas/src/index.js";
import { DomainError, reject } from "./errors.js";
import { decidePassportCommand, evolvePassport } from "./passport.js";
import { decideProjectCommand, evolveProject, graphDependents, projectWouldComplete } from "./project.js";
import { assertProposalConfirmationBinding, decideProposalCommand, evolveProposal } from "./proposal.js";
import { decideTaskCommand, evolveTask, taskCreatedDraft } from "./task.js";

export type AggregateState = ProjectAggregate | TaskAggregate | PassportAggregate | ProposalAggregate;

export type ExecutionResult<TState extends AggregateState = AggregateState> =
  | { accepted: true; replayed: boolean; state: TState; events: DomainEvent[]; receipt: CommandReceipt }
  | { accepted: false; replayed: false; state: TState; events: []; rejection: CommandRejection };

function rejection<TState extends AggregateState>(state: TState, error: unknown): ExecutionResult<TState> {
  if (error instanceof DomainError) return { accepted: false, replayed: false, state, events: [], rejection: error.rejection };
  return {
    accepted: false,
    replayed: false,
    state,
    events: [],
    rejection: { code: "INVALID_COMMAND", message: error instanceof Error ? error.message : String(error), details: {} },
  };
}

function rejectionValue(error: unknown): CommandRejection {
  if (error instanceof DomainError) return error.rejection;
  return { code: "INVALID_COMMAND", message: error instanceof Error ? error.message : String(error), details: {} };
}

function decide(state: AggregateState, command: CanonicalCommand): EventDraft<unknown>[] {
  switch (state.aggregateType) {
    case "project": return decideProjectCommand(state, command);
    case "task": return decideTaskCommand(state, command);
    case "passport": return decidePassportCommand(state, command);
    case "proposal": return decideProposalCommand(state, command);
  }
}

function evolve<TState extends AggregateState>(state: TState, events: DomainEvent[]): TState {
  return events.reduce<AggregateState>((current, event) => {
    switch (current.aggregateType) {
      case "project": return evolveProject(current, event);
      case "task": return evolveTask(current, event);
      case "passport": return evolvePassport(current, event);
      case "proposal": return evolveProposal(current, event);
    }
  }, state) as TState;
}

function resultingVersions(events: DomainEvent[], fallback: StreamExpectation): StreamExpectation[] {
  const versions = new Map<string, number>();
  for (const event of events) versions.set(event.streamId, event.streamVersion);
  if (versions.size === 0) versions.set(fallback.streamId, fallback.expectedStreamVersion);
  return [...versions].sort(([left], [right]) => left.localeCompare(right)).map(([streamId, expectedStreamVersion]) => ({ streamId, expectedStreamVersion }));
}

function receiptFor(
  command: CanonicalCommand,
  events: DomainEvent[],
  fingerprint: string,
  occurredAt: string,
  options: { status?: CommandReceipt["status"]; reasonCode?: string | null; requiresRepreview?: boolean; settlementId?: string | null } = {},
): CommandReceipt {
  const input = command.payload as Record<string, unknown>;
  const versions = resultingVersions(events, { streamId: command.streamId, expectedStreamVersion: command.expectedStreamVersion });
  return {
    schemaVersion: SCHEMA_VERSIONS.receipt,
    receiptId: `receipt_${digestJson({ commandId: command.commandId, fingerprint, versions, status: options.status ?? "executed" } as unknown as JsonValue).slice(0, 32)}`,
    commandId: command.commandId,
    commandType: command.type,
    idempotencyKey: command.idempotencyKey,
    correlationId: command.correlationId,
    causationId: command.causationId,
    actor: command.actor,
    status: options.status ?? (command.type === "CancelProposal" ? "cancelled" : "executed"),
    commandFingerprint: fingerprint,
    eventPositions: events.map(({ streamId, streamVersion, eventId }) => ({ streamId, streamVersion, eventId })),
    resultingStreamVersions: versions,
    createdAt: occurredAt,
    replayed: false,
    reasonCode: options.reasonCode ?? null,
    requiresRepreview: options.requiresRepreview ?? false,
    proposalId: typeof input.proposalId === "string" ? input.proposalId : null,
    settlementId: options.settlementId ?? (command.type === "SettleAcceptedTask" && input.intent && typeof input.intent === "object" ? String((input.intent as Record<string, unknown>).settlementId) : null),
  };
}

function assertIdempotency(command: CanonicalCommand, fingerprint: string, priorReceipt?: CommandReceipt): CommandReceipt | null {
  if (!priorReceipt) return null;
  if (priorReceipt.idempotencyKey !== command.idempotencyKey || priorReceipt.commandFingerprint !== fingerprint) {
    reject("IDEMPOTENCY_KEY_REUSE", "Idempotency key was previously used for a different canonical command", { idempotencyKey: command.idempotencyKey });
  }
  return { ...priorReceipt, replayed: true };
}

export function executeCommand<TState extends AggregateState>(
  state: TState,
  command: CanonicalCommand,
  options: { priorReceipt?: CommandReceipt; occurredAt?: string } = {},
): ExecutionResult<TState> {
  try {
    validateCommandEnvelope(command);
    if (command.streamId !== state.streamId) reject("INVALID_COMMAND", "Command stream does not match aggregate stream", { commandStreamId: command.streamId, aggregateStreamId: state.streamId });
    const definition = COMMAND_CATALOG[command.type as CommandType];
    if (definition.aggregate !== state.aggregateType) reject("INVALID_COMMAND", `${command.type} targets ${definition.aggregate}, not ${state.aggregateType}`);
    if (["CreateProject", "AddTask", "ContinueProject"].includes(command.type)) reject("INVALID_COMMAND", `${command.type} must use the atomic project/task-stream coordinator`);
    const fingerprint = commandFingerprint(command as CanonicalCommand<CommandType, unknown>);
    const replay = assertIdempotency(command, fingerprint, options.priorReceipt);
    if (replay) return { accepted: true, replayed: true, state, events: [], receipt: replay };
    if (command.expectedStreamVersion !== state.version) reject("STALE_STREAM_VERSION", "Expected stream version does not match canonical state", { expected: command.expectedStreamVersion, actual: state.version });
    const drafts = decide(state, command);
    const occurredAt = options.occurredAt || command.issuedAt;
    const events = materializeEvents(command, state.version, drafts, occurredAt);
    const next = evolve(state, events);
    return { accepted: true, replayed: false, state: next, events, receipt: receiptFor(command, events, fingerprint, occurredAt) };
  } catch (error) {
    return rejection(state, error);
  }
}

export type AtomicProjectCommandResult =
  | { accepted: true; replayed: boolean; projectState: ProjectAggregate; taskStates: Record<string, TaskAggregate>; events: DomainEvent[]; receipt: CommandReceipt }
  | { accepted: false; replayed: false; projectState: ProjectAggregate; taskStates: Record<string, TaskAggregate>; events: []; rejection: CommandRejection };

export function executeProjectCommandAtomically(
  projectState: ProjectAggregate,
  taskStates: Record<string, TaskAggregate>,
  command: CanonicalCommand,
  options: { priorReceipt?: CommandReceipt; occurredAt?: string } = {},
): AtomicProjectCommandResult {
  try {
    validateCommandEnvelope(command);
    if (!["CreateProject", "AddTask", "ContinueProject"].includes(command.type)) reject("INVALID_COMMAND", "This coordinator only creates project task streams");
    if (command.streamId !== projectState.streamId) reject("INVALID_COMMAND", "Command stream does not match project stream");
    const fingerprint = commandFingerprint(command as CanonicalCommand<CommandType, unknown>);
    const replay = assertIdempotency(command, fingerprint, options.priorReceipt);
    if (replay) return { accepted: true, replayed: true, projectState, taskStates, events: [], receipt: replay };
    if (command.expectedStreamVersion !== projectState.version) reject("STALE_STREAM_VERSION", "Project stream changed before task-stream creation", { expected: command.expectedStreamVersion, actual: projectState.version });
    const drafts = decideProjectCommand(projectState, command);
    const taskDrafts = drafts.filter(({ type }) => type === "TaskAdded");
    const projectId = projectState.project?.projectId ?? String((command.payload as Record<string, unknown>).projectId);
    const workingTasks = { ...taskStates };
    const occurredAt = options.occurredAt || command.issuedAt;
    const projectEvents = materializeEvents(command, projectState.version, drafts, occurredAt);
    const taskEvents: DomainEvent[] = [];
    for (const draft of taskDrafts) {
      const definition = (draft.payload as { task: TaskDefinition }).task;
      const streamId = `task:${definition.taskId}`;
      const target = workingTasks[streamId];
      if (!target || target.version !== 0 || target.task !== null) reject("CONFLICT", "New task stream must be supplied and uninitialized", { streamId });
      const created = materializeEventsForStream(command, streamId, 0, [taskCreatedDraft(definition, projectId, definition.dependencyIds.length === 0 ? "active" : "open")], occurredAt);
      workingTasks[streamId] = evolve(target, created);
      taskEvents.push(...created);
    }
    const allEvents = [...projectEvents, ...taskEvents];
    return {
      accepted: true,
      replayed: false,
      projectState: evolve(projectState, projectEvents),
      taskStates: workingTasks,
      events: allEvents,
      receipt: receiptFor(command, allEvents, fingerprint, occurredAt),
    };
  } catch (error) {
    return { accepted: false, replayed: false, projectState, taskStates, events: [], rejection: rejectionValue(error) };
  }
}

export type AtomicTaskFinalizationResult =
  | { accepted: true; replayed: boolean; taskState: TaskAggregate; projectState: ProjectAggregate; dependentTaskStates: Record<string, TaskAggregate>; events: DomainEvent[]; receipt: CommandReceipt }
  | { accepted: false; replayed: false; taskState: TaskAggregate; projectState: ProjectAggregate; dependentTaskStates: Record<string, TaskAggregate>; events: []; rejection: CommandRejection };

export function finalizeTaskAtomically(
  taskState: TaskAggregate,
  projectState: ProjectAggregate,
  dependentTaskStates: Record<string, TaskAggregate>,
  command: CanonicalCommand,
  options: { priorReceipt?: CommandReceipt; occurredAt?: string } = {},
): AtomicTaskFinalizationResult {
  try {
    validateCommandEnvelope(command);
    if (command.type !== "FinalizeCompletedTask") reject("INVALID_COMMAND", "Finalization coordinator requires FinalizeCompletedTask");
    if (command.streamId !== taskState.streamId) reject("INVALID_COMMAND", "Command stream does not match task stream");
    const fingerprint = commandFingerprint(command as CanonicalCommand<CommandType, unknown>);
    const replay = assertIdempotency(command, fingerprint, options.priorReceipt);
    if (replay) return { accepted: true, replayed: true, taskState, projectState, dependentTaskStates, events: [], receipt: replay };
    if (command.expectedStreamVersion !== taskState.version) reject("STALE_STREAM_VERSION", "Task stream changed before finalization", { expected: command.expectedStreamVersion, actual: taskState.version });
    const task = taskState.task;
    const project = projectState.project;
    if (!task || task.status !== "settled" || !task.settlement) reject("INVALID_TRANSITION", "Only a settled task can finalize");
    if (!project || task.projectId !== project.projectId) reject("NOT_FOUND", "Task and project streams do not share a project");
    const node = projectState.taskGraph[task.taskId];
    if (!node || node.taskStreamId !== taskState.streamId || projectState.completedTaskIds.includes(task.taskId)) reject("CONFLICT", "Project topology does not expose this incomplete task stream");
    const input = command.payload as Record<string, unknown>;
    const projectExpectation = input.projectExpectation as StreamExpectation;
    if (!projectExpectation || projectExpectation.streamId !== projectState.streamId || projectExpectation.expectedStreamVersion !== projectState.version) reject("STALE_STREAM_VERSION", "Project stream changed before finalization", { expected: projectExpectation?.expectedStreamVersion ?? -1, actual: projectState.version });
    const expectedDependents = graphDependents(projectState, task.taskId).sort((left, right) => left.taskStreamId.localeCompare(right.taskStreamId));
    const supplied = input.dependentTaskExpectations as StreamExpectation[];
    if (!Array.isArray(supplied) || supplied.length !== expectedDependents.length) reject("STALE_STREAM_VERSION", "Dependent stream set changed before finalization");
    const sortedSupplied = [...supplied].sort((left, right) => left.streamId.localeCompare(right.streamId));
    for (let index = 0; index < expectedDependents.length; index += 1) {
      const dependent = expectedDependents[index]!;
      const expectation = sortedSupplied[index]!;
      const state = dependentTaskStates[dependent.taskStreamId];
      if (expectation.streamId !== dependent.taskStreamId || !state || expectation.expectedStreamVersion !== state.version) reject("STALE_STREAM_VERSION", "A dependent task stream changed before finalization", { streamId: dependent.taskStreamId, expected: expectation.expectedStreamVersion, actual: state?.version ?? -1 });
      if (!state.task || state.task.taskId !== dependent.taskId || state.task.status !== "open") reject("INVALID_TRANSITION", "Dependent task is not open and activatable", { streamId: dependent.taskStreamId });
    }
    const completesProject = projectWouldComplete(projectState, task.taskId);
    const optionsInput = input.continuationOptions as ContinuationOffer[];
    if (!Array.isArray(optionsInput)) reject("INVALID_COMMAND", "continuationOptions must be an array");
    if (completesProject) {
      if (optionsInput.length !== 3 || new Set(optionsInput.map(({ continuationId }) => continuationId)).size !== 3) reject("INVALID_COMMAND", "Project completion requires exactly three distinct continuation horizons");
    } else if (optionsInput.length !== 0) {
      reject("INVALID_COMMAND", "Continuation horizons are only emitted at project completion");
    }
    const occurredAt = options.occurredAt || command.issuedAt;
    const taskEvents = materializeEventsForStream(command, taskState.streamId, taskState.version, [{ type: "TaskCompleted", payload: { taskId: task.taskId, completedAt: occurredAt, settlementId: task.settlement.intent.settlementId } }], occurredAt);
    const projectDrafts: EventDraft<unknown>[] = [{ type: "ProjectTaskCompleted", payload: { projectId: project.projectId, taskId: task.taskId, taskStreamId: taskState.streamId, completedAt: occurredAt } }];
    if (completesProject) {
      projectDrafts.push(
        { type: "ProjectCompleted", payload: { projectId: project.projectId, completedAt: occurredAt } },
        { type: "ContinuationOffered", payload: { projectId: project.projectId, options: structuredClone(optionsInput) } },
      );
    }
    const projectEvents = materializeEventsForStream(command, projectState.streamId, projectState.version, projectDrafts, occurredAt);
    const nextDependents = { ...dependentTaskStates };
    const dependentEvents: DomainEvent[] = [];
    for (const dependent of expectedDependents) {
      const state = dependentTaskStates[dependent.taskStreamId]!;
      const events = materializeEventsForStream(command, dependent.taskStreamId, state.version, [{ type: "TaskDependencyActivated", payload: { taskId: dependent.taskId, completedDependencyId: task.taskId } }], occurredAt);
      nextDependents[dependent.taskStreamId] = evolve(state, events);
      dependentEvents.push(...events);
    }
    const allEvents = [...taskEvents, ...projectEvents, ...dependentEvents];
    return {
      accepted: true,
      replayed: false,
      taskState: evolve(taskState, taskEvents),
      projectState: evolve(projectState, projectEvents),
      dependentTaskStates: nextDependents,
      events: allEvents,
      receipt: receiptFor(command, allEvents, fingerprint, occurredAt, { settlementId: task.settlement.intent.settlementId }),
    };
  } catch (error) {
    return { accepted: false, replayed: false, taskState, projectState, dependentTaskStates, events: [], rejection: rejectionValue(error) };
  }
}

export type AtomicProposalExecution =
  | { accepted: true; executed: boolean; proposalState: ProposalAggregate; targetStates: Record<string, AggregateState>; events: DomainEvent[]; receipt: CommandReceipt }
  | { accepted: false; executed: false; proposalState: ProposalAggregate; targetStates: Record<string, AggregateState>; events: []; rejection: CommandRejection };

export function confirmAndExecuteProposalAtomically(
  proposalState: ProposalAggregate,
  command: CanonicalCommand,
  targetStates: Record<string, AggregateState>,
  options: { priorReceipt?: CommandReceipt } = {},
): AtomicProposalExecution {
  try {
    validateCommandEnvelope(command);
    if (command.type !== "ConfirmAndExecuteProposal" || command.streamId !== proposalState.streamId) reject("INVALID_COMMAND", "Proposal coordinator requires its proposal stream");
    const fingerprint = commandFingerprint(command as CanonicalCommand<CommandType, unknown>);
    const replay = assertIdempotency(command, fingerprint, options.priorReceipt);
    if (replay) return { accepted: true, executed: replay.status === "executed", proposalState, targetStates, events: [], receipt: replay };
    if (command.expectedStreamVersion !== proposalState.version) reject("STALE_STREAM_VERSION", "Proposal stream changed before confirmation", { expected: command.expectedStreamVersion, actual: proposalState.version });
    const proposal = proposalState.proposal;
    if (!proposal) reject("NOT_FOUND", "Proposal does not exist");
    const confirmed = assertProposalConfirmationBinding(proposal, command);
    for (const expectation of confirmed) {
      const state = targetStates[expectation.streamId];
      if (!state || state.version !== expectation.expectedStreamVersion) {
        const receipt = receiptFor(command, [], fingerprint, command.issuedAt, { status: "not-executed", reasonCode: "STALE_STREAM_VERSION", requiresRepreview: true });
        return { accepted: true, executed: false, proposalState, targetStates, events: [], receipt };
      }
    }
    const working: Record<string, AggregateState> = { ...targetStates };
    const operationEvents: DomainEvent[] = [];
    for (const operation of proposal.operations) {
      const current = working[operation.streamId];
      if (!current) reject("NOT_FOUND", "Proposed operation target is unavailable", { streamId: operation.streamId });
      const derivedCommand: CanonicalCommand = {
        schemaVersion: SCHEMA_VERSIONS.command,
        commandId: `cmd_${digestJson({ proposalId: proposal.proposalId, operationId: operation.operationId }).slice(0, 32)}`,
        type: operation.commandType,
        streamId: operation.streamId,
        expectedStreamVersion: current.version,
        actor: command.actor,
        idempotencyKey: `${command.idempotencyKey}:${operation.operationId}`,
        correlationId: command.correlationId,
        causationId: command.commandId,
        issuedAt: command.issuedAt,
        payload: operation.payload,
      };
      const result = executeCommand(current, derivedCommand);
      if (!result.accepted) return { accepted: false, executed: false, proposalState, targetStates, events: [], rejection: result.rejection };
      working[operation.streamId] = result.state;
      operationEvents.push(...result.events);
    }
    const proposalEvents = materializeEventsForStream(command, proposalState.streamId, proposalState.version, [{
      type: "ProposalConfirmedAndExecuted",
      payload: { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest, semanticDiffDigest: proposal.semanticDiffDigest, streamExpectations: confirmed, executedBy: command.actor, executedAt: command.issuedAt },
    }], command.issuedAt);
    const allEvents = [...operationEvents, ...proposalEvents];
    return {
      accepted: true,
      executed: true,
      proposalState: evolve(proposalState, proposalEvents),
      targetStates: working,
      events: allEvents,
      receipt: receiptFor(command, allEvents, fingerprint, command.issuedAt),
    };
  } catch (error) {
    return { accepted: false, executed: false, proposalState, targetStates, events: [], rejection: rejectionValue(error) };
  }
}
