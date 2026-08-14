import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import {
  concreteEvidence,
  materializeReference,
  REFERENCE_BYTES,
  REFERENCE_SHA256,
  request,
  reservePort,
  setupOfflineNode,
  startReferenceNode,
} from "./support/reference-oracle.mjs";

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "reference-v0.4.0");

async function loadFixture(name) {
  return JSON.parse(await readFile(path.join(fixturesDirectory, `${name}.json`), "utf8"));
}

const fixtures = Object.fromEntries(await Promise.all([
  "proposal-preview-confirmation",
  "false-proof",
  "audit-escrow",
  "reward-release",
  "continuation",
  "identity-transfer",
  "federation-tamper-rejection",
].map(async (name) => [name, await loadFixture(name)])));

let reference;

before(async () => {
  reference = await materializeReference();
});

after(async () => {
  await reference?.dispose();
});

test("the oracle is exactly the frozen v0.4.0 archive", () => {
  assert.equal(reference.sha256, REFERENCE_SHA256);
  assert.equal(reference.bytes, REFERENCE_BYTES);
});

test("proposal preview is inert and confirmation returns an execution receipt", async () => {
  const expected = fixtures["proposal-preview-confirmation"].observedResponse;
  const node = await startReferenceNode(reference.root);
  try {
    const setup = await setupOfflineNode(node, { firstQuest: "Publish a tiny field note." });
    const initialState = setup.payload.state;
    const project = initialState.projects[0];
    const thread = initialState.threads.find((item) => item.projectId === project.id);
    const initialTaskCount = initialState.tasks.length;
    const preview = await request(node.baseUrl, "/api/kamiya", {
      method: "POST",
      body: JSON.stringify({
        message: "What if we also built out a quick check in / out library app and included QR codes? Add doing all of that to the Cerbanimo plan.",
        mode: "plain",
        projectId: project.id,
        threadId: thread.id,
      }),
    });
    const confirmed = await request(node.baseUrl, `/api/actions/${preview.payload.proposal.id}/confirm`, { method: "POST" });
    const projection = {
      setupStatus: setup.status,
      initialTasksAtLeast: initialTaskCount >= expected.initialTasksAtLeast ? expected.initialTasksAtLeast : initialTaskCount,
      firstTaskStatus: initialState.tasks[0].status,
      previewStatus: preview.status,
      proposalProtocol: preview.payload.proposal.protocol,
      proposalStatus: preview.payload.proposal.status,
      proposalTool: preview.payload.proposal.tool,
      containsAppendTasks: preview.payload.proposal.document.operations.some(({ op }) => op === "quest.append_tasks"),
      previewMutatedTaskCount: preview.payload.state.tasks.length !== initialTaskCount,
      confirmStatus: confirmed.status,
      receiptStatus: confirmed.payload.receipt.status,
      receiptTool: confirmed.payload.receipt.tool,
      confirmedTaskCountIncreased: confirmed.payload.state.tasks.length > initialTaskCount,
    };
    assert.deepEqual(projection, expected);
  } finally {
    await node.stop();
  }
});

test("explicit false proof advances nothing and pays nothing", async () => {
  const expected = fixtures["false-proof"].observedResponse;
  const node = await startReferenceNode(reference.root);
  try {
    const setup = await setupOfflineNode(node);
    const task = setup.payload.state.tasks.find(({ status }) => status === "active");
    const beforeCoins = setup.payload.state.profile.coins;
    const submitted = await request(node.baseUrl, `/api/tasks/${task.id}/submit`, {
      method: "POST",
      body: JSON.stringify({
        evidence: "This is a false submission. I did not complete the task and have no real evidence.",
        proofLinks: ["https://example.test/fake"],
      }),
    });
    assert.deepEqual({
      status: submitted.status,
      verified: submitted.payload.verified,
      coinsBefore: beforeCoins,
      coinsAfter: submitted.payload.state.profile.coins,
      taskStatusAfter: submitted.payload.state.tasks.find(({ id }) => id === task.id).status,
    }, expected);
  } finally {
    await node.stop();
  }
});

test("two-reviewer audit escrows rewards until quorum, then the reference releases them", async () => {
  const escrowExpected = fixtures["audit-escrow"].observedResponse;
  const releaseExpected = fixtures["reward-release"].observedResponse;
  const nodeA = await startReferenceNode(reference.root);
  const nodeB = await startReferenceNode(reference.root);
  try {
    const setupA = await setupOfflineNode(nodeA, { instanceName: "Packet North", steward: "Cami North" });
    const setupB = await setupOfflineNode(nodeB, { instanceName: "Packet Hall", steward: "Mara Hall" });
    const tokenA = setupA.payload.state.instance.federationToken;
    const tokenB = setupB.payload.state.instance.federationToken;
    const didA = setupA.payload.state.profile.identity.did;
    const didB = setupB.payload.state.profile.identity.did;

    const joined = await request(nodeA.baseUrl, "/api/memberships/join", {
      method: "POST",
      body: JSON.stringify({ baseUrl: nodeB.baseUrl, token: tokenB }),
    });
    assert.equal(joined.status, 201);
    const linkA = await request(nodeA.baseUrl, "/api/peers", {
      method: "POST",
      body: JSON.stringify({ baseUrl: nodeB.baseUrl, token: tokenB }),
    });
    const linkB = await request(nodeB.baseUrl, "/api/peers", {
      method: "POST",
      body: JSON.stringify({ baseUrl: nodeA.baseUrl, token: tokenA }),
    });
    assert.equal(linkA.status, 201);
    assert.equal(linkB.status, 201);

    const homeFederation = linkA.payload.state.federations.find(({ role }) => role === "home");
    const policy = await request(nodeA.baseUrl, `/api/federations/${homeFederation.id}/policy`, {
      method: "PUT",
      body: JSON.stringify({ auditSampleRate: 100, auditQuorum: 2, reviewerSampleSize: 2 }),
    });
    const project = setupA.payload.state.projects[0];
    await request(nodeA.baseUrl, `/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ visibility: "public" }),
    });
    const current = await request(nodeA.baseUrl, "/api/bootstrap");
    const task = current.payload.state.tasks.find((item) => item.projectId === project.id && item.status === "active");
    const submitted = await request(nodeA.baseUrl, `/api/tasks/${task.id}/submit`, {
      method: "POST",
      body: JSON.stringify({ evidence: concreteEvidence(task), proofLinks: ["field://packet-000-audit"] }),
    });

    assert.deepEqual({
      policyStatus: policy.status,
      requiredVotes: submitted.payload.audit.requiredVotes,
      submissionStatus: submitted.status,
      pendingAudit: submitted.payload.pendingAudit,
      verifiedBeforeQuorum: submitted.payload.verified,
      coinsBeforeQuorum: submitted.payload.state.profile.coins,
      separateNodeIdentities: didA !== didB,
    }, escrowExpected);

    const synced = await request(nodeB.baseUrl, `/api/peers/${linkB.payload.peer.id}/sync`, { method: "POST" });
    const finalized = await request(nodeA.baseUrl, "/api/bootstrap");
    const finalTask = finalized.payload.state.tasks.find(({ id }) => id === task.id);
    const contract = finalized.payload.state.auditContracts.find(({ taskId }) => taskId === task.id);
    assert.deepEqual({
      syncStatus: synced.status,
      auditsReviewed: synced.payload.auditsReviewed,
      taskStatusAfterQuorum: finalTask.status,
      auditStatusAfterQuorum: contract.status,
      returnedVotes: contract.votes.length,
      coinsReleased: finalized.payload.state.profile.coins > 0,
      fieldSpecimenCreated: finalized.payload.state.keepsakes.length > 0,
      referenceBoundary: releaseExpected.referenceBoundary,
    }, releaseExpected);
  } finally {
    await Promise.all([nodeA.stop(), nodeB.stop()]);
  }
});

test("project completion offers three horizons and appends a chapter", async () => {
  const expected = fixtures.continuation.observedResponse;
  const node = await startReferenceNode(reference.root);
  try {
    const setup = await setupOfflineNode(node);
    const project = setup.payload.state.projects[0];
    let state = setup.payload.state;
    let attempts = 0;
    while (state.projects.find(({ id }) => id === project.id).status !== "sealed") {
      attempts += 1;
      assert.ok(attempts <= 20, "reference project did not converge on completion");
      const task = state.tasks.find((item) => item.projectId === project.id && item.status === "active");
      assert.ok(task, "the next traversable task must become active");
      const submitted = await request(node.baseUrl, `/api/tasks/${task.id}/submit`, {
        method: "POST",
        body: JSON.stringify({
          evidence: concreteEvidence(task),
          proofLinks: [`https://example.test/proof/${task.id}`],
        }),
      });
      assert.equal(submitted.payload.verified, true);
      state = submitted.payload.state;
    }
    const completed = state.projects.find(({ id }) => id === project.id);
    const countBefore = state.tasks.length;
    const continued = await request(node.baseUrl, `/api/projects/${project.id}/continue`, {
      method: "POST",
      body: JSON.stringify({ optionId: completed.continuations[0].id }),
    });
    assert.deepEqual({
      projectProgressAtCompletion: completed.progress,
      continuationChoiceCount: completed.continuations.length,
      horizonMessagePresent: state.messages.some(({ kind }) => kind === "horizons"),
      continueStatus: continued.status,
      chapterAfter: continued.payload.state.projects.find(({ id }) => id === project.id).chapter,
      taskCountIncreased: continued.payload.state.tasks.length > countBefore,
      receiptStatus: continued.payload.receipt.status,
    }, expected);
  } finally {
    await node.stop();
  }
});

test("identity transfer preserves DID and progression while a wrong passphrase is inert", async () => {
  const expected = fixtures["identity-transfer"].observedResponse;
  const source = await startReferenceNode(reference.root);
  const destination = await startReferenceNode(reference.root);
  try {
    const sourceSetup = await setupOfflineNode(source, { steward: "Portable Cami" });
    const destinationSetup = await setupOfflineNode(destination, { steward: "Destination Steward" });
    const sourceDid = sourceSetup.payload.state.profile.identity.did;
    const destinationDid = destinationSetup.payload.state.profile.identity.did;
    const task = sourceSetup.payload.state.tasks.find(({ status }) => status === "active");
    const completed = await request(source.baseUrl, `/api/tasks/${task.id}/submit`, {
      method: "POST",
      body: JSON.stringify({ evidence: concreteEvidence(task), proofLinks: [`field://identity/${task.id}`] }),
    });
    assert.equal(completed.payload.verified, true);
    assert.ok(completed.payload.state.profile.coins > 0);

    const exported = await request(source.baseUrl, "/api/identity/export", {
      method: "POST",
      body: JSON.stringify({ passphrase: "portable assembly identity" }),
    });
    const wrong = await request(destination.baseUrl, "/api/identity/import", {
      method: "POST",
      body: JSON.stringify({ passphrase: "incorrect assembly phrase", capsule: exported.payload.capsule }),
    });
    const afterWrong = await request(destination.baseUrl, "/api/bootstrap");
    const imported = await request(destination.baseUrl, "/api/identity/import", {
      method: "POST",
      body: JSON.stringify({ passphrase: "portable assembly identity", capsule: exported.payload.capsule }),
    });
    assert.deepEqual({
      exportStatus: exported.status,
      capsuleProtocol: exported.payload.capsule.protocol,
      wrongPassphraseStatus: wrong.status,
      wrongPassphraseMutatedDestinationIdentity: afterWrong.payload.state.profile.identity.did !== destinationDid,
      importStatus: imported.status,
      receiptTool: imported.payload.receipt.tool,
      rootIdentifierPreserved: imported.payload.state.profile.identity.did === sourceDid,
      earnedCoinsPreserved: imported.payload.state.profile.coins === completed.payload.state.profile.coins,
    }, expected);
  } finally {
    await Promise.all([source.stop(), destination.stop()]);
  }
});

test("a tampered federation record from a linked peer is rejected inertly", async () => {
  const expected = fixtures["federation-tamper-rejection"].observedResponse;
  const port = await reservePort();
  const peerUrl = `http://127.0.0.1:${port}`;
  const issuedAt = "2026-07-22T12:00:00.000Z";
  const tamperedEvent = {
    id: "event_packet_000_tampered",
    entityType: "project",
    createdAt: issuedAt,
    signature: {
      protocol: "cerbanimo-chain/2",
      type: "activity.recorded",
      issuer: "did:cerbanimo:not-a-real-key",
      issuedAt,
      nonce: "packet-000",
      payload: { id: "event_packet_000_tampered", summary: "mutated after signing" },
      proof: { type: "Ed25519Signature2020", publicKey: "invalid", digest: "00", signature: "invalid" },
    },
  };
  const fakePeer = http.createServer((incoming, response) => {
    response.setHeader("content-type", "application/json");
    if (incoming.url?.startsWith("/api/federation/manifest")) {
      response.end(JSON.stringify({
        protocol: "cerbanimo-chain/2",
        instance: { id: "inst_packet_000_fake", name: "Tamper Fixture Peer" },
        federation: { id: "fed_packet_000_fake", name: "Fixture Federation", policy: {} },
        reviewers: [],
        capabilities: ["signals:pull"],
      }));
      return;
    }
    if (incoming.url?.startsWith("/api/federation/events")) {
      response.end(JSON.stringify({ protocol: "cerbanimo-chain/2", events: [tamperedEvent], cursor: issuedAt }));
      return;
    }
    if (incoming.url?.startsWith("/api/federation/audits")) {
      response.end(JSON.stringify({ protocol: "cerbanimo-chain/2", contracts: [] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve, reject) => {
    fakePeer.once("error", reject);
    fakePeer.listen(port, "127.0.0.1", resolve);
  });

  const node = await startReferenceNode(reference.root);
  try {
    await setupOfflineNode(node);
    const linked = await request(node.baseUrl, "/api/peers", {
      method: "POST",
      body: JSON.stringify({ baseUrl: peerUrl, token: "packet-000-test-token" }),
    });
    const synced = await request(node.baseUrl, `/api/peers/${linked.payload.peer.id}/sync`, { method: "POST" });
    assert.deepEqual({
      linkStatus: linked.status,
      syncStatus: synced.status,
      accepted: synced.payload.accepted,
      rejectedSignatures: synced.payload.rejectedSignatures,
      tamperedRecordBecameRemoteSignal: synced.payload.state.remoteSignals.some(({ id }) => id === tamperedEvent.id),
    }, expected);
  } finally {
    await node.stop();
    await new Promise((resolve) => fakePeer.close(resolve));
  }
});
