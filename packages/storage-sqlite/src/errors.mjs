export class StorageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.details = details;
  }
}

export class InjectedCrashAfterCommitError extends StorageError {
  constructor(commandId) {
    super("INJECTED_CRASH_AFTER_COMMIT", "Injected crash after durable commit and before response", { commandId });
    this.name = "InjectedCrashAfterCommitError";
  }
}
