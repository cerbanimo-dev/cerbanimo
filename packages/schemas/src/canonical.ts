import { createHash } from "node:crypto";
import type { JsonValue } from "./types.js";

function normalize(value: JsonValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalize(value[key] as JsonValue)]),
  );
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(normalize(value));
}

export function digestJson(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
