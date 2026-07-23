export const SQLITE_MIGRATIONS = Object.freeze([
  {
    version: 1,
    name: "journal_commands_receipts",
    sql: `
      CREATE TABLE streams (
        stream_id TEXT PRIMARY KEY,
        stream_type TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        last_event_hash TEXT
      ) STRICT;

      CREATE TABLE commands (
        command_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        command_type TEXT NOT NULL,
        command_fingerprint TEXT NOT NULL,
        command_json TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        outcome_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE events (
        global_position INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        stream_id TEXT NOT NULL REFERENCES streams(stream_id),
        stream_version INTEGER NOT NULL CHECK (stream_version > 0),
        event_type TEXT NOT NULL,
        command_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        event_json TEXT NOT NULL,
        previous_stream_hash TEXT,
        event_hash TEXT NOT NULL UNIQUE,
        transaction_id TEXT NOT NULL,
        UNIQUE (stream_id, stream_version)
      ) STRICT;

      CREATE INDEX events_command_id_idx ON events(command_id);
      CREATE INDEX events_transaction_id_idx ON events(transaction_id);

      CREATE TABLE receipts (
        receipt_id TEXT PRIMARY KEY,
        command_id TEXT NOT NULL UNIQUE REFERENCES commands(command_id),
        status TEXT NOT NULL CHECK (status IN ('executed', 'cancelled', 'not-executed')),
        receipt_json TEXT NOT NULL,
        receipt_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE settlement_uniqueness (
        settlement_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE REFERENCES events(event_id),
        committed_at TEXT NOT NULL
      ) STRICT;

      CREATE TRIGGER events_immutable_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;
      CREATE TRIGGER events_immutable_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;
      CREATE TRIGGER receipts_immutable_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'receipts are immutable'); END;
      CREATE TRIGGER receipts_immutable_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT, 'receipts are immutable'); END;
      CREATE TRIGGER commands_immutable_update BEFORE UPDATE ON commands BEGIN SELECT RAISE(ABORT, 'commands are immutable'); END;
      CREATE TRIGGER commands_immutable_delete BEFORE DELETE ON commands BEGIN SELECT RAISE(ABORT, 'commands are immutable'); END;
    `,
  },
  {
    version: 2,
    name: "projections_checkpoints_outbox",
    sql: `
      CREATE TABLE projections (
        projection_name TEXT NOT NULL,
        projection_key TEXT NOT NULL,
        state_json TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        last_global_position INTEGER NOT NULL CHECK (last_global_position >= 0),
        PRIMARY KEY (projection_name, projection_key)
      ) STRICT;

      CREATE TABLE projection_checkpoints (
        projection_name TEXT PRIMARY KEY,
        last_global_position INTEGER NOT NULL CHECK (last_global_position >= 0),
        checkpoint_hash TEXT NOT NULL
      ) STRICT;

      CREATE TABLE outbox (
        outbox_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(event_id),
        command_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
      ) STRICT;

      CREATE INDEX outbox_pending_idx ON outbox(published_at, created_at, outbox_id);

      CREATE TRIGGER outbox_payload_immutable BEFORE UPDATE OF outbox_id, event_id, command_id, topic, payload_json, payload_hash, created_at ON outbox BEGIN SELECT RAISE(ABORT, 'outbox payload is immutable'); END;
      CREATE TRIGGER outbox_immutable_delete BEFORE DELETE ON outbox BEGIN SELECT RAISE(ABORT, 'outbox is append-only'); END;
    `,
  },
]);
