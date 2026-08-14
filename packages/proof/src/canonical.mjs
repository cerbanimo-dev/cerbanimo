import { createHash } from "node:crypto";

export class ProofContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofContractError";
    this.code = code;
    this.details = details;
  }
}

export function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ProofContractError("NON_CANONICAL_VALUE", "Canonical JSON forbids non-finite numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    if (entries.some(([, child]) => child === undefined)) throw new ProofContractError("NON_CANONICAL_VALUE", "Canonical JSON forbids undefined values");
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`).join(",")}}`;
  }
  throw new ProofContractError("NON_CANONICAL_VALUE", `Canonical JSON cannot encode ${typeof value}`);
}

export function sha256(value) {
  const hash = createHash("sha256");
  if (value instanceof Uint8Array) hash.update(value);
  else hash.update(typeof value === "string" ? value : canonicalize(value), "utf8");
  return hash.digest("hex");
}

export function cloneJson(value) {
  return JSON.parse(canonicalize(value));
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function requireText(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new ProofContractError("INVALID_EVIDENCE", `${field} is required`, { field });
  return value.trim();
}

export function requireTimestamp(value, field) {
  const timestamp = requireText(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) throw new ProofContractError("INVALID_EVIDENCE", `${field} must be an ISO timestamp`, { field });
  return timestamp;
}

export function requireDigest(value, field) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new ProofContractError("INVALID_EVIDENCE", `${field} must be a lowercase SHA-256 digest`, { field });
  return value;
}

export function uniqueSorted(values, field) {
  if (!Array.isArray(values)) throw new ProofContractError("INVALID_EVIDENCE", `${field} must be an array`, { field });
  const normalized = values.map((value, index) => requireText(value, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new ProofContractError("INVALID_EVIDENCE", `${field} must not contain duplicates`, { field });
  return normalized.sort((left, right) => left.localeCompare(right));
}

const SECRET_KEYS = new Set([
  "privatekey", "rootprivatekey", "secretkey", "mnemonic", "seedphrase", "passphrase",
  "password", "accesstoken", "refreshtoken", "apikey", "clientsecret", "ciphertext", "wrappedkey",
]);

export function assertPublicMetadata(value, location = "metadata") {
  if (value === null || value === undefined || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertPublicMetadata(child, `${location}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (SECRET_KEYS.has(normalized)) throw new ProofContractError("SECRET_METADATA_FORBIDDEN", "Secret metadata is forbidden in canonical evidence", { location: `${location}.${key}` });
    assertPublicMetadata(child, `${location}.${key}`);
  }
}
