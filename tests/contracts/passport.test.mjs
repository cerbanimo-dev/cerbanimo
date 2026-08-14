import assert from "node:assert/strict";
import test from "node:test";
import { emptyPassportAggregate, executeCommand } from "../../.build/packages/domain/src/index.js";
import { command, expectAccepted, expectRejected } from "./support/commands.mjs";

function run(state, canonicalCommand) {
  return expectAccepted(executeCommand(state, canonicalCommand));
}

const rootIdentity = {
  rootIdentityId: "root_cami",
  publicKey: "-----BEGIN PUBLIC KEY-----packet-001-----END PUBLIC KEY-----",
  algorithm: "Ed25519",
  createdAt: "2026-07-22T20:00:00.000Z",
  status: "active",
};

test("passport records identity facets independently and normal portability is selective", () => {
  let state = emptyPassportAggregate("passport_stream_cami");
  state = run(state, command("RegisterRootIdentity", state.streamId, 0, { rootIdentity })).state;
  state = run(state, command("AuthorizeDevice", state.streamId, state.version, { device: {
    deviceId: "device_secondary",
    publicKey: "device-public-key",
    capabilities: ["sign:commands"],
    assuranceLevel: "standard",
    authorizedAt: "2026-07-22T20:01:00.000Z",
    status: "active",
    revokedAt: null,
  } })).state;
  state = run(state, command("JoinMembership", state.streamId, state.version, { membership: {
    membershipId: "membership_commons",
    federationId: "federation_commons",
    subjectRootIdentityId: "root_cami",
    role: "member",
    joinedAt: "2026-07-22T20:02:00.000Z",
    status: "active",
    endedAt: null,
  } })).state;
  state = run(state, command("IssueClaim", state.streamId, state.version, { claim: {
    claimId: "claim_skill",
    subjectRootIdentityId: "root_cami",
    issuer: "node_local",
    claimType: "skill.attestation",
    value: { skillId: "reflection", level: 2 },
    issuedAt: "2026-07-22T20:03:00.000Z",
    expiresAt: null,
    proof: "signed-claim",
    status: "active",
    revokedAt: null,
  } })).state;
  state = run(state, command("RecordProgressionReceipt", state.streamId, state.version, { progressionReceipt: {
    progressionReceiptId: "progression_one",
    subjectRootIdentityId: "root_cami",
    sourceNodeId: "node_local",
    settlementId: "settlement_one",
    effectsDigest: "a".repeat(64),
    portableEffects: { xp: 50 },
    issuedAt: "2026-07-22T20:04:00.000Z",
    proof: "signed-progression",
    status: "active",
  } })).state;
  state = run(state, command("AddRecoveryMethod", state.streamId, state.version, { recoveryMethod: {
    recoveryMethodId: "recovery_one",
    methodType: "trusted-contact",
    publicMaterial: "did:example:trusted-contact",
    addedAt: "2026-07-22T20:05:00.000Z",
    status: "active",
    revokedAt: null,
  } })).state;

  const presentationResult = run(state, command("CreatePassportPresentation", state.streamId, state.version, {
    presentationId: "presentation_selective",
    audience: "federation:destination",
    purpose: "Present portable progression without moving identity custody.",
    expiresAt: "2026-07-23T20:06:00.000Z",
    selection: {
      deviceIds: [],
      membershipIds: [],
      claimIds: ["claim_skill"],
      progressionReceiptIds: ["progression_one"],
    },
    pairwiseIdentity: {
      pairwiseId: "pairwise_destination_cami",
      audience: "federation:destination",
      publicKey: "pairwise-public-key",
      proof: "root-authorized-pairwise-proof",
    },
    stableRootDisclosure: null,
    proof: "signed-presentation",
  }, { issuedAt: "2026-07-22T20:06:00.000Z" }));
  const event = presentationResult.events.find(({ type }) => type === "PassportPresentationIssued");
  const presentation = event.payload.presentation;
  assert.equal(presentation.identityMode, "pairwise");
  assert.equal(presentation.subjectId, "pairwise_destination_cami");
  assert.equal(presentation.rootIdentity, null);
  assert.equal(presentation.stableRootDisclosure, null);
  assert.equal(presentation.devices.length, 0);
  assert.equal(presentation.memberships.length, 0);
  assert.deepEqual(presentation.claims.map(({ claimId }) => claimId), ["claim_skill"]);
  assert.deepEqual(presentation.progressionReceipts.map(({ progressionReceiptId }) => progressionReceiptId), ["progression_one"]);
  assert.equal("recoveryMethods" in presentation, false);
  assert.doesNotMatch(JSON.stringify(presentation).toLowerCase(), /privatekey|private_key|mnemonic|seedphrase|secretkey/);

  state = presentationResult.state;
  state = run(state, command("LeaveMembership", state.streamId, state.version, { membershipId: "membership_commons", reason: "Person chose another federation home." })).state;
  assert.equal(state.memberships.membership_commons.status, "left");
  assert.equal(state.rootIdentity.status, "active");
  assert.equal(state.progressionReceipts.progression_one.status, "active");
});

test("stable-root disclosure is explicit and cannot be smuggled into the pairwise default", () => {
  let state = emptyPassportAggregate("passport_stream_disclosure");
  state = run(state, command("RegisterRootIdentity", state.streamId, 0, { rootIdentity })).state;
  const base = {
    presentationId: "presentation_disclosure",
    audience: "federation:regulated",
    purpose: "Regulated identity check.",
    expiresAt: "2026-07-22T20:12:00.000Z",
    selection: { deviceIds: [], membershipIds: [], claimIds: [], progressionReceiptIds: [] },
    proof: "signed-presentation",
  };
  expectRejected(executeCommand(state, command("CreatePassportPresentation", state.streamId, state.version, {
    ...base,
    pairwiseIdentity: { pairwiseId: "pairwise_regulated", audience: base.audience, publicKey: "pairwise-public", proof: "pairwise-proof" },
    stableRootDisclosure: { consentReceiptId: "consent_hidden", reason: "Hidden root disclosure is forbidden." },
  })), "PASSPORT_CUSTODY_VIOLATION");

  const highDeviceActor = { kind: "human", rootIdentityId: "root_cami", deviceId: "device_high_assurance", roles: ["steward"] };
  state = run(state, command("AuthorizeDevice", state.streamId, state.version, { device: {
    deviceId: "device_high_assurance",
    publicKey: "high-assurance-device-public",
    capabilities: ["sign:commands", "issue:stable-root-consent"],
    assuranceLevel: "high",
    authorizedAt: "2026-07-22T20:00:00.000Z",
    status: "active",
    revokedAt: null,
  } })).state;
  state = run(state, command("IssueStableRootConsent", state.streamId, state.version, { consent: {
    consentReceiptId: "consent_explicit",
    rootIdentityId: "root_cami",
    deviceId: "device_high_assurance",
    audience: base.audience,
    purpose: base.purpose,
    issuedAt: "2026-07-22T20:01:00.000Z",
    expiresAt: "2026-07-22T20:13:00.000Z",
    status: "active",
    proof: "high-assurance-device-consent-proof",
    revokedAt: null,
  } }, { actor: highDeviceActor, issuedAt: "2026-07-22T20:01:00.000Z" })).state;

  expectRejected(executeCommand(state, command("CreatePassportPresentation", state.streamId, state.version, {
    ...base,
    purpose: "A different purpose cannot reuse consent.",
    identityMode: "stable-root",
    pairwiseIdentity: null,
    stableRootDisclosure: { consentReceiptId: "consent_explicit", reason: "Mismatched purpose." },
  }, { issuedAt: "2026-07-22T20:02:00.000Z" })), "CONSENT_INVALID");

  const disclosed = run(state, command("CreatePassportPresentation", state.streamId, state.version, {
    ...base,
    identityMode: "stable-root",
    pairwiseIdentity: null,
    stableRootDisclosure: { consentReceiptId: "consent_explicit", reason: "A regulated counterparty requires stable identity." },
  }, { issuedAt: "2026-07-22T20:02:00.000Z" }));
  const presentation = disclosed.events[0].payload.presentation;
  assert.equal(presentation.identityMode, "stable-root");
  assert.equal(presentation.subjectId, "root_cami");
  assert.equal(presentation.rootIdentity.rootIdentityId, "root_cami");
  assert.equal(presentation.stableRootDisclosure.consentReceiptId, "consent_explicit");
  assert.equal(presentation.stableRootDisclosure.authorizedDeviceId, "device_high_assurance");
});

test("root private keys are rejected and device/recovery revocation stays independent", () => {
  const empty = emptyPassportAggregate("passport_stream_custody");
  const unsafe = command("RegisterRootIdentity", empty.streamId, 0, { rootIdentity: { ...rootIdentity, privateKey: "must-never-enter-contracts" } });
  expectRejected(executeCommand(empty, unsafe), "PASSPORT_CUSTODY_VIOLATION");

  let state = run(empty, command("RegisterRootIdentity", empty.streamId, 0, { rootIdentity })).state;
  state = run(state, command("AuthorizeDevice", state.streamId, state.version, { device: { deviceId: "device_revocable", publicKey: "device-public", capabilities: ["sign:commands"], assuranceLevel: "standard", authorizedAt: "2026-07-22T20:10:00.000Z", status: "active", revokedAt: null } })).state;
  state = run(state, command("AddRecoveryMethod", state.streamId, state.version, { recoveryMethod: { recoveryMethodId: "recovery_revocable", methodType: "recovery-key", publicMaterial: "recovery-public-key", addedAt: "2026-07-22T20:11:00.000Z", status: "active", revokedAt: null } })).state;
  state = run(state, command("RevokeDevice", state.streamId, state.version, { deviceId: "device_revocable", revocationId: "revoke_device", reason: "Device lost." })).state;
  assert.equal(state.devices.device_revocable.status, "revoked");
  assert.equal(state.recoveryMethods.recovery_revocable.status, "active");
  assert.equal(state.rootIdentity.status, "active");
  state = run(state, command("RevokeRecoveryMethod", state.streamId, state.version, { recoveryMethodId: "recovery_revocable", revocationId: "revoke_recovery", reason: "Recovery relationship rotated." })).state;
  assert.equal(state.recoveryMethods.recovery_revocable.status, "revoked");
  assert.equal(state.rootIdentity.status, "active");
});
