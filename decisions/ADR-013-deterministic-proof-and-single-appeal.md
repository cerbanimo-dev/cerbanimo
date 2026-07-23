# ADR-013 — Attributable deterministic proof and one appeal

- Status: Accepted
- Decision authority: Sol, Packet 001.1 executive decision
- Recorded: 2026-07-22

## Context

Independent review needs an auditable deterministic handoff, and a false deterministic rejection needs bounded human correction without allowing repeated appeals or silently approving work.

## Decision

Every passing deterministic gate emits `DeterministicProofPassed` before `ReviewOpened`, binding evidence digest, policy version, result codes, evaluator, and evaluation time. A deterministic rejection permits one appeal per immutable evidence cycle. Filing enters `deterministic_appeal_pending`. A high-assurance, scoped, conflict-free human reviewer may uphold the rejection or overturn it. Overturn opens independent review on the unchanged digest and cannot approve or settle the task.

## Consequences

Appeal history is part of the evidence cycle. Correction after an upheld decision still creates a new evidence cycle. Independent quorum remains mandatory after overturn.

## Reversal strategy

Additional appeal tiers require a new versioned state machine and migration; they cannot reinterpret existing single-appeal cycles.
