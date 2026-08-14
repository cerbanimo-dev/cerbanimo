# ADR-001 — Freeze v0.4.0 as a behavioral exhibit

- Status: Accepted
- Decision authority: Sol, executive architecture handoff
- Recorded: 2026-07-22

## Context

The v0.4.0 release demonstrates the complete loop, but its local JSON store and
combined responsibilities are not a safe production substrate. Refactoring it
in place would make behavioral regressions difficult to distinguish from
architecture changes.

## Decision

The release archive is immutable and used only as a compatibility oracle.

## Consequences

Production code is built in a separate workspace. Observable promises are
frozen as external compatibility fixtures before replacement.

## Reversal strategy

None is required. Later references may supersede behaviors only through an
explicit product decision, never by silently changing the exhibit.
