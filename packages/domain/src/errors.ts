import type { CommandRejection, JsonValue } from "../../schemas/src/index.js";

export class DomainError extends Error {
  readonly rejection: CommandRejection;

  constructor(code: CommandRejection["code"], message: string, details: Record<string, JsonValue> = {}) {
    super(message);
    this.name = "DomainError";
    this.rejection = { code, message, details };
  }
}

export function reject(
  code: CommandRejection["code"],
  message: string,
  details: Record<string, JsonValue> = {},
): never {
  throw new DomainError(code, message, details);
}
