import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((filename) => filename.replaceAll("\\", "/"));

const forbiddenPaths = [
  { code: "BUILD_OUTPUT", pattern: /(^|\/)(node_modules|\.build|dist|coverage)(\/|$)/ },
  { code: "REFERENCE_ARCHIVE", pattern: /\.zip$/i },
  { code: "DATABASE", pattern: /\.(db|sqlite|sqlite3)(-|$|\/)/i },
  { code: "ENVIRONMENT", pattern: /(^|\/)\.env($|\.)/ },
  { code: "PRIVATE_KEY_FILE", pattern: /\.(pem|key|p12|pfx|jks)$/i },
  { code: "RUNTIME_VAULT", pattern: /(^|\/)(\.vault|local-vault|runtime-vault|custody-keys)(\/|$)|\.vault$/i },
  { code: "EVIDENCE_CONTENT", pattern: /(^|\/)(evidence|evidence-content|content-addressed-store|artifact-blobs)(\/|$)|\.evidence$/i },
  { code: "LOCAL_IDENTITY", pattern: /(^|\/)(local-identities|identity-custody)(\/|$)|\.(identity|device-authorization)\.local\.json$/i },
  { code: "SCRATCH", pattern: /(^|\/)(\.packet-000-work|\.tmp|tmp|temp)(\/|$)|\.log$/i },
];

const findings = [];
for (const filename of tracked) {
  for (const rule of forbiddenPaths) {
    if (rule.pattern.test(filename)) findings.push(`${rule.code}: ${filename}`);
  }
}

const secretMarkers = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
];
for (const filename of tracked) {
  if (/\.(png|jpg|jpeg|gif|webp|pdf|wasm)$/i.test(filename)) continue;
  const content = readFileSync(path.resolve(filename), "utf8");
  if (secretMarkers.some((pattern) => pattern.test(content))) findings.push(`SECRET_MARKER: ${filename}`);
}

const manifestPath = "reference/REFERENCE-RELEASE-MANIFEST.json";
if (!tracked.includes(manifestPath)) findings.push(`MISSING_MANIFEST: ${manifestPath}`);
else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.releaseTag !== "reference-node-v0.4.0"
    || manifest.asset?.filename !== "Cerbanimo-Constellary-Reference-Node-v0.4.0.zip"
    || manifest.asset?.bytes !== 661736
    || manifest.asset?.sha256 !== "4f3f4ccf793ec33e4488fe456378f36d6b60ca6827efbdc3600e0c9e5f82898a"
    || manifest.asset?.gitHistoryPolicy !== "release-asset-only"
  ) findings.push("REFERENCE_MANIFEST_MISMATCH: recorded reference release facts changed");
}

if (findings.length > 0) {
  throw new Error(`Publication boundary failed:\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
}

console.log(`Publication boundary verified for ${tracked.length} tracked files.`);
