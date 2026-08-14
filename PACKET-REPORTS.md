# Packet evidence-gate index

| Packet | Status | Evidence gate |
| --- | --- | --- |
| 000 | Accepted | [`packet-000/REPORT.md`](packet-000/REPORT.md) |
| 001 | Accepted after amendment | [`packet-001/REPORT.md`](packet-001/REPORT.md) |
| 001.1 | Accepted | [`packet-001/PACKET-001.1-REPORT.md`](packet-001/PACKET-001.1-REPORT.md) |
| 002 | Accepted | [`packet-002/REPORT.md`](packet-002/REPORT.md) |
| 003 | Accepted | [`packet-003/REPORT.md`](packet-003/REPORT.md) |

The reports are evidence summaries, not substitutes for executable
verification. The root `npm test` command runs Packet 000 through Packet 003 in
order and rejects a reference archive whose SHA-256 differs from the recorded
v0.4.0 value.

The accepted test counts recorded at the Packet 003 boundary are:

- Packet 000: 10 passed
- Packet 001/001.1: 28 passed
- Packet 002: 11 passed
- Packet 003: 17 passed
- Total: 66 passed, 0 failed

Later packet work must add its own report and must not rewrite these accepted
historical findings.
