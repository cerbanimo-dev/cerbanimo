import { commandFingerprint } from "../../.build/packages/commands/src/index.js";
import { SCHEMA_VERSIONS, digestJson } from "../../.build/packages/schemas/src/index.js";

let sequence = 0;

export const actor = Object.freeze({ kind: "service", serviceId: "storage_test", delegatedByRootIdentityId: "root_cami", roles: ["storage-test"] });

export function canonicalCommand(type, streamId, expectedStreamVersion, payload = {}, overrides = {}) {
  sequence += 1;
  return {
    schemaVersion: SCHEMA_VERSIONS.command,
    commandId: overrides.commandId ?? `cmd_storage_${sequence}`,
    type,
    streamId,
    expectedStreamVersion,
    actor: overrides.actor ?? actor,
    idempotencyKey: overrides.idempotencyKey ?? `idem_storage_${sequence}`,
    correlationId: overrides.correlationId ?? "corr_packet_002",
    causationId: overrides.causationId ?? "cause_packet_002",
    issuedAt: overrides.issuedAt ?? `2026-07-23T01:${String(sequence % 60).padStart(2, "0")}:00.000Z`,
    payload,
  };
}

export function eventFor(command, streamId, streamVersion, type, payload, suffix = type) {
  return {
    schemaVersion: SCHEMA_VERSIONS.event,
    eventId: `evt_${digestJson({ commandId: command.commandId, streamId, streamVersion, type, suffix }).slice(0, 32)}`,
    type,
    streamId,
    streamVersion,
    occurredAt: command.issuedAt,
    actor: command.actor,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    correlationId: command.correlationId,
    causationId: command.causationId,
    payload,
  };
}

export function receiptFor(command, events, options = {}) {
  const resulting = new Map();
  for (const event of events) resulting.set(event.streamId, event.streamVersion);
  if (resulting.size === 0) resulting.set(command.streamId, command.expectedStreamVersion);
  const fingerprint = commandFingerprint(command);
  const status = options.status ?? "executed";
  return {
    fingerprint,
    receipt: {
      schemaVersion: SCHEMA_VERSIONS.receipt,
      receiptId: `receipt_${digestJson({ commandId: command.commandId, fingerprint, status }).slice(0, 32)}`,
      commandId: command.commandId,
      commandType: command.type,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      causationId: command.causationId,
      actor: command.actor,
      status,
      commandFingerprint: fingerprint,
      eventPositions: events.map(({ streamId, streamVersion, eventId }) => ({ streamId, streamVersion, eventId })),
      resultingStreamVersions: [...resulting].sort(([left], [right]) => left.localeCompare(right)).map(([streamId, expectedStreamVersion]) => ({ streamId, expectedStreamVersion })),
      createdAt: command.issuedAt,
      replayed: false,
      reasonCode: options.reasonCode ?? null,
      requiresRepreview: options.requiresRepreview ?? false,
      proposalId: options.proposalId ?? null,
      settlementId: options.settlementId ?? null,
    },
  };
}

export function commitRequest(command, expectedStreams, eventBatches, options = {}) {
  const events = eventBatches.flatMap(({ events: batchEvents }) => batchEvents);
  const { fingerprint, receipt } = receiptFor(command, events, options.receipt);
  return {
    command,
    commandFingerprint: fingerprint,
    expectedStreams,
    eventBatches,
    receipt,
    projectionWrites: options.projectionWrites ?? [],
    outboxMessages: options.outboxMessages ?? [],
    additionalCommands: options.additionalCommands ?? [],
  };
}
