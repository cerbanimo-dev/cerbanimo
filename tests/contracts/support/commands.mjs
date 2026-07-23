import { SCHEMA_VERSIONS } from "../../../.build/packages/schemas/src/index.js";

let sequence = 0;

export const humanActor = Object.freeze({
  kind: "human",
  rootIdentityId: "root_cami",
  deviceId: "device_cami_primary",
  roles: ["steward"],
});

export const serviceActor = Object.freeze({
  kind: "service",
  serviceId: "service_settlement",
  delegatedByRootIdentityId: "root_cami",
  roles: ["settlement-worker"],
});

export function command(type, streamId, expectedStreamVersion, payload, overrides = {}) {
  sequence += 1;
  const commandId = overrides.commandId || `cmd_test_${sequence}`;
  return {
    schemaVersion: SCHEMA_VERSIONS.command,
    commandId,
    type,
    streamId,
    expectedStreamVersion,
    actor: overrides.actor || humanActor,
    idempotencyKey: overrides.idempotencyKey || `idem_test_${sequence}`,
    correlationId: overrides.correlationId || "corr_packet_001",
    causationId: overrides.causationId || "cause_packet_001",
    issuedAt: overrides.issuedAt || `2026-07-22T20:${String(sequence % 60).padStart(2, "0")}:00.000Z`,
    payload,
  };
}

export function expectAccepted(result) {
  if (!result.accepted) throw new Error(`Expected accepted command, received ${result.rejection.code}: ${result.rejection.message}`);
  return result;
}

export function expectRejected(result, code) {
  if (result.accepted) throw new Error(`Expected ${code} rejection, command was accepted`);
  if (result.rejection.code !== code) throw new Error(`Expected ${code}, received ${result.rejection.code}: ${result.rejection.message}`);
  return result;
}
