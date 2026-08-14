import {
  COMMAND_TYPES,
  SCHEMA_VERSIONS,
  canonicalJson,
  digestJson,
  type CanonicalCommand,
  type CommandType,
  type JsonValue,
} from "../../schemas/src/index.js";
import { COMMAND_CATALOG } from "./catalog.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
}

export function validateCommandEnvelope(value: unknown): asserts value is CanonicalCommand<CommandType, JsonValue> {
  if (!isRecord(value)) throw new Error("Command must be an object");
  if (value.schemaVersion !== SCHEMA_VERSIONS.command) throw new Error(`Unsupported command schema: ${String(value.schemaVersion)}`);
  if (!COMMAND_TYPES.includes(value.type as CommandType)) throw new Error(`Unknown command type: ${String(value.type)}`);
  requiredString(value.commandId, "commandId");
  requiredString(value.streamId, "streamId");
  requiredString(value.idempotencyKey, "idempotencyKey");
  requiredString(value.correlationId, "correlationId");
  requiredString(value.causationId, "causationId");
  requiredString(value.issuedAt, "issuedAt");
  if (!Number.isInteger(value.expectedStreamVersion) || Number(value.expectedStreamVersion) < 0) {
    throw new Error("expectedStreamVersion must be a non-negative integer");
  }
  if (!isRecord(value.actor)) throw new Error("actor is required");
  if (value.actor.kind !== "human" && value.actor.kind !== "service") throw new Error("Models cannot be canonical command actors");
  const definition = COMMAND_CATALOG[value.type as CommandType];
  if (!definition.allowedActorKinds.includes(value.actor.kind)) throw new Error(`${String(value.type)} does not allow actor kind ${String(value.actor.kind)}`);
  if (value.actor.kind === "human") {
    requiredString(value.actor.rootIdentityId, "actor.rootIdentityId");
    requiredString(value.actor.deviceId, "actor.deviceId");
  } else {
    requiredString(value.actor.serviceId, "actor.serviceId");
    requiredString(value.actor.delegatedByRootIdentityId, "actor.delegatedByRootIdentityId");
  }
  if (!Array.isArray(value.actor.roles)) throw new Error("actor.roles must be an array");
  if (!isRecord(value.payload)) throw new Error("payload must be an object");
}

export function commandFingerprint(command: CanonicalCommand<CommandType, unknown>): string {
  return digestJson({
    schemaVersion: command.schemaVersion,
    commandId: command.commandId,
    type: command.type,
    streamId: command.streamId,
    expectedStreamVersion: command.expectedStreamVersion,
    actor: command.actor,
    idempotencyKey: command.idempotencyKey,
    correlationId: command.correlationId,
    causationId: command.causationId,
    issuedAt: command.issuedAt,
    payload: command.payload,
  } as JsonValue);
}

export function canonicalCommandJson(command: CanonicalCommand<CommandType, unknown>): string {
  validateCommandEnvelope(command);
  return canonicalJson(command as unknown as JsonValue);
}
