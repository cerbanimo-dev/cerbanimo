import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REFERENCE_SHA256 = "4f3f4ccf793ec33e4488fe456378f36d6b60ca6827efbdc3600e0c9e5f82898a";
export const REFERENCE_BYTES = 661736;

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
const successorRoot = path.resolve(supportDirectory, "../../..");
const defaultArchive = path.resolve(
  successorRoot,
  "../Cerbanimo-Production-Handoff-v1/cerbanimo-production-handoff-v1/reference/Cerbanimo-Constellary-Reference-Node-v0.4.0.zip",
);

export function referenceArchivePath() {
  return path.resolve(process.env.CERBANIMO_REFERENCE_ARCHIVE || defaultArchive);
}

export async function verifyReferenceArchive(archive = referenceArchivePath()) {
  const metadata = await stat(archive);
  const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
  if (metadata.size !== REFERENCE_BYTES) {
    throw new Error(`Reference archive byte count mismatch: expected ${REFERENCE_BYTES}, received ${metadata.size}`);
  }
  if (digest !== REFERENCE_SHA256) {
    throw new Error(`Reference archive checksum mismatch: expected ${REFERENCE_SHA256}, received ${digest}`);
  }
  return { archive, bytes: metadata.size, sha256: digest };
}

export async function materializeReference() {
  const verified = await verifyReferenceArchive();
  const extractionDirectory = await mkdtemp(path.join(os.tmpdir(), "cerbanimo-packet-000-oracle-"));
  const extractor = process.platform === "win32"
    ? { command: "tar", arguments: ["-xf", verified.archive, "-C", extractionDirectory] }
    : { command: "unzip", arguments: ["-q", verified.archive, "-d", extractionDirectory] };
  const result = spawnSync(extractor.command, extractor.arguments, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    await rm(extractionDirectory, { recursive: true, force: true });
    throw result.error || new Error(`Unable to extract reference archive: ${result.stderr || result.stdout}`);
  }
  const root = path.join(extractionDirectory, "cerbanimo-constellary");
  await stat(path.join(root, "server", "local-server.mjs"));
  return {
    ...verified,
    root,
    extractionDirectory,
    async dispose() {
      await rm(extractionDirectory, { recursive: true, force: true });
    },
  };
}

export async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Unable to reserve a local test port");
  return port;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1500);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

export async function startReferenceNode(referenceRoot, options = {}) {
  const port = options.port || await reservePort();
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "cerbanimo-packet-000-data-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  let logs = "";
  const child = spawn(process.execPath, ["server/local-server.mjs"], {
    cwd: referenceRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      CERBANIMO_DATA_DIR: dataDirectory,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return {
          baseUrl,
          child,
          dataDirectory,
          logs: () => logs,
          async stop() {
            await stopChild(child);
            await rm(dataDirectory, { recursive: true, force: true });
          },
        };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await stopChild(child);
  await rm(dataDirectory, { recursive: true, force: true });
  throw new Error(`Reference node did not start at ${baseUrl}.\n${logs}`);
}

export async function request(baseUrl, route, options = {}) {
  const response = await fetch(baseUrl + route, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, headers: response.headers, payload };
}

export async function setupOfflineNode(node, overrides = {}) {
  return request(node.baseUrl, "/api/setup", {
    method: "POST",
    body: JSON.stringify({
      instanceName: overrides.instanceName || "Packet 000 Oracle",
      steward: overrides.steward || "Compatibility Steward",
      firstQuest: overrides.firstQuest || "Publish a compatibility field note.",
      provider: { type: "offline", tier: "free" },
    }),
  });
}

export function concreteEvidence(task) {
  return `I completed ${task.title}. The observable result directly satisfies “${task.proofRequirement}”. I checked the result, recorded what changed, and preserved enough concrete detail for another person to review it.`;
}
