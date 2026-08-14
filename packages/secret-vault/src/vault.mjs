import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { canonicalize, assertNoSecretMaterial, sha256 } from "../../storage-sqlite/src/canonical.mjs";
import { StorageError } from "../../storage-sqlite/src/errors.mjs";

const VAULT_MIGRATION = `
  CREATE TABLE vault_secrets (
    secret_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    nonce BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    auth_tag BLOB NOT NULL,
    metadata_json TEXT NOT NULL,
    metadata_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
`;

function validateKey(key) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) throw new StorageError("INVALID_VAULT_KEY", "Vault key must be exactly 32 bytes");
  return Buffer.from(key);
}

function aad(secretId, kind) {
  return Buffer.from(canonicalize({ secretId, kind }), "utf8");
}

function encrypt(key, secretId, kind, plaintext) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(secretId, kind));
  const ciphertext = Buffer.concat([cipher.update(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), "utf8")), cipher.final()]);
  return { nonce, ciphertext, authTag: cipher.getAuthTag() };
}

function decrypt(key, row) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.nonce));
    decipher.setAAD(aad(row.secret_id, row.kind));
    decipher.setAuthTag(Buffer.from(row.auth_tag));
    return Buffer.concat([decipher.update(Buffer.from(row.ciphertext)), decipher.final()]);
  } catch {
    throw new StorageError("VAULT_DECRYPTION_FAILED", "Vault entry could not be authenticated or decrypted", { secretId: row.secret_id });
  }
}

export function deriveLocalVaultKey(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < 12) throw new StorageError("INVALID_VAULT_PASSPHRASE", "Vault passphrase must contain at least twelve characters");
  if (!(salt instanceof Uint8Array) || salt.byteLength < 16) throw new StorageError("INVALID_VAULT_SALT", "Vault key derivation salt must contain at least sixteen bytes");
  return scryptSync(passphrase, Buffer.from(salt), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export class LocalSecretVault {
  constructor(filename, key, options = {}) {
    this.filename = filename;
    this.key = validateKey(key);
    this.busyTimeoutMs = options.busyTimeoutMs ?? 2_500;
    if (!Number.isInteger(this.busyTimeoutMs) || this.busyTimeoutMs < 1 || this.busyTimeoutMs > 30_000) throw new StorageError("INVALID_BUSY_TIMEOUT", "Vault busy timeout must be bounded");
    mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.closed = false;
    this.db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.#migrate();
    try { chmodSync(filename, 0o600); } catch { /* Windows ACLs are managed outside chmod semantics */ }
  }

  #migrate() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("CREATE TABLE IF NOT EXISTS vault_schema(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT");
      const checksum = sha256(VAULT_MIGRATION);
      const existing = this.db.prepare("SELECT checksum FROM vault_schema WHERE version = 1").get();
      if (!existing) {
        this.db.exec(VAULT_MIGRATION);
        this.db.prepare("INSERT INTO vault_schema(version, checksum, applied_at) VALUES (1, ?, ?)").run(checksum, new Date().toISOString());
        this.db.exec("PRAGMA user_version = 1");
      } else if (existing.checksum !== checksum) {
        throw new StorageError("MIGRATION_CHECKSUM_MISMATCH", "Vault migration checksum differs from the applied schema");
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* no active transaction */ }
      throw error;
    }
  }

  #assertOpen() {
    if (this.closed) throw new StorageError("VAULT_CLOSED", "Local secret vault is closed");
  }

  putSecret({ secretId, kind, plaintext, metadata = {}, now = new Date().toISOString() }) {
    this.#assertOpen();
    if (typeof secretId !== "string" || !secretId || typeof kind !== "string" || !kind) throw new StorageError("INVALID_VAULT_ENTRY", "Secret ID and kind are required");
    assertNoSecretMaterial(metadata, "vault.metadata");
    const metadataJson = canonicalize(metadata);
    const encrypted = encrypt(this.key, secretId, kind, plaintext);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO vault_secrets(secret_id, kind, nonce, ciphertext, auth_tag, metadata_json, metadata_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(secret_id) DO UPDATE SET kind = excluded.kind, nonce = excluded.nonce, ciphertext = excluded.ciphertext,
          auth_tag = excluded.auth_tag, metadata_json = excluded.metadata_json, metadata_hash = excluded.metadata_hash, updated_at = excluded.updated_at
      `).run(secretId, kind, encrypted.nonce, encrypted.ciphertext, encrypted.authTag, metadataJson, sha256(metadataJson), now, now);
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* no active transaction */ }
      throw error;
    }
    return { secretId, kind, metadata: structuredClone(metadata), updatedAt: now };
  }

  getSecret(secretId) {
    this.#assertOpen();
    const row = this.db.prepare("SELECT * FROM vault_secrets WHERE secret_id = ?").get(secretId);
    if (!row) return null;
    return { secretId: row.secret_id, kind: row.kind, plaintext: decrypt(this.key, row), metadata: JSON.parse(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  listMetadata() {
    this.#assertOpen();
    return this.db.prepare("SELECT secret_id, kind, metadata_json, created_at, updated_at FROM vault_secrets ORDER BY secret_id").all().map((row) => ({ secretId: row.secret_id, kind: row.kind, metadata: JSON.parse(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  deleteSecret(secretId) {
    this.#assertOpen();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare("DELETE FROM vault_secrets WHERE secret_id = ?").run(secretId);
      this.db.exec("COMMIT");
      return Number(result.changes) === 1;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* no active transaction */ }
      throw error;
    }
  }

  rotateKey(nextKey, now = new Date().toISOString()) {
    this.#assertOpen();
    const validated = validateKey(nextKey);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db.prepare("SELECT * FROM vault_secrets ORDER BY secret_id").all();
      for (const row of rows) {
        const plaintext = decrypt(this.key, row);
        const encrypted = encrypt(validated, row.secret_id, row.kind, plaintext);
        this.db.prepare("UPDATE vault_secrets SET nonce = ?, ciphertext = ?, auth_tag = ?, updated_at = ? WHERE secret_id = ?").run(encrypted.nonce, encrypted.ciphertext, encrypted.authTag, now, row.secret_id);
        plaintext.fill(0);
      }
      this.db.exec("COMMIT");
      this.key.fill(0);
      this.key = validated;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* no active transaction */ }
      throw error;
    }
  }

  close() {
    if (this.closed) return;
    this.db.exec("PRAGMA wal_checkpoint(FULL)");
    this.db.close();
    this.key.fill(0);
    this.closed = true;
  }
}
