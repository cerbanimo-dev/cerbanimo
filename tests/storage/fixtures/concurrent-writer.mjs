import { SqliteJournal } from "../../../packages/storage-sqlite/src/index.mjs";
import { canonicalCommand, commitRequest, eventFor } from "../support.mjs";

const [databasePath, writerId, mode, startAtRaw] = process.argv.slice(2);
const startAt = Number(startAtRaw);
const delay = Math.max(0, startAt - Date.now());
if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

const journal = new SqliteJournal(databasePath, { busyTimeoutMs: 5_000 });
try {
  const streamId = mode === "settlement" ? `task:settlement_${writerId}` : "task:concurrent";
  const command = canonicalCommand(mode === "settlement" ? "SettleAcceptedTask" : "EditTask", streamId, 0, { writerId }, { commandId: `cmd_writer_${writerId}`, idempotencyKey: `idem_writer_${writerId}` });
  const event = mode === "settlement"
    ? eventFor(command, streamId, 1, "SettlementCommitted", { taskId: streamId, intent: { settlementId: "settlement_shared_race" }, transactionId: `transaction_${writerId}`, committedAt: command.issuedAt }, writerId)
    : eventFor(command, streamId, 1, "TaskEdited", { taskId: "concurrent", title: `Writer ${writerId}`, description: "Concurrent write.", proofRequirement: "One winner." }, writerId);
  const request = commitRequest(command, [{ streamId, streamType: "task", expectedStreamVersion: 0 }], [{ streamId, events: [event] }], { receipt: mode === "settlement" ? { settlementId: "settlement_shared_race" } : {} });
  journal.commit(request);
  process.stdout.write(JSON.stringify({ writerId, status: "committed", streamId }));
} catch (error) {
  process.stdout.write(JSON.stringify({ writerId, status: "rejected", code: error.code ?? "UNKNOWN" }));
} finally {
  journal.close();
}
