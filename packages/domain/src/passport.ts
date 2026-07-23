import {
  SCHEMA_VERSIONS,
  digestJson,
  type CanonicalCommand,
  type DeviceAuthorization,
  type FederationMembership,
  type JsonValue,
  type PassportAggregate,
  type PassportClaim,
  type PassportPresentation,
  type ProgressionReceipt,
  type RecoveryMethod,
  type RevocationRecord,
  type RootIdentity,
  type StableRootConsent,
} from "../../schemas/src/index.js";
import type { EventDraft } from "../../events/src/index.js";
import { reject } from "./errors.js";

type Payload = Record<string, unknown>;
const STABLE_ROOT_CONSENT_MAX_TTL_MS = 15 * 60 * 1000;

function payload(command: CanonicalCommand): Payload {
  return command.payload as Payload;
}

function actorRootId(command: CanonicalCommand): string {
  return command.actor.kind === "human" ? command.actor.rootIdentityId : command.actor.delegatedByRootIdentityId;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) reject("INVALID_COMMAND", `${field} is required`, { field });
  return value;
}

function assertNoPrivateMaterial(value: unknown, path = "payload"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateMaterial(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (["privatekey", "rootprivatekey", "secretkey", "mnemonic", "seedphrase", "ciphertext"].includes(normalized)) {
      reject("PASSPORT_CUSTODY_VIOLATION", `Private key or secret material is forbidden in passport contracts at ${path}.${key}`, { path: `${path}.${key}` });
    }
    assertNoPrivateMaterial(child, `${path}.${key}`);
  }
}

function assertRootActive(state: PassportAggregate, command: CanonicalCommand): RootIdentity {
  const root = state.rootIdentity;
  if (!root) reject("NOT_FOUND", "Passport root identity is not registered");
  if (root.status !== "active") reject("INVALID_TRANSITION", "Passport root identity is revoked");
  if (actorRootId(command) !== root.rootIdentityId) reject("PASSPORT_CUSTODY_VIOLATION", "Command actor is not the passport root controller");
  return root;
}

function revocation(command: CanonicalCommand, revocationId: string, targetType: RevocationRecord["targetType"], targetId: string, reason: string): RevocationRecord {
  return { revocationId, targetType, targetId, reason, revokedAt: command.issuedAt, actor: command.actor };
}

export function emptyPassportAggregate(streamId: string): PassportAggregate {
  return {
    aggregateType: "passport",
    streamId,
    version: 0,
    rootIdentity: null,
    devices: {},
    memberships: {},
    claims: {},
    progressionReceipts: {},
    recoveryMethods: {},
    stableRootConsents: {},
    revocations: [],
    presentationDigests: [],
  };
}

function selectActive<T extends { status: string }>(collection: Record<string, T>, ids: unknown, field: string): T[] {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) reject("INVALID_COMMAND", `${field} must contain unique IDs`);
  return ids.map((rawId) => {
    const item = collection[String(rawId)];
    if (!item || item.status !== "active") reject("NOT_FOUND", `${field} contains an unavailable item`, { id: String(rawId) });
    return structuredClone(item);
  });
}

export function decidePassportCommand(state: PassportAggregate, command: CanonicalCommand): EventDraft<unknown>[] {
  const input = payload(command);
  assertNoPrivateMaterial(input);
  switch (command.type) {
    case "RegisterRootIdentity": {
      if (state.rootIdentity) reject("CONFLICT", "Passport root identity is already registered");
      const rootIdentity = input.rootIdentity as RootIdentity;
      if (!rootIdentity || rootIdentity.algorithm !== "Ed25519" || rootIdentity.status !== "active") reject("INVALID_COMMAND", "Root identity must contain active Ed25519 public material");
      requiredText(rootIdentity.publicKey, "rootIdentity.publicKey");
      if (command.actor.kind !== "human" || command.actor.rootIdentityId !== rootIdentity.rootIdentityId) reject("PASSPORT_CUSTODY_VIOLATION", "Only the person controlling the root identity may register it");
      return [{ type: "PassportRootRegistered", payload: { rootIdentity } }];
    }
    case "AuthorizeDevice": {
      assertRootActive(state, command);
      const device = input.device as DeviceAuthorization;
      if (!device || device.status !== "active" || device.revokedAt !== null) reject("INVALID_COMMAND", "A new device authorization must be active and unrevoked");
      if (state.devices[device.deviceId]) reject("CONFLICT", "Device is already represented", { deviceId: device.deviceId });
      requiredText(device.publicKey, "device.publicKey");
      return [{ type: "DeviceAuthorized", payload: { device } }];
    }
    case "RevokeDevice": {
      assertRootActive(state, command);
      const deviceId = requiredText(input.deviceId, "deviceId");
      const device = state.devices[deviceId];
      if (!device || device.status !== "active") reject("NOT_FOUND", "Active device does not exist", { deviceId });
      const record = revocation(command, requiredText(input.revocationId, "revocationId"), "device", deviceId, requiredText(input.reason, "reason"));
      return [{ type: "DeviceRevoked", payload: { deviceId, revokedAt: command.issuedAt, revocation: record } }];
    }
    case "JoinMembership": {
      const root = assertRootActive(state, command);
      const membership = input.membership as FederationMembership;
      if (!membership || membership.subjectRootIdentityId !== root.rootIdentityId || membership.status !== "active" || membership.endedAt !== null) reject("PASSPORT_CUSTODY_VIOLATION", "Membership must target the active root identity");
      if (state.memberships[membership.membershipId]) reject("CONFLICT", "Membership is already represented");
      return [{ type: "MembershipJoined", payload: { membership } }];
    }
    case "LeaveMembership": {
      assertRootActive(state, command);
      const membershipId = requiredText(input.membershipId, "membershipId");
      const membership = state.memberships[membershipId];
      if (!membership || membership.status !== "active") reject("NOT_FOUND", "Active membership does not exist", { membershipId });
      return [{ type: "MembershipLeft", payload: { membershipId, reason: requiredText(input.reason, "reason"), endedAt: command.issuedAt } }];
    }
    case "IssueClaim": {
      const root = assertRootActive(state, command);
      const claim = input.claim as PassportClaim;
      if (!claim || claim.subjectRootIdentityId !== root.rootIdentityId || claim.status !== "active" || claim.revokedAt !== null) reject("INVALID_COMMAND", "Claim must target the active root identity");
      if (state.claims[claim.claimId]) reject("CONFLICT", "Claim is already represented");
      requiredText(claim.proof, "claim.proof");
      return [{ type: "ClaimIssued", payload: { claim } }];
    }
    case "RevokeClaim": {
      assertRootActive(state, command);
      const claimId = requiredText(input.claimId, "claimId");
      const claim = state.claims[claimId];
      if (!claim || claim.status !== "active") reject("NOT_FOUND", "Active claim does not exist", { claimId });
      const record = revocation(command, requiredText(input.revocationId, "revocationId"), "claim", claimId, requiredText(input.reason, "reason"));
      return [{ type: "ClaimRevoked", payload: { claimId, revokedAt: command.issuedAt, revocation: record } }];
    }
    case "RecordProgressionReceipt": {
      const root = assertRootActive(state, command);
      const progressionReceipt = input.progressionReceipt as ProgressionReceipt;
      if (!progressionReceipt || progressionReceipt.subjectRootIdentityId !== root.rootIdentityId || progressionReceipt.status !== "active") reject("INVALID_COMMAND", "Progression receipt must target the active root identity");
      if (state.progressionReceipts[progressionReceipt.progressionReceiptId]) reject("CONFLICT", "Progression receipt is already represented");
      requiredText(progressionReceipt.proof, "progressionReceipt.proof");
      return [{ type: "ProgressionReceiptRecorded", payload: { progressionReceipt } }];
    }
    case "RevokeProgressionReceipt": {
      assertRootActive(state, command);
      const progressionReceiptId = requiredText(input.progressionReceiptId, "progressionReceiptId");
      const progressionReceipt = state.progressionReceipts[progressionReceiptId];
      if (!progressionReceipt || progressionReceipt.status !== "active") reject("NOT_FOUND", "Active progression receipt does not exist", { progressionReceiptId });
      const record = revocation(command, requiredText(input.revocationId, "revocationId"), "progression-receipt", progressionReceiptId, requiredText(input.reason, "reason"));
      return [{ type: "ProgressionReceiptRevoked", payload: { progressionReceiptId, revocation: record } }];
    }
    case "AddRecoveryMethod": {
      assertRootActive(state, command);
      const recoveryMethod = input.recoveryMethod as RecoveryMethod;
      if (!recoveryMethod || recoveryMethod.status !== "active" || recoveryMethod.revokedAt !== null) reject("INVALID_COMMAND", "Recovery method must be active and public");
      if (state.recoveryMethods[recoveryMethod.recoveryMethodId]) reject("CONFLICT", "Recovery method is already represented");
      requiredText(recoveryMethod.publicMaterial, "recoveryMethod.publicMaterial");
      return [{ type: "RecoveryMethodAdded", payload: { recoveryMethod } }];
    }
    case "RevokeRecoveryMethod": {
      assertRootActive(state, command);
      const recoveryMethodId = requiredText(input.recoveryMethodId, "recoveryMethodId");
      const recoveryMethod = state.recoveryMethods[recoveryMethodId];
      if (!recoveryMethod || recoveryMethod.status !== "active") reject("NOT_FOUND", "Active recovery method does not exist", { recoveryMethodId });
      const record = revocation(command, requiredText(input.revocationId, "revocationId"), "recovery-method", recoveryMethodId, requiredText(input.reason, "reason"));
      return [{ type: "RecoveryMethodRevoked", payload: { recoveryMethodId, revokedAt: command.issuedAt, revocation: record } }];
    }
    case "RevokeRootIdentity": {
      const root = assertRootActive(state, command);
      const record = revocation(command, requiredText(input.revocationId, "revocationId"), "root", root.rootIdentityId, requiredText(input.reason, "reason"));
      return [{ type: "RootIdentityRevoked", payload: { rootIdentityId: root.rootIdentityId, revocation: record } }];
    }
    case "IssueStableRootConsent": {
      const root = assertRootActive(state, command);
      if (command.actor.kind !== "human") reject("CONSENT_INVALID", "Stable-root consent requires a human actor");
      const device = state.devices[command.actor.deviceId];
      if (!device || device.status !== "active" || device.assuranceLevel !== "high" || !device.capabilities.includes("issue:stable-root-consent")) reject("CONSENT_INVALID", "Stable-root consent requires an active high-assurance authorized device");
      const consent = input.consent as StableRootConsent;
      if (!consent || consent.rootIdentityId !== root.rootIdentityId || consent.deviceId !== device.deviceId || consent.issuedAt !== command.issuedAt || consent.status !== "active" || consent.revokedAt !== null) reject("CONSENT_INVALID", "Stable-root consent does not bind to the root, device, and issuance command");
      if (state.stableRootConsents[consent.consentReceiptId]) reject("CONFLICT", "Stable-root consent receipt already exists");
      requiredText(consent.audience, "consent.audience");
      requiredText(consent.purpose, "consent.purpose");
      requiredText(consent.proof, "consent.proof");
      const ttl = Date.parse(consent.expiresAt) - Date.parse(consent.issuedAt);
      if (ttl <= 0 || ttl > STABLE_ROOT_CONSENT_MAX_TTL_MS) reject("CONSENT_INVALID", "Stable-root consent must be positive and no longer than fifteen minutes");
      return [{ type: "StableRootConsentIssued", payload: { consent } }];
    }
    case "RevokeStableRootConsent": {
      assertRootActive(state, command);
      const consentReceiptId = requiredText(input.consentReceiptId, "consentReceiptId");
      const consent = state.stableRootConsents[consentReceiptId];
      if (!consent || consent.status !== "active") reject("NOT_FOUND", "Active stable-root consent does not exist", { consentReceiptId });
      const record = revocation(command, requiredText(input.revocationId, "revocationId"), "stable-root-consent", consentReceiptId, requiredText(input.reason, "reason"));
      return [{ type: "StableRootConsentRevoked", payload: { consentReceiptId, revokedAt: command.issuedAt, revocation: record } }];
    }
    case "CreatePassportPresentation": {
      const root = assertRootActive(state, command);
      const selection = input.selection as Record<string, unknown>;
      if (!selection || typeof selection !== "object") reject("INVALID_COMMAND", "selection is required");
      const identityMode = input.identityMode === undefined ? "pairwise" : input.identityMode;
      if (identityMode !== "pairwise" && identityMode !== "stable-root") reject("INVALID_COMMAND", "identityMode must be pairwise or stable-root");
      const audience = requiredText(input.audience, "audience");
      const pairwiseIdentity = input.pairwiseIdentity as PassportPresentation["pairwiseIdentity"];
      const suppliedStableDisclosure = input.stableRootDisclosure as { consentReceiptId: string; reason: string } | null;
      let stableRootDisclosure: PassportPresentation["stableRootDisclosure"] = null;
      let disclosedRoot: RootIdentity | null = null;
      let subjectId: string;
      if (identityMode === "pairwise") {
        if (!pairwiseIdentity || pairwiseIdentity.audience !== audience) reject("PASSPORT_CUSTODY_VIOLATION", "Normal portability requires an audience-bound pairwise federation identity");
        requiredText(pairwiseIdentity.pairwiseId, "pairwiseIdentity.pairwiseId");
        requiredText(pairwiseIdentity.publicKey, "pairwiseIdentity.publicKey");
        requiredText(pairwiseIdentity.proof, "pairwiseIdentity.proof");
        if (suppliedStableDisclosure !== null) reject("PASSPORT_CUSTODY_VIOLATION", "Pairwise presentation cannot silently disclose stable root identity");
        subjectId = pairwiseIdentity.pairwiseId;
      } else {
        if (pairwiseIdentity !== null) reject("PASSPORT_CUSTODY_VIOLATION", "Stable-root disclosure must be explicit rather than mixed with pairwise identity");
        if (!suppliedStableDisclosure) reject("PASSPORT_CUSTODY_VIOLATION", "Stable-root portability requires explicit consent and a disclosure reason");
        const consentReceiptId = requiredText(suppliedStableDisclosure.consentReceiptId, "stableRootDisclosure.consentReceiptId");
        const consent = state.stableRootConsents[consentReceiptId];
        const consentDevice = consent ? state.devices[consent.deviceId] : undefined;
        if (!consent || consent.status !== "active" || consent.audience !== audience || consent.purpose !== input.purpose || Date.parse(command.issuedAt) >= Date.parse(consent.expiresAt)) reject("CONSENT_INVALID", "Stable-root consent is absent, expired, or not bound to this audience and purpose");
        if (!consentDevice || consentDevice.status !== "active" || consentDevice.assuranceLevel !== "high") reject("CONSENT_INVALID", "Stable-root consent device is no longer active and high assurance");
        if (Date.parse(String(input.expiresAt)) > Date.parse(consent.expiresAt)) reject("CONSENT_INVALID", "Stable-root presentation cannot outlive its consent");
        stableRootDisclosure = {
          rootIdentityId: root.rootIdentityId,
          consentReceiptId,
          authorizedDeviceId: consent.deviceId,
          consentIssuedAt: consent.issuedAt,
          consentExpiresAt: consent.expiresAt,
          reason: requiredText(suppliedStableDisclosure.reason, "stableRootDisclosure.reason"),
        };
        disclosedRoot = structuredClone(root);
        subjectId = root.rootIdentityId;
      }
      const presentation: PassportPresentation = {
        schemaVersion: SCHEMA_VERSIONS.passportPresentation,
        presentationId: requiredText(input.presentationId, "presentationId"),
        identityMode,
        subjectId,
        pairwiseIdentity: identityMode === "pairwise" ? structuredClone(pairwiseIdentity) : null,
        stableRootDisclosure,
        audience,
        purpose: requiredText(input.purpose, "purpose"),
        issuedAt: command.issuedAt,
        expiresAt: requiredText(input.expiresAt, "expiresAt"),
        rootIdentity: disclosedRoot,
        devices: selectActive(state.devices, selection.deviceIds, "selection.deviceIds"),
        memberships: selectActive(state.memberships, selection.membershipIds, "selection.membershipIds"),
        claims: selectActive(state.claims, selection.claimIds, "selection.claimIds"),
        progressionReceipts: selectActive(state.progressionReceipts, selection.progressionReceiptIds, "selection.progressionReceiptIds"),
        proof: requiredText(input.proof, "proof"),
      };
      if (Date.parse(presentation.expiresAt) <= Date.parse(presentation.issuedAt)) reject("INVALID_COMMAND", "Passport presentation must expire after issuance");
      assertNoPrivateMaterial(presentation);
      const presentationDigest = digestJson(presentation as unknown as JsonValue);
      return [{ type: "PassportPresentationIssued", payload: { presentation, presentationDigest } }];
    }
    default:
      reject("INVALID_COMMAND", `${command.type} is not a passport command`);
  }
}

export function evolvePassport(state: PassportAggregate, event: { type: string; streamVersion: number; payload: unknown }): PassportAggregate {
  const next = structuredClone(state);
  const input = event.payload as Payload;
  switch (event.type) {
    case "PassportRootRegistered":
      next.rootIdentity = input.rootIdentity as RootIdentity;
      break;
    case "DeviceAuthorized": {
      const device = input.device as DeviceAuthorization;
      next.devices[device.deviceId] = device;
      break;
    }
    case "DeviceRevoked":
      next.devices[input.deviceId as string]!.status = "revoked";
      next.devices[input.deviceId as string]!.revokedAt = input.revokedAt as string;
      next.revocations.push(input.revocation as RevocationRecord);
      break;
    case "MembershipJoined": {
      const membership = input.membership as FederationMembership;
      next.memberships[membership.membershipId] = membership;
      break;
    }
    case "MembershipLeft":
      next.memberships[input.membershipId as string]!.status = "left";
      next.memberships[input.membershipId as string]!.endedAt = input.endedAt as string;
      break;
    case "ClaimIssued": {
      const claim = input.claim as PassportClaim;
      next.claims[claim.claimId] = claim;
      break;
    }
    case "ClaimRevoked":
      next.claims[input.claimId as string]!.status = "revoked";
      next.claims[input.claimId as string]!.revokedAt = input.revokedAt as string;
      next.revocations.push(input.revocation as RevocationRecord);
      break;
    case "ProgressionReceiptRecorded": {
      const progressionReceipt = input.progressionReceipt as ProgressionReceipt;
      next.progressionReceipts[progressionReceipt.progressionReceiptId] = progressionReceipt;
      break;
    }
    case "ProgressionReceiptRevoked":
      next.progressionReceipts[input.progressionReceiptId as string]!.status = "revoked";
      next.revocations.push(input.revocation as RevocationRecord);
      break;
    case "RecoveryMethodAdded": {
      const recoveryMethod = input.recoveryMethod as RecoveryMethod;
      next.recoveryMethods[recoveryMethod.recoveryMethodId] = recoveryMethod;
      break;
    }
    case "RecoveryMethodRevoked":
      next.recoveryMethods[input.recoveryMethodId as string]!.status = "revoked";
      next.recoveryMethods[input.recoveryMethodId as string]!.revokedAt = input.revokedAt as string;
      next.revocations.push(input.revocation as RevocationRecord);
      break;
    case "RootIdentityRevoked":
      next.rootIdentity!.status = "revoked";
      next.revocations.push(input.revocation as RevocationRecord);
      break;
    case "StableRootConsentIssued": {
      const consent = input.consent as StableRootConsent;
      next.stableRootConsents[consent.consentReceiptId] = consent;
      break;
    }
    case "StableRootConsentRevoked":
      next.stableRootConsents[input.consentReceiptId as string]!.status = "revoked";
      next.stableRootConsents[input.consentReceiptId as string]!.revokedAt = input.revokedAt as string;
      next.revocations.push(input.revocation as RevocationRecord);
      break;
    case "PassportPresentationIssued":
      next.presentationDigests.push(input.presentationDigest as string);
      break;
  }
  next.version = event.streamVersion;
  return next;
}
