# ADR-008 — Evidence close is an explicit UX boundary

- Status: Accepted
- Decision authority: Sol, post-Packet-000 executive decision
- Recorded: 2026-07-22

## Context

Submission drafts remain correctable until closure. Combining draft submission
and closure without a clear boundary can disclose or freeze evidence before the
person understands that editing is ending.

## Decision

The normal UX exposes a separate “review and close evidence” action after draft
submission. Closure shows the normalized bundle and digest and requires explicit
confirmation. A future combined control is permissible only if it names both
actions and still records distinct commands and receipts.

## Consequences

`SubmitEvidenceDraft` never closes evidence. `CloseEvidence` is independently
versioned and digest-bound. Independent review cannot begin against a draft.

## Reversal strategy

Presentation may streamline the two actions without collapsing their domain
contracts or hiding the final immutable bundle.
