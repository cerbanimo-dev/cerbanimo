import {
  EVENT_TYPES,
  SCHEMA_VERSIONS,
  digestJson,
  type CanonicalCommand,
  type DomainEvent,
  type EventType,
  type JsonValue,
} from "../../schemas/src/index.js";

export interface EventDraft<TPayload = JsonValue> {
  type: EventType;
  payload: TPayload;
}

export function materializeEvents(
  command: CanonicalCommand,
  startingStreamVersion: number,
  drafts: ReadonlyArray<EventDraft<unknown>>,
  occurredAt: string,
): DomainEvent<EventType, unknown>[] {
  return materializeEventsForStream(command, command.streamId, startingStreamVersion, drafts, occurredAt);
}

export function materializeEventsForStream(
  command: CanonicalCommand,
  streamId: string,
  startingStreamVersion: number,
  drafts: ReadonlyArray<EventDraft<unknown>>,
  occurredAt: string,
): DomainEvent<EventType, unknown>[] {
  return drafts.map((draft, index) => {
    const streamVersion = startingStreamVersion + index + 1;
    const eventId = `evt_${digestJson({
      commandId: command.commandId,
      streamId,
      streamVersion,
      type: draft.type,
      payload: draft.payload,
    } as JsonValue).slice(0, 32)}`;
    return {
      schemaVersion: SCHEMA_VERSIONS.event,
      eventId,
      type: draft.type,
      streamId,
      streamVersion,
      occurredAt,
      actor: command.actor,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      causationId: command.causationId,
      payload: draft.payload,
    };
  });
}

export function validateEventEnvelope(value: unknown): asserts value is DomainEvent<EventType, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Event must be an object");
  const event = value as Record<string, unknown>;
  if (event.schemaVersion !== SCHEMA_VERSIONS.event) throw new Error(`Unsupported event schema: ${String(event.schemaVersion)}`);
  if (!EVENT_TYPES.includes(event.type as EventType)) throw new Error(`Unknown event type: ${String(event.type)}`);
  for (const field of ["eventId", "streamId", "occurredAt", "commandId", "idempotencyKey", "correlationId", "causationId"] as const) {
    if (typeof event[field] !== "string" || event[field].length === 0) throw new Error(`${field} is required`);
  }
  if (!Number.isInteger(event.streamVersion) || Number(event.streamVersion) < 1) throw new Error("streamVersion must be a positive integer");
  if (!event.actor || typeof event.actor !== "object") throw new Error("event actor is required");
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new Error("event payload must be an object");
}
