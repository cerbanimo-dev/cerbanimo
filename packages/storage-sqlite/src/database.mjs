import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { canonicalize, sha256, assertNoSecretMaterial } from "./canonical.mjs";
import { InjectedCrashAfterCommitError, StorageError } from "./errors.mjs";
import { SQLITE_MIGRATIONS } from "./migrations.mjs";

const DEFAULT_BUSY_TIMEOUT_MS = 2_500;

function parseJson(text) {
  return JSON.parse(text);
}

function streamTypeFor(streamId) {
  const separator = streamId.indexOf(":");
  return separator === -1 ? "unknown" : streamId.slice(0, separator);
}

function replayedReceipt(receipt) {
  return { ...receipt, replayed: true };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export class SqliteJournal {
  constructor(filename, options = {}) {
    if (typeof filename !== "string" || filename.length === 0) throw new StorageError("INVALID_DATABASE_PATH", "SQLite database path is required");
    this.filename = filename;
    this.busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    if (!Number.isInteger(this.busyTimeoutMs) || this.busyTimeoutMs < 1 || this.busyTimeoutMs > 30_000) throw new StorageError("INVALID_BUSY_TIMEOUT", "Busy timeout must be between 1 and 30000 milliseconds");
    if (filename !== ":memory:") mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.closed = false;
    this.db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    try {
      this.#applyMigrations();
    } catch (error) {
      this.db.close();
      this.closed = true;
      throw error;
    }
  }

  #applyMigrations() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY CHECK (version > 0),
          name TEXT NOT NULL UNIQUE,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL
        ) STRICT
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.#rollbackQuietly();
      throw error;
    }

    const applied = new Map(this.db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all().map((row) => [Number(row.version), row]));
    const latestKnown = SQLITE_MIGRATIONS.at(-1)?.version ?? 0;
    const databaseVersion = Number(this.db.prepare("PRAGMA user_version").get().user_version);
    if (databaseVersion > latestKnown) throw new StorageError("MIGRATION_TOO_NEW", "Database schema is newer than this executable", { databaseVersion, latestKnown });
    for (const migration of SQLITE_MIGRATIONS) {
      const checksum = sha256(migration.sql);
      const existing = applied.get(migration.version);
      if (existing) {
        if (existing.name !== migration.name || existing.checksum !== checksum) throw new StorageError("MIGRATION_CHECKSUM_MISMATCH", "Applied migration differs from the forward-only migration catalog", { version: migration.version });
        continue;
      }
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(migration.sql);
        this.db.prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(migration.version, migration.name, checksum, new Date().toISOString());
        this.db.exec(`PRAGMA user_version = ${migration.version}`);
        this.db.exec("COMMIT");
      } catch (error) {
        this.#rollbackQuietly();
        throw new StorageError("MIGRATION_FAILED", "Forward migration failed", { version: migration.version, cause: errorMessage(error) });
      }
    }
  }

  #rollbackQuietly() {
    try { this.db.exec("ROLLBACK"); } catch { /* transaction was not active */ }
  }

  #assertOpen() {
    if (this.closed) throw new StorageError("DATABASE_CLOSED", "SQLite journal is closed");
  }

  getPragmas() {
    this.#assertOpen();
    return {
      journalMode: String(this.db.prepare("PRAGMA journal_mode").get().journal_mode),
      foreignKeys: Number(this.db.prepare("PRAGMA foreign_keys").get().foreign_keys),
      busyTimeoutMs: Number(this.db.prepare("PRAGMA busy_timeout").get().timeout),
      synchronous: Number(this.db.prepare("PRAGMA synchronous").get().synchronous),
    };
  }

  getMigrations() {
    this.#assertOpen();
    return this.db.prepare("SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations ORDER BY version").all().map((row) => ({ ...row, version: Number(row.version) }));
  }

  loadStream(streamId) {
    this.#assertOpen();
    const row = this.db.prepare("SELECT stream_type AS streamType, version FROM streams WHERE stream_id = ?").get(streamId);
    const events = this.db.prepare("SELECT event_json FROM events WHERE stream_id = ? ORDER BY stream_version").all(streamId).map(({ event_json }) => parseJson(event_json));
    return { streamId, streamType: row?.streamType ?? streamTypeFor(streamId), version: Number(row?.version ?? 0), events };
  }

  loadStreams(expectations) {
    this.#assertOpen();
    this.db.exec("BEGIN");
    try {
      const result = Object.fromEntries(expectations.map(({ streamId }) => [streamId, this.loadStream(streamId)]));
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#rollbackQuietly();
      throw error;
    }
  }

  readAll(afterGlobalPosition = 0, limit = 10_000) {
    this.#assertOpen();
    if (!Number.isInteger(afterGlobalPosition) || afterGlobalPosition < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100_000) throw new StorageError("INVALID_READ_WINDOW", "Global journal read window is invalid");
    return this.db.prepare("SELECT global_position, event_json, event_hash FROM events WHERE global_position > ? ORDER BY global_position LIMIT ?").all(afterGlobalPosition, limit).map((row) => ({ globalPosition: Number(row.global_position), event: parseJson(row.event_json), eventHash: row.event_hash }));
  }

  getReceiptByIdempotencyKey(idempotencyKey) {
    this.#assertOpen();
    const row = this.db.prepare("SELECT c.command_fingerprint, r.receipt_json, r.receipt_hash FROM commands c JOIN receipts r ON r.command_id = c.command_id WHERE c.idempotency_key = ?").get(idempotencyKey);
    return row ? { commandFingerprint: row.command_fingerprint, receipt: parseJson(row.receipt_json), receiptHash: row.receipt_hash } : null;
  }

  commit(request, injectionPoint = null) {
    this.#assertOpen();
    const { command, commandFingerprint, receipt } = request;
    if (!command || !receipt || typeof commandFingerprint !== "string") throw new StorageError("INVALID_COMMIT", "Commit requires command, fingerprint, and receipt");
    if (receipt.commandId !== command.commandId || receipt.idempotencyKey !== command.idempotencyKey || receipt.commandFingerprint !== commandFingerprint) throw new StorageError("RECEIPT_BINDING_MISMATCH", "Receipt does not bind to the canonical command");
    assertNoSecretMaterial(command, "command");
    assertNoSecretMaterial(receipt, "receipt");
    for (const batch of request.eventBatches ?? []) batch.events.forEach((event) => assertNoSecretMaterial(event, "event"));
    for (const projection of request.projectionWrites ?? []) assertNoSecretMaterial(projection.state, "projection");
    for (const message of request.outboxMessages ?? []) assertNoSecretMaterial(message.payload, "outbox");
    const expectedStreams = [...(request.expectedStreams ?? [])].sort((left, right) => left.streamId.localeCompare(right.streamId));
    if (new Set(expectedStreams.map(({ streamId }) => streamId)).size !== expectedStreams.length) throw new StorageError("INVALID_COMMIT", "Expected streams must be unique");
    const eventBatches = request.eventBatches ?? [];
    if (new Set(eventBatches.map(({ streamId }) => streamId)).size !== eventBatches.length) throw new StorageError("INVALID_COMMIT", "Event batches must be unique per stream");
    const transactionId = `tx_${sha256({ commandId: command.commandId, commandFingerprint }).slice(0, 32)}`;
    let committed = false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT command_fingerprint FROM commands WHERE idempotency_key = ?").get(command.idempotencyKey);
      if (existing) {
        if (existing.command_fingerprint !== commandFingerprint) throw new StorageError("IDEMPOTENCY_KEY_REUSE", "Idempotency key is bound to another command", { idempotencyKey: command.idempotencyKey });
        const stored = this.db.prepare("SELECT receipt_json FROM receipts r JOIN commands c ON c.command_id = r.command_id WHERE c.idempotency_key = ?").get(command.idempotencyKey);
        this.db.exec("COMMIT");
        committed = true;
        return { replayed: true, receipt: replayedReceipt(parseJson(stored.receipt_json)), transactionId, eventPositions: [] };
      }

      for (const expectation of expectedStreams) {
        const row = this.db.prepare("SELECT version FROM streams WHERE stream_id = ?").get(expectation.streamId);
        const actual = Number(row?.version ?? 0);
        if (actual !== expectation.expectedStreamVersion) throw new StorageError("STALE_STREAM_VERSION", "Expected stream version does not match durable state", { streamId: expectation.streamId, expected: expectation.expectedStreamVersion, actual });
      }

      this.#insertCommand(command, commandFingerprint, receipt.status);
      for (const derived of request.additionalCommands ?? []) this.#insertCommand(derived.command, derived.commandFingerprint, "derived");
      const insertedEvents = [];
      for (const batch of [...eventBatches].sort((left, right) => left.streamId.localeCompare(right.streamId))) {
        const expectation = expectedStreams.find(({ streamId }) => streamId === batch.streamId);
        if (!expectation) throw new StorageError("INVALID_COMMIT", "Every event batch requires an expected stream", { streamId: batch.streamId });
        const streamType = expectation.streamType ?? streamTypeFor(batch.streamId);
        this.db.prepare("INSERT OR IGNORE INTO streams(stream_id, stream_type, version, last_event_hash) VALUES (?, ?, 0, NULL)").run(batch.streamId, streamType);
        const stream = this.db.prepare("SELECT version, last_event_hash FROM streams WHERE stream_id = ?").get(batch.streamId);
        let previousHash = stream.last_event_hash ?? null;
        let version = Number(stream.version);
        for (const event of batch.events) {
          const nextVersion = version + 1;
          if (event.streamId !== batch.streamId || event.streamVersion !== nextVersion) throw new StorageError("EVENT_VERSION_GAP", "Event batch must be contiguous and match its stream", { streamId: batch.streamId, expected: nextVersion });
          const commandExists = this.db.prepare("SELECT 1 AS present FROM commands WHERE command_id = ?").get(event.commandId);
          if (!commandExists) throw new StorageError("COMMAND_RECORD_MISSING", "Every event command must have a durable command record", { commandId: event.commandId });
          const eventJson = canonicalize(event);
          const eventHash = sha256({ previousStreamHash: previousHash, event });
          const result = this.db.prepare("INSERT INTO events(event_id, stream_id, stream_version, event_type, command_id, occurred_at, event_json, previous_stream_hash, event_hash, transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(event.eventId, event.streamId, event.streamVersion, event.type, event.commandId, event.occurredAt, eventJson, previousHash, eventHash, transactionId);
          const globalPosition = Number(result.lastInsertRowid);
          insertedEvents.push({ event, globalPosition, eventHash });
          if (event.type === "SettlementCommitted") {
            const settlementId = event.payload?.intent?.settlementId;
            if (typeof settlementId !== "string") throw new StorageError("SETTLEMENT_ID_MISSING", "SettlementCommitted must contain deterministic settlement ID");
            try {
              this.db.prepare("INSERT INTO settlement_uniqueness(settlement_id, event_id, committed_at) VALUES (?, ?, ?)").run(settlementId, event.eventId, event.occurredAt);
            } catch (error) {
              throw new StorageError("SETTLEMENT_ALREADY_COMMITTED", "Deterministic settlement ID is already committed", { settlementId });
            }
          }
          version = nextVersion;
          previousHash = eventHash;
        }
        this.db.prepare("UPDATE streams SET version = ?, last_event_hash = ? WHERE stream_id = ?").run(version, previousHash, batch.streamId);
      }

      if (injectionPoint === "after-events") throw new StorageError("INJECTED_CRASH", "Injected crash after event inserts");
      this.#insertReceipt(receipt);
      this.#verifyReceiptPositions(receipt);
      const lastGlobalPosition = insertedEvents.length > 0 ? insertedEvents.at(-1).globalPosition : Number(this.db.prepare("SELECT COALESCE(MAX(global_position), 0) AS position FROM events").get().position);
      for (const projection of request.projectionWrites ?? []) this.#upsertProjection(projection.projectionName, projection.projectionKey, projection.state, lastGlobalPosition);
      for (const projectionName of new Set((request.projectionWrites ?? []).map(({ projectionName }) => projectionName))) this.#upsertCheckpoint(projectionName, lastGlobalPosition);
      for (const message of request.outboxMessages ?? []) this.#insertOutbox(message, command.commandId, insertedEvents);
      if (injectionPoint === "before-commit") throw new StorageError("INJECTED_CRASH", "Injected crash before commit");
      this.db.exec("COMMIT");
      committed = true;
      if (injectionPoint === "after-commit") throw new InjectedCrashAfterCommitError(command.commandId);
      return {
        replayed: false,
        receipt,
        transactionId,
        eventPositions: insertedEvents.map(({ globalPosition, event }) => ({ globalPosition, eventId: event.eventId, streamId: event.streamId, streamVersion: event.streamVersion })),
      };
    } catch (error) {
      if (!committed) this.#rollbackQuietly();
      if (error instanceof StorageError) throw error;
      throw new StorageError("SQLITE_COMMIT_FAILED", "SQLite commit failed without partial writes", { cause: errorMessage(error) });
    }
  }

  #insertCommand(command, fingerprint, outcomeStatus) {
    assertNoSecretMaterial(command, "command");
    const commandJson = canonicalize(command);
    const commandHash = sha256(commandJson);
    this.db.prepare("INSERT INTO commands(command_id, idempotency_key, command_type, command_fingerprint, command_json, command_hash, outcome_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(command.commandId, command.idempotencyKey, command.type, fingerprint, commandJson, commandHash, outcomeStatus, command.issuedAt);
  }

  #insertReceipt(receipt) {
    const receiptJson = canonicalize(receipt);
    const receiptHash = sha256(receiptJson);
    this.db.prepare("INSERT INTO receipts(receipt_id, command_id, status, receipt_json, receipt_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(receipt.receiptId, receipt.commandId, receipt.status, receiptJson, receiptHash, receipt.createdAt);
  }

  #verifyReceiptPositions(receipt) {
    for (const position of receipt.eventPositions) {
      const event = this.db.prepare("SELECT event_id FROM events WHERE event_id = ? AND stream_id = ? AND stream_version = ?").get(position.eventId, position.streamId, position.streamVersion);
      if (!event) throw new StorageError("RECEIPT_EVENT_MISMATCH", "Receipt points to an event that is not committed", { eventId: position.eventId });
    }
  }

  #upsertProjection(projectionName, projectionKey, state, lastGlobalPosition) {
    const stateJson = canonicalize(state);
    const stateHash = sha256(stateJson);
    this.db.prepare("INSERT INTO projections(projection_name, projection_key, state_json, state_hash, last_global_position) VALUES (?, ?, ?, ?, ?) ON CONFLICT(projection_name, projection_key) DO UPDATE SET state_json = excluded.state_json, state_hash = excluded.state_hash, last_global_position = excluded.last_global_position").run(projectionName, projectionKey, stateJson, stateHash, lastGlobalPosition);
  }

  #upsertCheckpoint(projectionName, lastGlobalPosition) {
    const checkpointHash = sha256({ projectionName, lastGlobalPosition });
    this.db.prepare("INSERT INTO projection_checkpoints(projection_name, last_global_position, checkpoint_hash) VALUES (?, ?, ?) ON CONFLICT(projection_name) DO UPDATE SET last_global_position = excluded.last_global_position, checkpoint_hash = excluded.checkpoint_hash").run(projectionName, lastGlobalPosition, checkpointHash);
  }

  #insertOutbox(message, commandId, insertedEvents) {
    const inserted = insertedEvents.find(({ event }) => event.eventId === message.eventId);
    if (!inserted) throw new StorageError("OUTBOX_EVENT_MISMATCH", "Outbox messages must be caused by an event in the same transaction", { eventId: message.eventId });
    if (message.topic === "task.completed" && inserted.event.type !== "TaskCompleted") throw new StorageError("OUTBOX_EVENT_MISMATCH", "Completion outbox requires TaskCompleted in the same transaction", { eventId: message.eventId });
    const payloadJson = canonicalize(message.payload);
    const payloadHash = sha256(payloadJson);
    this.db.prepare("INSERT INTO outbox(outbox_id, event_id, command_id, topic, payload_json, payload_hash, created_at, published_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)").run(message.outboxId, message.eventId, commandId, message.topic, payloadJson, payloadHash, message.createdAt);
  }

  getProjection(projectionName, projectionKey) {
    this.#assertOpen();
    const row = this.db.prepare("SELECT state_json, state_hash, last_global_position FROM projections WHERE projection_name = ? AND projection_key = ?").get(projectionName, projectionKey);
    return row ? { state: parseJson(row.state_json), stateHash: row.state_hash, lastGlobalPosition: Number(row.last_global_position) } : null;
  }

  listProjection(projectionName) {
    this.#assertOpen();
    return this.db.prepare("SELECT projection_key, state_json, state_hash, last_global_position FROM projections WHERE projection_name = ? ORDER BY projection_key").all(projectionName).map((row) => ({ projectionKey: row.projection_key, state: parseJson(row.state_json), stateHash: row.state_hash, lastGlobalPosition: Number(row.last_global_position) }));
  }

  getCheckpoint(projectionName) {
    this.#assertOpen();
    const row = this.db.prepare("SELECT last_global_position, checkpoint_hash FROM projection_checkpoints WHERE projection_name = ?").get(projectionName);
    return row ? { lastGlobalPosition: Number(row.last_global_position), checkpointHash: row.checkpoint_hash } : null;
  }

  deleteProjection(projectionName) {
    this.#assertOpen();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM projections WHERE projection_name = ?").run(projectionName);
      this.db.prepare("DELETE FROM projection_checkpoints WHERE projection_name = ?").run(projectionName);
      this.db.exec("COMMIT");
    } catch (error) {
      this.#rollbackQuietly();
      throw error;
    }
  }

  rebuildProjection(projectionName, projector) {
    this.#assertOpen();
    if (!projector || typeof projector.keyFor !== "function" || typeof projector.initialState !== "function" || typeof projector.reduce !== "function") throw new StorageError("INVALID_PROJECTOR", "Projector requires keyFor, initialState, and reduce");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db.prepare("SELECT global_position, event_json FROM events ORDER BY global_position").all();
      const states = new Map();
      const positions = new Map();
      for (const row of rows) {
        const event = parseJson(row.event_json);
        const key = projector.keyFor(event);
        if (key === null || key === undefined) continue;
        const previous = states.has(key) ? states.get(key) : projector.initialState(key, event);
        const next = projector.reduce(structuredClone(previous), event);
        assertNoSecretMaterial(next, "projection");
        states.set(key, next);
        positions.set(key, Number(row.global_position));
      }
      this.db.prepare("DELETE FROM projections WHERE projection_name = ?").run(projectionName);
      this.db.prepare("DELETE FROM projection_checkpoints WHERE projection_name = ?").run(projectionName);
      for (const [key, state] of [...states].sort(([left], [right]) => String(left).localeCompare(String(right)))) this.#upsertProjection(projectionName, String(key), state, positions.get(key));
      const lastGlobalPosition = rows.length > 0 ? Number(rows.at(-1).global_position) : 0;
      this.#upsertCheckpoint(projectionName, lastGlobalPosition);
      this.db.exec("COMMIT");
      return this.listProjection(projectionName);
    } catch (error) {
      this.#rollbackQuietly();
      throw error;
    }
  }

  listOutbox({ pendingOnly = false } = {}) {
    this.#assertOpen();
    const where = pendingOnly ? "WHERE published_at IS NULL" : "";
    return this.db.prepare(`SELECT outbox_id, event_id, command_id, topic, payload_json, payload_hash, created_at, published_at, attempts FROM outbox ${where} ORDER BY created_at, outbox_id`).all().map((row) => ({ outboxId: row.outbox_id, eventId: row.event_id, commandId: row.command_id, topic: row.topic, payload: parseJson(row.payload_json), payloadHash: row.payload_hash, createdAt: row.created_at, publishedAt: row.published_at, attempts: Number(row.attempts) }));
  }

  markOutboxPublished(outboxId, publishedAt) {
    this.#assertOpen();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare("UPDATE outbox SET published_at = ?, attempts = attempts + 1 WHERE outbox_id = ? AND published_at IS NULL").run(publishedAt, outboxId);
      if (Number(result.changes) !== 1) throw new StorageError("OUTBOX_NOT_PENDING", "Outbox message is absent or already published", { outboxId });
      this.db.exec("COMMIT");
    } catch (error) {
      this.#rollbackQuietly();
      throw error;
    }
  }

  verifyIntegrity() {
    this.#assertOpen();
    const errors = [];
    for (const row of this.db.prepare("SELECT command_id, command_json, command_hash FROM commands ORDER BY command_id").all()) {
      if (sha256(row.command_json) !== row.command_hash) errors.push({ kind: "command", id: row.command_id });
    }
    const previousByStream = new Map();
    for (const row of this.db.prepare("SELECT event_id, stream_id, event_json, previous_stream_hash, event_hash FROM events ORDER BY global_position").all()) {
      const previous = previousByStream.get(row.stream_id) ?? null;
      const event = parseJson(row.event_json);
      const expected = sha256({ previousStreamHash: previous, event });
      if (row.previous_stream_hash !== previous || row.event_hash !== expected) errors.push({ kind: "event", id: row.event_id });
      previousByStream.set(row.stream_id, row.event_hash);
    }
    for (const row of this.db.prepare("SELECT receipt_id, receipt_json, receipt_hash FROM receipts ORDER BY receipt_id").all()) {
      if (sha256(row.receipt_json) !== row.receipt_hash) errors.push({ kind: "receipt", id: row.receipt_id });
      const receipt = parseJson(row.receipt_json);
      for (const position of receipt.eventPositions) {
        if (!this.db.prepare("SELECT 1 AS present FROM events WHERE event_id = ? AND stream_id = ? AND stream_version = ?").get(position.eventId, position.streamId, position.streamVersion)) errors.push({ kind: "receipt-position", id: row.receipt_id, eventId: position.eventId });
      }
    }
    for (const row of this.db.prepare("SELECT projection_name, projection_key, state_json, state_hash FROM projections ORDER BY projection_name, projection_key").all()) {
      if (sha256(row.state_json) !== row.state_hash) errors.push({ kind: "projection", id: `${row.projection_name}:${row.projection_key}` });
    }
    for (const row of this.db.prepare("SELECT outbox_id, payload_json, payload_hash FROM outbox ORDER BY outbox_id").all()) {
      if (sha256(row.payload_json) !== row.payload_hash) errors.push({ kind: "outbox", id: row.outbox_id });
    }
    return { ok: errors.length === 0, errors, hashSemantics: "corruption-detection-only" };
  }

  exportCanonicalData() {
    this.#assertOpen();
    const exported = {
      events: this.readAll().map(({ globalPosition, event, eventHash }) => ({ globalPosition, event, eventHash })),
      receipts: this.db.prepare("SELECT receipt_json FROM receipts ORDER BY receipt_id").all().map(({ receipt_json }) => parseJson(receipt_json)),
      projections: this.db.prepare("SELECT projection_name, projection_key, state_json FROM projections ORDER BY projection_name, projection_key").all().map((row) => ({ projectionName: row.projection_name, projectionKey: row.projection_key, state: parseJson(row.state_json) })),
      outbox: this.listOutbox(),
    };
    assertNoSecretMaterial(exported, "export");
    return canonicalize(exported);
  }

  async backupTo(destination) {
    this.#assertOpen();
    mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
    this.db.exec("PRAGMA wal_checkpoint(FULL)");
    await sqliteBackup(this.db, destination);
    const backupDb = new DatabaseSync(destination);
    try {
      const quickCheck = backupDb.prepare("PRAGMA quick_check").get().quick_check;
      if (quickCheck !== "ok") throw new StorageError("BACKUP_INTEGRITY_FAILED", "SQLite backup failed quick_check", { quickCheck });
    } finally {
      backupDb.close();
    }
    return destination;
  }

  static restoreFromBackup(backupPath, destination, options = {}) {
    mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
    copyFileSync(backupPath, destination);
    const restored = new SqliteJournal(destination, options);
    const integrity = restored.verifyIntegrity();
    if (!integrity.ok) {
      restored.close();
      throw new StorageError("RESTORE_INTEGRITY_FAILED", "Restored database failed integrity verification", { errors: integrity.errors });
    }
    return restored;
  }

  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
