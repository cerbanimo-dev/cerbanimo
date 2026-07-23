import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ProofContractError,
  assertPublicMetadata,
  canonicalize,
  cloneJson,
  disclosureAllows,
  normalizeDisclosureScope,
  normalizeRetentionPolicy,
  requireText,
  requireTimestamp,
  sha256,
} from "../../proof/src/index.mjs";

export class EvidenceStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "EvidenceStoreError";
    this.code = code;
    this.details = details;
  }
}

const MIGRATION = `
  CREATE TABLE artifacts (
    content_digest TEXT PRIMARY KEY,
    byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
    blob_path TEXT NOT NULL UNIQUE,
    content_nonce BLOB NOT NULL,
    content_auth_tag BLOB NOT NULL,
    ciphertext_hash TEXT NOT NULL,
    recoverable INTEGER NOT NULL CHECK(recoverable IN (0, 1)),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE custodies (
    custody_id TEXT PRIMARY KEY,
    content_digest TEXT NOT NULL REFERENCES artifacts(content_digest),
    artifact_id TEXT NOT NULL,
    artifact_kind TEXT NOT NULL,
    owner_identity_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    privacy_classification TEXT NOT NULL,
    retention_json TEXT NOT NULL,
    disclosure_json TEXT NOT NULL,
    public_metadata_json TEXT NOT NULL,
    wrapped_key_nonce BLOB,
    wrapped_key_ciphertext BLOB,
    wrapped_key_auth_tag BLOB,
    capture_kind TEXT NOT NULL,
    source_uri TEXT,
    captured_by_json TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'purged')),
    purged_at TEXT
  ) STRICT;
  CREATE INDEX custodies_digest_status_idx ON custodies(content_digest, status);
  CREATE TABLE purge_tombstones (
    tombstone_id TEXT PRIMARY KEY,
    custody_id TEXT NOT NULL UNIQUE,
    content_digest TEXT NOT NULL,
    owner_identity_id TEXT NOT NULL,
    retention_policy_id TEXT NOT NULL,
    purged_by_json TEXT NOT NULL,
    purged_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    recoverable_for_other_custodies INTEGER NOT NULL CHECK(recoverable_for_other_custodies IN (0, 1))
  ) STRICT;
  CREATE TRIGGER tombstones_immutable_update BEFORE UPDATE ON purge_tombstones BEGIN SELECT RAISE(ABORT, 'purge tombstones are immutable'); END;
  CREATE TRIGGER tombstones_immutable_delete BEFORE DELETE ON purge_tombstones BEGIN SELECT RAISE(ABORT, 'purge tombstones are immutable'); END;
`;

function validateKey(key) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) throw new EvidenceStoreError("INVALID_EVIDENCE_STORE_KEY", "Evidence-store key must be exactly 32 bytes");
  return Buffer.from(key);
}

function validateBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new EvidenceStoreError("INVALID_ARTIFACT_BYTES", "Artifact bytes must be a Uint8Array");
  return Buffer.from(bytes);
}

function encrypt(key, plaintext, aad) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext, authTag: cipher.getAuthTag() };
}

function decrypt(key, nonce, ciphertext, authTag, aad, code) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(authTag));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
  } catch {
    throw new EvidenceStoreError(code, "Encrypted evidence material could not be authenticated or decrypted");
  }
}

function actorRoles(actor) {
  if (!actor || typeof actor !== "object" || !Array.isArray(actor.roles)) throw new EvidenceStoreError("PURGE_NOT_AUTHORIZED", "An attributable actor with roles is required");
  return actor.roles;
}

function normalizeActor(actor, field = "actor") {
  assertPublicMetadata(actor, field);
  const roles = actorRoles(actor).map((role) => requireText(role, `${field}.roles`)).sort();
  if (actor.kind === "human") return { kind: "human", rootIdentityId: requireText(actor.rootIdentityId, `${field}.rootIdentityId`), deviceId: requireText(actor.deviceId, `${field}.deviceId`), roles };
  if (actor.kind === "service") return { kind: "service", serviceId: requireText(actor.serviceId, `${field}.serviceId`), delegatedByRootIdentityId: requireText(actor.delegatedByRootIdentityId, `${field}.delegatedByRootIdentityId`), roles };
  throw new EvidenceStoreError("INVALID_ACTOR", `${field} must be an attributable human or service actor`);
}

function safeRelativeBlobPath(digest) {
  return path.join("blobs", digest.slice(0, 2), `${digest}.blob`);
}

function parseJson(value) { return JSON.parse(value); }

function normalizedPrivacy(value) {
  if (!["public", "community", "private", "restricted"].includes(value)) throw new EvidenceStoreError("INVALID_PRIVACY_CLASSIFICATION", "Evidence privacy classification is invalid");
  return value;
}

export class EncryptedEvidenceStore {
  constructor(rootDirectory, masterKey, options = {}) {
    this.rootDirectory = path.resolve(requireText(rootDirectory, "rootDirectory"));
    this.masterKey = validateKey(masterKey);
    this.busyTimeoutMs = options.busyTimeoutMs ?? 2_500;
    if (!Number.isSafeInteger(this.busyTimeoutMs) || this.busyTimeoutMs < 1 || this.busyTimeoutMs > 30_000) throw new EvidenceStoreError("INVALID_BUSY_TIMEOUT", "Evidence-store busy timeout must be bounded");
    mkdirSync(this.rootDirectory, { recursive: true });
    mkdirSync(path.join(this.rootDirectory, "blobs"), { recursive: true });
    this.databasePath = path.join(this.rootDirectory, "evidence-custody.sqlite");
    this.db = new DatabaseSync(this.databasePath);
    this.closed = false;
    this.db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec("PRAGMA secure_delete = ON");
    try { this.#migrate(); } catch (error) { this.db.close(); this.masterKey.fill(0); throw error; }
  }

  #migrate() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("CREATE TABLE IF NOT EXISTS evidence_store_schema(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT");
      const checksum = sha256(MIGRATION);
      const current = this.db.prepare("SELECT checksum FROM evidence_store_schema WHERE version = 1").get();
      if (!current) {
        this.db.exec(MIGRATION);
        this.db.prepare("INSERT INTO evidence_store_schema(version, checksum, applied_at) VALUES (1, ?, ?)").run(checksum, new Date().toISOString());
        this.db.exec("PRAGMA user_version = 1");
      } else if (current.checksum !== checksum) throw new EvidenceStoreError("MIGRATION_CHECKSUM_MISMATCH", "Evidence-store migration history changed");
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* no active transaction */ }
      throw error;
    }
  }

  #assertOpen() {
    if (this.closed) throw new EvidenceStoreError("EVIDENCE_STORE_CLOSED", "Evidence store is closed");
  }

  #wrapKey(dataKey, custodyId, digest) {
    return encrypt(this.masterKey, dataKey, canonicalize({ custodyId, digest }));
  }

  #unwrapKey(row) {
    if (!row.wrapped_key_nonce || !row.wrapped_key_ciphertext || !row.wrapped_key_auth_tag) throw new EvidenceStoreError("ARTIFACT_PURGED", "Custody key was cryptographically erased", { custodyId: row.custody_id });
    return decrypt(this.masterKey, row.wrapped_key_nonce, row.wrapped_key_ciphertext, row.wrapped_key_auth_tag, canonicalize({ custodyId: row.custody_id, digest: row.content_digest }), "CUSTODY_KEY_DECRYPTION_FAILED");
  }

  putArtifact(input) {
    this.#assertOpen();
    const bytes = validateBytes(input.bytes);
    const contentDigest = sha256(bytes);
    const custodyId = requireText(input.custodyId, "custodyId");
    const artifactId = requireText(input.artifactId, "artifactId");
    const artifactKind = requireText(input.artifactKind, "artifactKind");
    const ownerIdentityId = requireText(input.ownerIdentityId, "ownerIdentityId");
    const mediaType = requireText(input.mediaType, "mediaType").toLowerCase();
    const privacyClassification = normalizedPrivacy(input.privacyClassification);
    let retentionPolicy;
    let disclosureScope;
    try {
      retentionPolicy = normalizeRetentionPolicy(input.retentionPolicy);
      disclosureScope = normalizeDisclosureScope(input.disclosureScope);
    } catch (error) {
      if (error instanceof ProofContractError) throw new EvidenceStoreError(error.code, error.message, error.details);
      throw error;
    }
    const publicMetadata = cloneJson(input.publicMetadata ?? {});
    assertPublicMetadata(publicMetadata, "publicMetadata");
    const capturedAt = requireTimestamp(input.capturedAt, "capturedAt");
    const captureKind = input.captureKind ?? "local-upload";
    if (!["local-upload", "constrained-fetch"].includes(captureKind)) throw new EvidenceStoreError("INVALID_CAPTURE_PROVENANCE", "Capture kind must identify a constrained preserved source");
    const sourceUri = input.sourceUri === null || input.sourceUri === undefined ? null : requireText(input.sourceUri, "sourceUri");
    const capturedBy = normalizeActor(input.capturedBy, "capturedBy");
    const capturedByJson = canonicalize(capturedBy);
    const relativeBlobPath = safeRelativeBlobPath(contentDigest);
    const blobPath = path.join(this.rootDirectory, relativeBlobPath);
    let dataKey;
    let encryptedContent = null;
    let newArtifact = false;
    let temporaryPath = null;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT 1 AS present FROM custodies WHERE custody_id = ?").get(custodyId)) throw new EvidenceStoreError("CUSTODY_ALREADY_EXISTS", "Custody ID is immutable and already exists", { custodyId });
      const artifact = this.db.prepare("SELECT * FROM artifacts WHERE content_digest = ?").get(contentDigest);
      if (artifact && Number(artifact.recoverable) === 1) {
        if (Number(artifact.byte_size) !== bytes.byteLength) throw new EvidenceStoreError("CONTENT_ADDRESS_COLLISION", "Digest resolved to another byte size");
        const sourceCustody = this.db.prepare("SELECT * FROM custodies WHERE content_digest = ? AND status = 'active' ORDER BY custody_id LIMIT 1").get(contentDigest);
        if (!sourceCustody) throw new EvidenceStoreError("ARTIFACT_UNRECOVERABLE", "Deduplicated content has no recoverable custody key");
        dataKey = this.#unwrapKey(sourceCustody);
      } else {
        newArtifact = true;
        dataKey = randomBytes(32);
        encryptedContent = encrypt(dataKey, bytes, contentDigest);
        mkdirSync(path.dirname(blobPath), { recursive: true });
        temporaryPath = `${blobPath}.${randomBytes(8).toString("hex")}.tmp`;
        writeFileSync(temporaryPath, encryptedContent.ciphertext, { flag: "wx" });
        renameSync(temporaryPath, blobPath);
        temporaryPath = null;
        if (artifact) {
          this.db.prepare("UPDATE artifacts SET byte_size = ?, blob_path = ?, content_nonce = ?, content_auth_tag = ?, ciphertext_hash = ?, recoverable = 1, created_at = ? WHERE content_digest = ?").run(bytes.byteLength, relativeBlobPath, encryptedContent.nonce, encryptedContent.authTag, sha256(encryptedContent.ciphertext), capturedAt, contentDigest);
        } else {
          this.db.prepare("INSERT INTO artifacts(content_digest, byte_size, blob_path, content_nonce, content_auth_tag, ciphertext_hash, recoverable, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)").run(contentDigest, bytes.byteLength, relativeBlobPath, encryptedContent.nonce, encryptedContent.authTag, sha256(encryptedContent.ciphertext), capturedAt);
        }
      }
      const wrapped = this.#wrapKey(dataKey, custodyId, contentDigest);
      this.db.prepare(`INSERT INTO custodies(
        custody_id, content_digest, artifact_id, artifact_kind, owner_identity_id, media_type, privacy_classification,
        retention_json, disclosure_json, public_metadata_json, wrapped_key_nonce, wrapped_key_ciphertext, wrapped_key_auth_tag,
        capture_kind, source_uri, captured_by_json, captured_at, status, purged_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL)`).run(
        custodyId, contentDigest, artifactId, artifactKind, ownerIdentityId, mediaType, privacyClassification,
        canonicalize(retentionPolicy), canonicalize(disclosureScope), canonicalize(publicMetadata), wrapped.nonce, wrapped.ciphertext,
        wrapped.authTag, captureKind, sourceUri, capturedByJson, capturedAt,
      );
      this.db.exec("COMMIT");
      dataKey.fill(0);
      return {
        deduplicated: !newArtifact,
        manifest: {
          artifactId, artifactKind, contentDigest, byteSize: bytes.byteLength, mediaType,
          capture: { kind: captureKind, preserved: true, custodyId, capturedAt, capturedBy, sourceUri },
          requirementIds: [...new Set(input.requirementIds ?? [])].sort(), privacyClassification,
          retentionPolicy, disclosureScope, publicMetadata,
        },
      };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* no active transaction */ }
      if (dataKey) dataKey.fill(0);
      if (temporaryPath && existsSync(temporaryPath)) unlinkSync(temporaryPath);
      const durableArtifact = this.db.prepare("SELECT recoverable FROM artifacts WHERE content_digest = ?").get(contentDigest);
      if (newArtifact && existsSync(blobPath) && (!durableArtifact || Number(durableArtifact.recoverable) === 0)) unlinkSync(blobPath);
      throw error;
    }
  }

  readArtifact(custodyId, { audience, purpose, reviewerIdentityId }) {
    this.#assertOpen();
    const row = this.db.prepare("SELECT c.*, a.byte_size, a.blob_path, a.content_nonce, a.content_auth_tag, a.ciphertext_hash FROM custodies c LEFT JOIN artifacts a ON a.content_digest = c.content_digest WHERE c.custody_id = ?").get(custodyId);
    if (!row) throw new EvidenceStoreError("CUSTODY_NOT_FOUND", "Evidence custody does not exist", { custodyId });
    if (row.status !== "active") throw new EvidenceStoreError("ARTIFACT_PURGED", "Evidence custody was cryptographically erased", { custodyId });
    const disclosure = parseJson(row.disclosure_json);
    if (!disclosureAllows(disclosure, audience, purpose, reviewerIdentityId)) throw new EvidenceStoreError("DISCLOSURE_NOT_AUTHORIZED", "Artifact disclosure is not authorized", { custodyId });
    const key = this.#unwrapKey(row);
    try {
      const ciphertext = readFileSync(path.join(this.rootDirectory, row.blob_path));
      if (sha256(ciphertext) !== row.ciphertext_hash) throw new EvidenceStoreError("ARTIFACT_CIPHERTEXT_CORRUPT", "Encrypted artifact failed integrity hashing", { custodyId });
      const plaintext = decrypt(key, row.content_nonce, ciphertext, row.content_auth_tag, row.content_digest, "ARTIFACT_DECRYPTION_FAILED");
      if (plaintext.byteLength !== Number(row.byte_size) || sha256(plaintext) !== row.content_digest) {
        plaintext.fill(0);
        throw new EvidenceStoreError("ARTIFACT_DIGEST_MISMATCH", "Recovered artifact does not match its content address", { custodyId });
      }
      return plaintext;
    } finally {
      key.fill(0);
    }
  }

  getCustody(custodyId) {
    this.#assertOpen();
    const row = this.db.prepare("SELECT custody_id, content_digest, artifact_id, artifact_kind, owner_identity_id, media_type, privacy_classification, retention_json, disclosure_json, public_metadata_json, capture_kind, source_uri, captured_by_json, captured_at, status, purged_at FROM custodies WHERE custody_id = ?").get(custodyId);
    if (!row) return null;
    return {
      custodyId: row.custody_id, contentDigest: row.content_digest, artifactId: row.artifact_id, artifactKind: row.artifact_kind,
      ownerIdentityId: row.owner_identity_id, mediaType: row.media_type, privacyClassification: row.privacy_classification,
      retentionPolicy: parseJson(row.retention_json), disclosureScope: parseJson(row.disclosure_json), publicMetadata: parseJson(row.public_metadata_json),
      capture: { kind: row.capture_kind, sourceUri: row.source_uri, capturedBy: parseJson(row.captured_by_json), capturedAt: row.captured_at },
      status: row.status, purgedAt: row.purged_at,
    };
  }

  purgeCustody({ custodyId, actor, purgedAt, reason }) {
    this.#assertOpen();
    const at = requireTimestamp(purgedAt, "purgedAt");
    const purgeActor = normalizeActor(actor, "purgedBy");
    const roles = purgeActor.roles;
    let blobToDelete = null;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT c.*, a.blob_path FROM custodies c JOIN artifacts a ON a.content_digest = c.content_digest WHERE c.custody_id = ?").get(custodyId);
      if (!row) throw new EvidenceStoreError("CUSTODY_NOT_FOUND", "Evidence custody does not exist", { custodyId });
      if (row.status !== "active") throw new EvidenceStoreError("ARTIFACT_ALREADY_PURGED", "Evidence custody already has a purge tombstone", { custodyId });
      const retention = parseJson(row.retention_json);
      if (retention.mode === "legal-hold" || retention.mode !== "purge-after" || Date.parse(at) < Date.parse(retention.purgeEligibleAt)) throw new EvidenceStoreError("RETENTION_POLICY_FORBIDS_PURGE", "Retention policy does not permit purge at this time", { custodyId, policyId: retention.policyId });
      if (!roles.some((role) => retention.authorizedPurgerRoles.includes(role))) throw new EvidenceStoreError("PURGE_NOT_AUTHORIZED", "Actor lacks a retention-policy purge role", { custodyId });
      this.db.prepare("UPDATE custodies SET wrapped_key_nonce = NULL, wrapped_key_ciphertext = NULL, wrapped_key_auth_tag = NULL, status = 'purged', purged_at = ? WHERE custody_id = ?").run(at, custodyId);
      const remaining = Number(this.db.prepare("SELECT COUNT(*) AS count FROM custodies WHERE content_digest = ? AND status = 'active'").get(row.content_digest).count);
      const tombstone = {
        schemaVersion: "cerbanimo.evidence-tombstone/1.1.0",
        tombstoneId: `tombstone_${sha256({ custodyId, contentDigest: row.content_digest, purgedAt: at }).slice(0, 32)}`,
        custodyId,
        contentDigest: row.content_digest,
        ownerIdentityId: row.owner_identity_id,
        retentionPolicyId: retention.policyId,
        purgedBy: purgeActor,
        purgedAt: at,
        reason: requireText(reason, "reason"),
        contentStatus: "cryptographically-erased",
        reviewability: "not-reviewable-through-this-custody",
        recoverableForOtherCustodies: remaining > 0,
      };
      this.db.prepare("INSERT INTO purge_tombstones(tombstone_id, custody_id, content_digest, owner_identity_id, retention_policy_id, purged_by_json, purged_at, reason, recoverable_for_other_custodies) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(tombstone.tombstoneId, custodyId, row.content_digest, row.owner_identity_id, retention.policyId, canonicalize(purgeActor), at, tombstone.reason, remaining > 0 ? 1 : 0);
      if (remaining === 0) {
        blobToDelete = path.join(this.rootDirectory, row.blob_path);
        this.db.prepare("UPDATE artifacts SET recoverable = 0 WHERE content_digest = ?").run(row.content_digest);
      }
      this.db.exec("COMMIT");
      if (blobToDelete && existsSync(blobToDelete)) unlinkSync(blobToDelete);
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      this.db.exec("VACUUM");
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      return { tombstone, event: { type: "EvidenceArtifactPurged", payload: { tombstone } } };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* no active transaction */ }
      throw error;
    }
  }

  getTombstone(custodyId) {
    const row = this.db.prepare("SELECT * FROM purge_tombstones WHERE custody_id = ?").get(custodyId);
    if (!row) return null;
    return {
      schemaVersion: "cerbanimo.evidence-tombstone/1.1.0", tombstoneId: row.tombstone_id, custodyId: row.custody_id,
      contentDigest: row.content_digest, ownerIdentityId: row.owner_identity_id, retentionPolicyId: row.retention_policy_id,
      purgedBy: parseJson(row.purged_by_json), purgedAt: row.purged_at, reason: row.reason, contentStatus: "cryptographically-erased",
      reviewability: "not-reviewable-through-this-custody", recoverableForOtherCustodies: Number(row.recoverable_for_other_custodies) === 1,
    };
  }

  close() {
    if (this.closed) return;
    this.db.exec("PRAGMA wal_checkpoint(FULL)");
    this.db.close();
    this.masterKey.fill(0);
    this.closed = true;
  }
}

function forbiddenFetchHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export async function captureThroughConstrainedFetch(store, { url, allowedHosts, allowedMediaTypes, maxBytes, fetcher, custody }) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new EvidenceStoreError("REMOTE_URL_INVALID", "Remote capture URL is invalid"); }
  const hosts = new Set((allowedHosts ?? []).map((host) => String(host).toLowerCase()));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || forbiddenFetchHost(parsed.hostname) || !hosts.has(parsed.hostname.toLowerCase())) throw new EvidenceStoreError("REMOTE_FETCH_NOT_ALLOWED", "Remote capture URL is outside the explicit HTTPS host allowlist");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new EvidenceStoreError("REMOTE_FETCH_POLICY_INVALID", "Remote capture requires a positive byte limit");
  if (typeof fetcher !== "function") throw new EvidenceStoreError("REMOTE_FETCH_BOUNDARY_MISSING", "A constrained fetch implementation is required");
  const result = await fetcher({ url: parsed.toString(), maxBytes, allowedMediaTypes: [...allowedMediaTypes] });
  const bytes = validateBytes(result?.bytes);
  const mediaType = String(result?.mediaType ?? "").toLowerCase();
  if (bytes.byteLength > maxBytes) throw new EvidenceStoreError("REMOTE_FETCH_TOO_LARGE", "Fetched content exceeds the capture limit");
  if (!allowedMediaTypes.includes(mediaType)) throw new EvidenceStoreError("REMOTE_FETCH_MEDIA_TYPE_DISALLOWED", "Fetched content media type is not allowed");
  return store.putArtifact({ ...custody, bytes, mediaType, captureKind: "constrained-fetch", sourceUri: parsed.toString(), capturedAt: result.capturedAt ?? custody.capturedAt });
}
