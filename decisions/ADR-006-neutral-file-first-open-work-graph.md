# ADR-006 — Open Work Graph is neutral and file-first

- Status: Accepted
- Decision authority: Sol, executive architecture handoff
- Recorded: 2026-07-22

## Context

File round trips expose consent, serialization, signatures, and replay concerns
without prematurely creating a remote authority surface.

## Decision

The first bridge uses signed offline envelopes with minimal neutral work
semantics. Network transport comes later.

## Consequences

Product concepts remain in namespaced extensions. XP, coins, quests, attention,
coherence, resonance, and moral scores cannot enter the neutral bridge core.

## Reversal strategy

Transports may be added without changing the neutral core vocabulary or either
product's authority boundary.
