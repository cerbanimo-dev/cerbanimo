# ADR-014 — Human-review eligibility and deterministic inconclusive calculation

- Status: Accepted
- Decision authority: Sol, Packet 001.1 executive decision
- Recorded: 2026-07-22

## Context

Named reviewers are not sufficient evidence of human eligibility or independence, and caller-selected inconclusive reasons can conceal available quorum paths.

## Decision

Human review requires an active issuer-attributable credential, the relevant scope, a valid time window, actor/subject equality, and a digest-bound signed conflict disclosure with no conflict. Inconclusive reason is calculated from approvals, rejections, outstanding assignments, quorum, and expiry; callers provide only resolution time. Human escalation revokes every outstanding model assignment before adding eligible human assignments.

## Consequences

Model services remain attributable but cannot impersonate human reviewers. Timeout never means rejection. Stored events contain the quorum calculation used for the inconclusive result.

## Reversal strategy

Credential issuers, assurance mapping, and conflict taxonomies may evolve behind versioned credential contracts without weakening recorded decisions.
