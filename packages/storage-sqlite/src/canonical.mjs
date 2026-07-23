import { createHash } from "node:crypto";
import { StorageError } from "./errors.mjs";

export function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new StorageError("NON_CANONICAL_VALUE", "Canonical JSON forbids non-finite numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`).join(",")}}`;
  }
  throw new StorageError("NON_CANONICAL_VALUE", `Canonical JSON cannot encode ${typeof value}`);
}

export function sha256(value) {
  const material = typeof value === "string" ? value : canonicalize(value);
  return createHash("sha256").update(material, "utf8").digest("hex");
}

const FORBIDDEN_SECRET_KEYS = new Set([
  "privatekey", "rootprivatekey", "secretkey", "mnemonic", "seedphrase", "passphrase",
  "password", "accesstoken", "refreshtoken", "apikey", "clientsecret", "ciphertext",
]);

export function assertNoSecretMaterial(value, path = "payload") {
  if (value === null || value === undefined || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoSecretMaterial(child, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (FORBIDDEN_SECRET_KEYS.has(normalized)) throw new StorageError("SECRET_BOUNDARY_VIOLATION", "Secret-shaped material is forbidden outside the local vault", { path: `${path}.${key}` });
    assertNoSecretMaterial(child, `${path}.${key}`);
  }
}
