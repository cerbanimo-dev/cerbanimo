import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifests = [
  path.join(root, "packages", "schemas", "generated", "1.0.0.freeze.json"),
  path.join(root, "packages", "proof", "generated", "1.1.0.freeze.json"),
  path.join(root, "packages", "review", "generated", "1.1.0.freeze.json"),
];
for (const manifest of manifests) {
  const freeze = JSON.parse(await readFile(manifest, "utf8"));
  const bytes = await readFile(path.join(path.dirname(manifest), freeze.schema));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== freeze.bytes || digest !== freeze.sha256) {
    throw new Error(`Frozen schema ${freeze.schema} changed: expected ${freeze.bytes}/${freeze.sha256}, received ${bytes.byteLength}/${digest}`);
  }
  console.log(`Verified frozen ${freeze.schema} (${freeze.bytes} bytes, ${freeze.sha256})`);
}
